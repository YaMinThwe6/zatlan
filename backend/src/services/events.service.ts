import { randomBytes } from "node:crypto";
import type { EventSummary, UpcomingEvent, NearbyEvent, EventDetail } from "@binj/shared-types";
import { requireDb } from "../lib/firebaseAdmin.js";
import { writeNotification } from "../lib/notify.js";
import { AppError } from "../utils/AppError.js";
import { encodeGeohash, geohashPrecisionForRadiusKm, geohashPrefixRange, haversineDistanceKm } from "../lib/geohash.js";

const GEOHASH_STORAGE_PRECISION = 9;
const MAX_NEARBY_RADIUS_KM = 200;

const DEFAULT_UPCOMING_LIMIT = 10;
const MAX_UPCOMING_LIMIT = 50;

function generateJoinCode(): string {
  return randomBytes(4).toString("hex"); // 8 chars, e.g. "a1b2c3d4"
}

function toIso(value: FirebaseFirestore.Timestamp | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

// Plain read-then-write arrays rather than Firestore's FieldValue.arrayUnion/
// arrayRemove sentinels — deliberate: this codebase's tests run against a
// hand-rolled in-memory Firestore mock (not the real emulator), which has no
// concept of those sentinel objects. Reading the current array from within
// the same transaction (before any writes, per Firestore's read-before-write
// rule) keeps this correct against real Firestore too, not just the mock.
function withRoomMember(memberIds: string[] | undefined, uid: string): string[] {
  const current = memberIds ?? [];
  return current.includes(uid) ? current : [...current, uid];
}

function withoutRoomMember(memberIds: string[] | undefined, uid: string): string[] {
  return (memberIds ?? []).filter((m) => m !== uid);
}

function isValidLatLng(location: unknown): location is { lat: number; lng: number } {
  if (typeof location !== "object" || location === null) return false;
  const { lat, lng } = location as { lat?: unknown; lng?: unknown };
  return typeof lat === "number" && typeof lng === "number" && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// A host provides area + city (always shown) and exact coordinates (shown
// only once someone's joined, see toEventSummary) as one location input —
// all four required together for an in-person event.
function isValidLocationInput(location: unknown): location is { area: string; city: string; lat: number; lng: number } {
  if (typeof location !== "object" || location === null) return false;
  const { area, city } = location as { area?: unknown; city?: unknown };
  return typeof area === "string" && area.trim().length > 0 && typeof city === "string" && city.trim().length > 0 && isValidLatLng(location);
}

// `canSeePrecise` gates `preciseLocation` (exact lat/lng) separately from
// `location` (area/city) — area/city is always safe to show a stranger
// browsing events; the exact meeting spot is only revealed to the host or
// someone who has actually joined. Callers decide `canSeePrecise` per
// endpoint (see each call site below) — never trust a client-supplied flag.
function toEventSummary(id: string, data: FirebaseFirestore.DocumentData, canSeePrecise: boolean): EventSummary {
  const rawLocation = data.location as { area?: unknown; city?: unknown; lat?: unknown; lng?: unknown } | null | undefined;
  const hasLocation = typeof rawLocation === "object" && rawLocation !== null;
  return {
    eventId: id,
    hostId: data.hostId,
    movieId: data.movieId,
    title: data.title ?? null,
    datetime: toIso(data.datetime),
    mode: data.mode,
    location: hasLocation ? { area: rawLocation.area as string, city: rawLocation.city as string } : null,
    preciseLocation: hasLocation && canSeePrecise && isValidLatLng(rawLocation) ? { lat: (rawLocation as { lat: number }).lat, lng: (rawLocation as { lng: number }).lng } : null,
    visibility: data.visibility,
    joinCode: data.joinCode ?? null, // private events only — the host needs this back to share it (hld.md §7)
    participantLimit: data.participantLimit,
    participantCount: data.participantCount ?? 0,
    requiresApproval: data.requiresApproval,
    roomId: data.roomId,
    createdAt: toIso(data.createdAt)
  };
}

export interface CreateEventInput {
  movieId?: unknown;
  datetime?: unknown;
  mode?: unknown;
  visibility?: unknown;
  participantLimit?: unknown;
  requiresApproval?: unknown;
  title?: unknown;
  location?: unknown;
  invitedUserIds?: unknown;
}

export interface CreateEventOptions {
  // Present only for POST /rooms/:roomId/events (hld.md §16's "a persistent
  // room can spawn new events") — reuses the room instead of creating a new
  // one, so one room ends up associated with multiple events over time.
  existingRoomId?: string;
}

// POST /events — hld.md §7 "Create Event". Host auto-joins; every event gets a
// roomId (schema.md §4) so §16's chat feature has something to attach to.
export async function createEvent(hostId: string, body: CreateEventInput, options: CreateEventOptions = {}): Promise<EventSummary> {
  const { movieId, datetime, mode, visibility, participantLimit, requiresApproval } = body;
  if (
    typeof movieId !== "string" ||
    typeof datetime !== "string" ||
    (mode !== "online" && mode !== "in-person") ||
    (visibility !== "public" && visibility !== "private") ||
    typeof participantLimit !== "number" ||
    participantLimit < 1 ||
    typeof requiresApproval !== "boolean"
  ) {
    throw new AppError(
      "INVALID_EVENT",
      "movieId, datetime, mode ('online'|'in-person'), visibility ('public'|'private'), participantLimit (>=1), requiresApproval are required",
      400
    );
  }
  const parsedDatetime = new Date(datetime);
  if (Number.isNaN(parsedDatetime.getTime())) {
    throw new AppError("INVALID_EVENT", "datetime must be a valid date", 400);
  }

  // In-person events need somewhere to meet; online events have nowhere to
  // put one (and any location sent for one is just ignored below).
  if (mode === "in-person" && !isValidLocationInput(body.location)) {
    throw new AppError("INVALID_EVENT", "location with area, city, lat, lng is required for in-person events", 400);
  }

  const db = requireDb();
  const movieSnap = await db.collection("movies").doc(movieId).get();
  if (!movieSnap.exists) {
    throw new AppError("MOVIE_NOT_FOUND", "No such movie", 404);
  }

  // Validated above for in-person; online events store no location at all,
  // regardless of what a client sent — there's nowhere for it to point.
  const location =
    mode === "in-person" && isValidLocationInput(body.location)
      ? { area: body.location.area.trim(), city: body.location.city.trim(), lat: body.location.lat, lng: body.location.lng }
      : null;

  const eventRef = db.collection("events").doc();
  const roomRef = options.existingRoomId ? db.collection("rooms").doc(options.existingRoomId) : db.collection("rooms").doc();
  const participantRef = eventRef.collection("participants").doc(hostId);
  const now = new Date();

  const eventDoc = {
    hostId,
    movieId,
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : null,
    datetime: parsedDatetime,
    mode,
    location,
    // hld.md §9 — geohash powers /events/nearby's prefix-range query. Only
    // meaningful for in-person events with a real lat/lng; online events
    // simply aren't discoverable by location, same as they're already
    // absent from any radius search a client might run.
    geohash: location ? encodeGeohash(location.lat, location.lng, GEOHASH_STORAGE_PRECISION) : null,
    visibility,
    participantLimit,
    participantCount: 1, // host auto-joins
    requiresApproval,
    joinCode: visibility === "private" ? generateJoinCode() : null,
    invitedUserIds: Array.isArray(body.invitedUserIds) ? body.invitedUserIds : null,
    roomId: roomRef.id,
    createdAt: now
  };

  const batch = db.batch();
  batch.set(eventRef, eventDoc);
  batch.set(participantRef, { joinedAt: now });
  if (!options.existingRoomId) {
    // hld.md §16 — ephemeral by default (Google Meet-chat-style); the host
    // promotes to persistent later via PATCH /rooms/:roomId, not upfront here.
    batch.set(roomRef, { type: "ephemeral", originEventId: eventRef.id, memberIds: [hostId], createdAt: now });
  } else {
    // Reusing an existing (persistent) room — just make sure the new host is
    // a member too, without touching its type/originEventId/other members.
    // Read happens outside the batch (batches are write-only) — acceptable
    // here since scheduling an event from a room is low-frequency/low-contention,
    // unlike the join/leave paths below which go through a transaction instead.
    const roomSnap = await roomRef.get();
    batch.update(roomRef, { memberIds: withRoomMember(roomSnap.data()?.memberIds as string[] | undefined, hostId) });
  }
  await batch.commit();

  return toEventSummary(eventRef.id, eventDoc, true); // the host just created it — always a participant
}

// GET /events/upcoming — public events browse/upcoming list (schema.md §6's
// documented-but-not-yet-flowed index: visibility asc + datetime asc). Powers
// Home's "Upcoming watch events" section, and — with `movieId` given — movie
// detail's "Watch together" right-rail section (api-contracts.md §8): same
// query, narrowed to one movie rather than a whole extra endpoint.
export async function listUpcomingEvents(rawLimit: unknown, rawMovieId?: unknown): Promise<{ items: UpcomingEvent[] }> {
  const db = requireDb();
  const parsedLimit = Number(rawLimit);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_UPCOMING_LIMIT) : DEFAULT_UPCOMING_LIMIT;
  const movieId = typeof rawMovieId === "string" && rawMovieId.trim() ? rawMovieId.trim() : null;

  let query = db
    .collection("events")
    .where("visibility", "==", "public")
    .where("datetime", ">=", new Date());
  if (movieId) query = query.where("movieId", "==", movieId);

  const snap = await query.orderBy("datetime", "asc").limit(limit).get();

  // §21's soft-delete filtered in application code, not a third Firestore
  // range/inequality filter alongside the two already on this query
  // (visibility, datetime) — Firestore only allows one range filter per
  // query, and datetime already claims that slot.
  const items: UpcomingEvent[] = await Promise.all(
    snap.docs
      .filter((d) => d.data().deleted !== true)
      .map(async (d) => {
        const data = d.data();
        const movieSnap = await db.collection("movies").doc(data.movieId).get();
        return {
          // Browse-list — never the exact spot, joined or not (hld.md §9's
          // pre-join privacy rule): area/city is enough to judge interest.
          ...toEventSummary(d.id, data, false),
          movieTitle: movieSnap.data()?.title ?? null,
          moviePoster: movieSnap.data()?.poster ?? null
        };
      })
  );

  return { items };
}

// PUT /events/:eventId/join — hld.md §7 "Join Event". Branches on the event's own
// settings, re-checked server-side every time — never trusts a frontend claim.
export async function joinEvent(uid: string, eventId: string): Promise<{ status: "joined" | "pending" }> {
  const db = requireDb();
  const eventRef = db.collection("events").doc(eventId);

  const eventSnap = await eventRef.get();
  if (!eventSnap.exists || eventSnap.data()?.deleted === true) {
    throw new AppError("EVENT_NOT_FOUND", "No such event", 404);
  }
  const event = eventSnap.data()!;
  const participantRef = eventRef.collection("participants").doc(uid);
  if ((await participantRef.get()).exists) {
    return { status: "joined" };
  }

  if (!event.requiresApproval) {
    const result = await db.runTransaction(async (tx) => {
      const freshEvent = await tx.get(eventRef);
      // hld.md §16 — room membership tracks event participation; Firestore
      // Security Rules gate chat reads purely on rooms/{roomId}.memberIds, so
      // this has to stay in sync with participants, not just event-side state.
      // All reads (including this one) happen before any writes below, per
      // Firestore's read-before-write rule within a transaction.
      const roomId = freshEvent.data()?.roomId as string | undefined;
      const roomRef = roomId ? db.collection("rooms").doc(roomId) : null;
      const roomSnap = roomRef ? await tx.get(roomRef) : null;

      const count = (freshEvent.data()?.participantCount as number) ?? 0;
      if (count >= (freshEvent.data()?.participantLimit as number)) {
        return "full" as const;
      }
      tx.set(participantRef, { joinedAt: new Date() });
      tx.update(eventRef, { participantCount: count + 1 });
      if (roomRef) tx.update(roomRef, { memberIds: withRoomMember(roomSnap?.data()?.memberIds as string[] | undefined, uid) });
      return "joined" as const;
    });
    if (result === "full") {
      throw new AppError("EVENT_FULL", "This event is at capacity", 409);
    }
    return { status: "joined" };
  }

  const requestRef = eventRef.collection("joinRequests").doc(uid);
  if (!(await requestRef.get()).exists) {
    await requestRef.set({ createdAt: new Date() });
    await writeNotification(event.hostId, "eventJoinRequest", uid, "event", eventId);
  }
  return { status: "pending" };
}

// DELETE /events/:eventId/join — leave the event, or cancel a pending request.
export async function leaveEvent(uid: string, eventId: string): Promise<void> {
  const db = requireDb();
  const eventRef = db.collection("events").doc(eventId);
  const participantRef = eventRef.collection("participants").doc(uid);
  const requestRef = eventRef.collection("joinRequests").doc(uid);

  await db.runTransaction(async (tx) => {
    const [participantSnap, eventSnap] = await Promise.all([tx.get(participantRef), tx.get(eventRef)]);
    const roomId = eventSnap.exists ? (eventSnap.data()?.roomId as string | undefined) : undefined;
    const roomRef = roomId ? db.collection("rooms").doc(roomId) : null;
    const roomSnap = roomRef ? await tx.get(roomRef) : null;

    if (participantSnap.exists) {
      tx.delete(participantRef);
      if (eventSnap.exists) {
        const count = (eventSnap.data()?.participantCount as number) ?? 1;
        tx.update(eventRef, { participantCount: Math.max(0, count - 1) });
        if (roomRef) tx.update(roomRef, { memberIds: withoutRoomMember(roomSnap?.data()?.memberIds as string[] | undefined, uid) });
      }
    }
    tx.delete(requestRef);
  });
}

// GET /events/:eventId/joinRequests — host-only (hld.md §7's reused §3 ownership check).
export async function listJoinRequests(uid: string, eventId: string) {
  const db = requireDb();
  const eventSnap = await db.collection("events").doc(eventId).get();
  if (!eventSnap.exists) {
    throw new AppError("EVENT_NOT_FOUND", "No such event", 404);
  }
  if (eventSnap.data()?.hostId !== uid) {
    throw new AppError("FORBIDDEN", "Only the host can view join requests", 403);
  }

  const snap = await db.collection("events").doc(eventId).collection("joinRequests").get();
  const items = await Promise.all(
    snap.docs.map(async (d) => {
      const userSnap = await db.collection("users").doc(d.id).get();
      return { uid: d.id, displayName: userSnap.data()?.displayName ?? "Unknown" };
    })
  );
  return { items };
}

export async function approveJoinRequest(uid: string, eventId: string, requesterUid: string): Promise<void> {
  const db = requireDb();
  const eventRef = db.collection("events").doc(eventId);

  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) {
    throw new AppError("EVENT_NOT_FOUND", "No such event", 404);
  }
  if (eventSnap.data()?.hostId !== uid) {
    throw new AppError("FORBIDDEN", "Only the host can approve join requests", 403);
  }

  const requestRef = eventRef.collection("joinRequests").doc(requesterUid);
  const result = await db.runTransaction(async (tx) => {
    const [requestSnap, freshEvent] = await Promise.all([tx.get(requestRef), tx.get(eventRef)]);
    if (!requestSnap.exists) return "not_found" as const;
    const roomId = freshEvent.data()?.roomId as string | undefined;
    const roomRef = roomId ? db.collection("rooms").doc(roomId) : null;
    const roomSnap = roomRef ? await tx.get(roomRef) : null;

    const count = (freshEvent.data()?.participantCount as number) ?? 0;
    if (count >= (freshEvent.data()?.participantLimit as number)) return "full" as const;
    tx.set(eventRef.collection("participants").doc(requesterUid), { joinedAt: new Date() });
    tx.update(eventRef, { participantCount: count + 1 });
    if (roomRef) tx.update(roomRef, { memberIds: withRoomMember(roomSnap?.data()?.memberIds as string[] | undefined, requesterUid) });
    tx.delete(requestRef);
    return "approved" as const;
  });

  if (result === "not_found") {
    throw new AppError("REQUEST_NOT_FOUND", "No such join request", 404);
  }
  if (result === "full") {
    throw new AppError("EVENT_FULL", "This event is at capacity", 409);
  }
  await writeNotification(requesterUid, "eventJoinApproved", uid, "event", eventId);
}

