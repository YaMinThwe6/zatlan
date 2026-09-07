import type { TasteMatch, WatchedByEntry, PersonSummary } from "@binj/shared-types";
import { requireDb } from "../lib/firebaseAdmin.js";
import { AppError } from "../utils/AppError.js";
import { significantWords } from "../lib/searchIndex.js";
import { rankCandidate } from "../lib/searchRanking.js";

const MAX_QUERY_WORDS = 30; // Firestore's array-contains-any cap — same as movies.service.ts's search
const RESULTS_TOP_N = 20;
const MAX_ARRAY_CONTAINS_ANY = 10; // Firestore's cap, same convention as onboarding.service.ts
export const COLD_START_MATCH_LIMIT = 10; // default page size for GET /users/me/tasteMatches, exported for the controller's ?limit= default
const SUGGESTED_POOL_LIMIT = 30; // fan-out bound for the suggested-tier candidate pool, same convention as MAX_FOLLOWING_FOR_WATCHED_BY below

function toIso(value: FirebaseFirestore.Timestamp | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

async function getRelationship(db: FirebaseFirestore.Firestore, callerUid: string, targetUid: string): Promise<TasteMatch["relationship"]> {
  const [followingSnap, requestSnap] = await Promise.all([
    db.collection("users").doc(callerUid).collection("following").doc(targetUid).get(),
    db.collection("users").doc(targetUid).collection("followRequests").doc(callerUid).get()
  ]);
  return followingSnap.exists ? "following" : requestSnap.exists ? "pending" : "none";
}

// Shared by every fallback tier below: overlap on an array field the caller
// picked at onboarding (favoriteGenres or preferredLanguages). Both are live,
// unlike the precomputed tasteMatches tier, so they're cheap fallbacks rather
// than the primary signal.
async function getArrayOverlapMatches(
  db: FirebaseFirestore.Firestore,
  uid: string,
  field: "favoriteGenres" | "preferredLanguages",
  matchReason: "genreOverlap" | "languageOverlap"
): Promise<TasteMatch[]> {
  const callerSnap = await db.collection("users").doc(uid).get();
  const callerValues = ((callerSnap.data()?.[field] as string[] | null) ?? []).slice(0, MAX_ARRAY_CONTAINS_ANY);
  if (callerValues.length === 0) return [];

  const candidatesSnap = await db.collection("users").where(field, "array-contains-any", callerValues).get();

  const items = await Promise.all(
    candidatesSnap.docs
      .filter((d) => d.id !== uid)
      .map(async (d): Promise<TasteMatch> => {
        const data = d.data();
        const values = (data[field] as string[] | null) ?? [];
        const overlap = values.filter((v) => callerValues.includes(v)).length;
        return {
          uid: d.id,
          displayName: data.displayName ?? "Unknown",
          photoURL: (data.photoURL as string | null) ?? null,
          score: Math.round((overlap / callerValues.length) * 100),
          relationship: await getRelationship(db, uid, d.id),
          matchReason
        };
      })
  );

  return items.sort((a, b) => b.score - a.score);
}

// Cold start for GET /users/me/tasteMatches below: scripts/computeTasteMatches.ts
// only ever scores a pair of users after both have enough watch history for a
// real comparison, so a brand-new (or otherwise thin-history) user has no
// precomputed docs at all — without this, the section has nothing to show and
// disappears completely rather than genuinely having no matches. Onboarding's
// favoriteGenres pick is the one signal guaranteed to exist immediately, so
// this stands in with a live genre-overlap score until real matches land.
function getGenreOverlapMatches(db: FirebaseFirestore.Firestore, uid: string): Promise<TasteMatch[]> {
  return getArrayOverlapMatches(db, uid, "favoriteGenres", "genreOverlap");
}

// Second live fallback, tried after genre-overlap: preferredLanguages is the
// other signal collected at onboarding and otherwise unused for matching.
function getLanguageOverlapMatches(db: FirebaseFirestore.Firestore, uid: string): Promise<TasteMatch[]> {
  return getArrayOverlapMatches(db, uid, "preferredLanguages", "languageOverlap");
}

async function getBlockedUids(db: FirebaseFirestore.Firestore, uid: string): Promise<Set<string>> {
  const snap = await db.collection("users").doc(uid).collection("blocked").get();
  return new Set(snap.docs.map((d) => d.id));
}

// Guaranteed catch-all tier: fires whenever the earlier tiers (precomputed
// taste, genre overlap, language overlap) haven't filled the requested limit
// — including a caller with zero signal of any kind (skipped onboarding
// picks, no watch history, no precomputed matches). Blends how recently a
// candidate joined with how many followers they have, so the list is never
// empty as long as at least one other (non-blocked) user exists.
async function getSuggestedMatches(db: FirebaseFirestore.Firestore, uid: string): Promise<TasteMatch[]> {
  const [snap, blocked] = await Promise.all([db.collection("users").orderBy("createdAt", "desc").get(), getBlockedUids(db, uid)]);
  const pool = snap.docs.filter((d) => d.id !== uid && !blocked.has(d.id)).slice(0, SUGGESTED_POOL_LIMIT);
  if (pool.length === 0) return [];

  const followerCounts = await Promise.all(
    pool.map((d) =>
      db
        .collection("users")
        .doc(d.id)
        .collection("followers")
        .get()
        .then((s) => s.docs.length)
    )
  );
  const maxFollowers = Math.max(...followerCounts);
  const poolSize = pool.length;

  const items = await Promise.all(
    pool.map(async (d, index): Promise<TasteMatch> => {
      const data = d.data();
      const recencyNorm = poolSize > 1 ? (poolSize - 1 - index) / (poolSize - 1) : 1;
      const followerNorm = maxFollowers > 0 ? followerCounts[index] / maxFollowers : 0;
      const combined = followerNorm * 0.5 + recencyNorm * 0.5;
      return {
        uid: d.id,
        displayName: (data.displayName as string) ?? "Unknown",
        photoURL: (data.photoURL as string | null) ?? null,
        score: Math.round(combined * 100),
        relationship: await getRelationship(db, uid, d.id),
        matchReason: "suggested"
      };
    })
  );

  return items.sort((a, b) => b.score - a.score);
}

// GET /users/me/tasteMatches — api-contracts.md §5, hld.md §5b.
// One ranking pipeline shared by the Home widget (default, small limit) and
// the People Discovery page (larger explicit limit): precomputed taste
// matches first, then live genre overlap, then live language overlap, then
// the guaranteed suggested (recency+followers) catch-all — each tier only
// runs if the previous ones haven't already filled `limit`, and a candidate
// already picked up by an earlier (more specific) tier is never repeated by
// a later one. No write endpoint here either way.
export async function getTasteMatches(uid: string, limit: number = COLD_START_MATCH_LIMIT): Promise<{ items: TasteMatch[] }> {
  const db = requireDb();
  const seen = new Set<string>();
  const results: TasteMatch[] = [];

  function addTier(candidates: TasteMatch[]): void {
    for (const candidate of candidates) {
      if (results.length >= limit) return;
      if (seen.has(candidate.uid)) continue;
      seen.add(candidate.uid);
      results.push(candidate);
    }
  }

  const tasteSnap = await db.collection("users").doc(uid).collection("tasteMatches").orderBy("score", "desc").get();
  const tasteMatches = await Promise.all(
    tasteSnap.docs.map(async (matchDoc): Promise<TasteMatch> => {
      const targetSnap = await db.collection("users").doc(matchDoc.id).get();
      const data = targetSnap.data();
      return {
        uid: matchDoc.id,
        displayName: (data?.displayName as string) ?? "Unknown",
        photoURL: (data?.photoURL as string | null) ?? null,
        score: matchDoc.data().score,
        relationship: await getRelationship(db, uid, matchDoc.id),
        matchReason: "tasteMatch"
      };
    })
  );
  addTier(tasteMatches);

  if (results.length < limit) addTier(await getGenreOverlapMatches(db, uid));
  if (results.length < limit) addTier(await getLanguageOverlapMatches(db, uid));
  if (results.length < limit) addTier(await getSuggestedMatches(db, uid));

  return { items: results };
}

// ---------------------------------------------------------------------------
// Followed celebrities — api-contracts.md §5, data-model.md FollowedCelebrity,
// schema.md users/{uid}/followedCelebrities. Simpler than user-to-user Follow:
// one-directional, not mirrored (a Person doesn't follow back).
// ---------------------------------------------------------------------------

export async function followCelebrity(uid: string, personId: string): Promise<void> {
  const db = requireDb();
  const personSnap = await db.collection("people").doc(personId).get();
  if (!personSnap.exists) {
    throw new AppError("PERSON_NOT_FOUND", "No such person", 404);
  }
  await db.collection("users").doc(uid).collection("followedCelebrities").doc(personId).set({ followedAt: new Date() });
}

export async function unfollowCelebrity(uid: string, personId: string): Promise<void> {
  const db = requireDb();
  await db.collection("users").doc(uid).collection("followedCelebrities").doc(personId).delete();
}

export async function listFollowedCelebrities(uid: string) {
  const db = requireDb();
  const snap = await db.collection("users").doc(uid).collection("followedCelebrities").get();
  const items = await Promise.all(
    snap.docs.map(async (d) => {
      const personSnap = await db.collection("people").doc(d.id).get();
      return { personId: d.id, name: personSnap.data()?.name ?? "Unknown", photo: personSnap.data()?.photo ?? null };
    })
  );
  return { items, nextCursor: null };
}

// GET /people/search — by-name lookup over the local people/{personId}
// catalog (populated lazily from movie credits, movies.service.ts's person
// upsert — schema.md's "every credited person, not just top-billed").
// Local-only, unlike movie search: there's no equivalent live "search
// people directly" TMDB call already wired into this codebase the way
// TMDB's movie search is, so this only ever finds someone BINJ has already
// ingested via some movie's credits — not the entire universe of actors.
export async function searchPeopleService(rawQuery: unknown): Promise<{ items: PersonSummary[] }> {
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  if (!query) {
    throw new AppError("MISSING_QUERY", "q query param is required", 400);
  }

  const db = requireDb();
  const queryWords = significantWords(query).slice(0, MAX_QUERY_WORDS);
  if (queryWords.length === 0) {
    return { items: [] };
  }

  const snap = await db.collection("people").where("nameSearchTerms", "array-contains-any", queryWords).get();

  const items: PersonSummary[] = snap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .map(({ id, data }) => ({
      id,
      name: data.name as string,
      photo: (data.photo as string | null) ?? null,
      ...rankCandidate(query, { title: data.name as string, popularitySignal: data.popularity as number | undefined })
    }))
    .filter((r) => r.matchType !== "none")
    .sort((a, b) => b.score - a.score)
    .slice(0, RESULTS_TOP_N)
    .map(({ id, name, photo }) => ({ personId: id, name, photo }));

  return { items };
}

// GET /movies/:movieId/watchedBy — hld.md §5a, api-contracts.md §5. Never a
// global "everyone who watched this" list — fans out from the caller's own
// (bounded) `following` list and checks each one directly, so cost scales
// with how many people the caller follows, not with BINJ's whole user base.
//
// Two independent privacy checks per followed user, both must pass:
//   - list-level: users/{uid}.listVisible
//   - per-entry override: users/{uid}/watched/{movieId}.visibility !== "private"
const MAX_FOLLOWING_FOR_WATCHED_BY = 30; // safety bound on the fan-out width, not a Firestore query-operator limit here
export async function getMovieWatchedBy(callerUid: string, movieId: string): Promise<{ items: WatchedByEntry[]; nextCursor: null }> {
  const db = requireDb();
  const followingSnap = await db.collection("users").doc(callerUid).collection("following").get();
  const followedUids = followingSnap.docs.map((d) => d.id).slice(0, MAX_FOLLOWING_FOR_WATCHED_BY);

  const results = await Promise.all(
    followedUids.map(async (uid): Promise<WatchedByEntry | null> => {
      const [userSnap, watchedSnap] = await Promise.all([
        db.collection("users").doc(uid).get(),
        db.collection("users").doc(uid).collection("watched").doc(movieId).get()
      ]);
      if (!watchedSnap.exists) return null;
      if (userSnap.data()?.listVisible !== true) return null;
      if (watchedSnap.data()?.visibility === "private") return null;

      return {
        uid,
        displayName: userSnap.data()?.displayName ?? "Unknown",
        watchedAt: toIso(watchedSnap.data()?.watchedAt ?? null)
      };
    })
  );

  return { items: results.filter((r): r is WatchedByEntry => r !== null), nextCursor: null };
}