export async function denyJoinRequest(uid: string, eventId: string, requesterUid: string): Promise<void> {
  const db = requireDb();
  const eventSnap = await db.collection("events").doc(eventId).get();
  if (!eventSnap.exists) {
    throw new AppError("EVENT_NOT_FOUND", "No such event", 404);
  }
  if (eventSnap.data()?.hostId !== uid) {
    throw new AppError("FORBIDDEN", "Only the host can deny join requests", 403);
  }
  await db.collection("events").doc(eventId).collection("joinRequests").doc(requesterUid).delete();
}

// GET /events/nearby — hld.md §9. Firestore has no native radius query, so
// this runs a geohash-prefix range query (an approximation of a bounding
// box), then post-filters to an actual haversine distance and sorts by it.
// Composes with §7's existing visibility rules rather than bypassing them —
// a naive geo-radius query would otherwise leak a private event's
// existence/location to any nearby stranger: results are limited to public
// events, or private events the caller is hosting or was explicitly invited
// to. (A join-code holder who isn't invited can still open that event
// directly by ID — this endpoint just doesn't surface it via location.)
export async function listNearbyEvents(callerUid: string, rawLat: unknown, rawLng: unknown, rawRadiusKm: unknown): Promise<{ items: NearbyEvent[] }> {
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  const radiusKm = Number(rawRadiusKm);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new AppError("INVALID_QUERY", "lat/lng must be valid coordinates", 400);
  }
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > MAX_NEARBY_RADIUS_KM) {
    throw new AppError("INVALID_QUERY", `radiusKm must be a positive number up to ${MAX_NEARBY_RADIUS_KM}`, 400);
  }

  const db = requireDb();
  const precision = geohashPrecisionForRadiusKm(radiusKm);
  const prefix = encodeGeohash(lat, lng, precision);
  const { start, end } = geohashPrefixRange(prefix);

  const snap = await db.collection("events").where("geohash", ">=", start).where("geohash", "<", end).get();

  const now = Date.now();
  const candidates = snap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .filter(({ data }) => data.deleted !== true)
    // Real bug, no test ever covered it: unlike /events/upcoming (which
    // filters datetime >= now in the Firestore query itself), this endpoint
    // never excluded past events at all — a watch party from last week still
    // showed up on the nearby map as if it were still happening. Can't add a
    // second Firestore range filter here (geohash already claims the query's
    // one allowed range field), so this stays an in-app filter like the
    // visibility/deleted checks around it.
    .filter(({ data }) => {
      const dt = data.datetime;
      const millis = dt instanceof Date ? dt.getTime() : dt?.toDate?.().getTime();
      return typeof millis === "number" && millis >= now;
    })
    .filter(({ data }) => {
      if (data.visibility === "public") return true;
      return data.hostId === callerUid || (Array.isArray(data.invitedUserIds) && data.invitedUserIds.includes(callerUid));
    })
    .filter(({ data }) => isValidLatLng(data.location))
    .map(({ id, data }) => ({
      id,
      data,
      distanceKm: haversineDistanceKm(lat, lng, data.location.lat, data.location.lng)
    }))
    .filter(({ distanceKm }) => distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const items: NearbyEvent[] = await Promise.all(
    candidates.map(async ({ id, data, distanceKm }) => {
      const movieSnap = await db.collection("movies").doc(data.movieId).get();
      return {
        // The nearby map (NearbyEventsMap.tsx) needs a real pin for every
        // candidate it plots — left as-is, out of scope for the pre-join
        // area/city-only rule (a separate, larger design question).
        ...toEventSummary(id, data, true),
        movieTitle: movieSnap.data()?.title ?? null,
        moviePoster: movieSnap.data()?.poster ?? null,
        distanceKm: Math.round(distanceKm * 10) / 10
      };
    })
  );

  return { items };
}

// GET /events/:eventId — hld.md §7/§21, api-contracts.md §8. Deliberately no
// visibility-based access check here, consistent with the security model
// already established for PUT /events/:eventId/join and this file's own note
// on listNearbyEvents: a private event is protected by not being *listed*
// anywhere the caller isn't allowed to see it (upcoming/nearby already do
// that filtering) — not by blocking direct access to an unguessable
// Firestore doc ID. Same reasoning as a join-code holder already being able
// to open a private event directly by ID today. A soft-deleted event 404s,
// same as a nonexistent one — indistinguishable from the outside.
export async function getEvent(eventId: string, callerUid: string): Promise<EventDetail> {
  const db = requireDb();
  const eventSnap = await db.collection("events").doc(eventId).get();
  if (!eventSnap.exists || eventSnap.data()?.deleted === true) {
    throw new AppError("EVENT_NOT_FOUND", "No such event", 404);
  }
  const data = eventSnap.data()!;
  const [movieSnap, hostSnap] = await Promise.all([
    db.collection("movies").doc(data.movieId).get(),
    db.collection("users").doc(data.hostId).get()
  ]);
  // The exact meeting spot is only for the host or someone who's actually
  // joined — a signed-in caller who's merely looking at a public event's
  // detail page doesn't get more than the area/city everyone else sees.
  const isHost = data.hostId === callerUid;
  const participantSnap = isHost ? null : await db.collection("events").doc(eventId).collection("participants").doc(callerUid).get();
  const isParticipant = isHost || (participantSnap?.exists ?? false);
  const canSeePrecise = isParticipant;

  // The frontend's Join/Requested/Chat button needs to know the viewer's own
  // relationship to this event on first render, not just after they click
  // something — a join-requests read only when it's actually relevant (not
  // host, not already a participant), same "only pay for what you need"
  // shape as canSeePrecise above.
  const requestSnap = !isParticipant ? await db.collection("events").doc(eventId).collection("joinRequests").doc(callerUid).get() : null;
  const viewerStatus: "host" | "joined" | "pending" | "none" = isHost
    ? "host"
    : isParticipant
      ? "joined"
      : requestSnap?.exists
        ? "pending"
        : "none";

  return {
    ...toEventSummary(eventSnap.id, data, canSeePrecise),
    movieTitle: movieSnap.data()?.title ?? null,
    moviePoster: movieSnap.data()?.poster ?? null,
    hostDisplayName: hostSnap.data()?.displayName ?? "Unknown",
    viewerStatus
  };
}

// GET /events/hosting — the Events page's "Hosting" tab. Unlike /events/upcoming
// (public only, so a host managing a private watch party has nowhere to see
// it listed), this is scoped to the caller's own hostId regardless of
// visibility — deliberately the one events list that isn't gated by the
// privacy-by-not-being-listed rule the rest of this file follows, since the
// host themself already has full visibility into their own event.
export async function listHostedEvents(uid: string): Promise<{ items: UpcomingEvent[] }> {
  const db = requireDb();
  const snap = await db
    .collection("events")
    .where("hostId", "==", uid)
    .where("datetime", ">=", new Date())
    .orderBy("datetime", "asc")
    .get();

  const items: UpcomingEvent[] = await Promise.all(
    snap.docs
      .filter((d) => d.data().deleted !== true)
      .map(async (d) => {
        const data = d.data();
        const movieSnap = await db.collection("movies").doc(data.movieId).get();
        return {
          ...toEventSummary(d.id, data, true), // the host always sees their own event's exact location
          movieTitle: movieSnap.data()?.title ?? null,
          moviePoster: movieSnap.data()?.poster ?? null
        };
      })
  );

  return { items };
}

// DELETE /events/:eventId — hld.md §21's general edit/delete pattern: author
// (the host) only. No moderator branch — §14's role system was never built
// (superseded by full-autonomy AI moderation, see hld.md §14), same reason
// room-message delete stayed author-only. Soft delete only, per §21's
// project-wide policy: the doc, its participants/joinRequests subcollections,
// and its room are left untouched (audit trail; rooms are never
// auto-deleted regardless, per hld.md §16). Existing participants aren't
// notified of the cancellation — a smaller piece of the still-open "event
// notifications" gap (hld.md §11), not addressed here.
export async function deleteEvent(uid: string, eventId: string): Promise<void> {
  const db = requireDb();
  const eventRef = db.collection("events").doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists || eventSnap.data()?.deleted === true) {
    throw new AppError("EVENT_NOT_FOUND", "No such event", 404);
  }
  if (eventSnap.data()?.hostId !== uid) {
    throw new AppError("FORBIDDEN", "Only the host can delete this event", 403);
  }
  await eventRef.update({ deleted: true });
}
