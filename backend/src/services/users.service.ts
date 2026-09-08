import type { UserProfile, PublicProfile, ProfileGenreStat, ActivityItem, ProfileReviewEntry } from "@binj/shared-types";
import { requireDb } from "../lib/firebaseAdmin.js";
import { AppError } from "../utils/AppError.js";

const USERNAME_RE = /^[a-z0-9._]{3,30}$/;

interface UserDoc {
  uid: string;
  displayName: string;
  username: string | null;
  email: string;
  photoURL: string | null;
  createdAt: FirebaseFirestore.Timestamp | Date;
  listVisible: boolean;
  followRequiresApproval: boolean;
  status: "active" | "restricted" | "suspended";
  statusExpiresAt: null;
  favoriteGenres: string[] | null;
  preferredLanguages: string[] | null;
  onboardingComplete: boolean;
  notificationPrefs: { emailEnabled: boolean };
  themePreference: "dark" | "light" | "system";
  accentTheme: "emerald" | "cyan" | "purple" | "pink" | "amber" | "red";
  // Settings' opt-out of GET /discover/people (people.service.ts's
  // getTopFollowedPeople) — the signed-out Discover page's "top followed
  // users" teaser. Distinct from listVisible (gates the watched list, not
  // whether a user's name/photo gets surfaced to anonymous visitors at all).
  hideFromDiscovery: boolean;
}

interface Claims {
  name?: string;
  email?: string;
  picture?: string;
}

// Return type is the shared UserProfile DTO (@binj/shared-types) — the wire
// contract both frontend and backend agree on, distinct from UserDoc above
// (internal storage shape, Firestore Timestamps included) by construction.
function toResponse(doc: UserDoc, isNewUser = false): UserProfile {
  const { statusExpiresAt: _statusExpiresAt, createdAt: _createdAt, ...rest } = doc;
  return { ...rest, isNewUser };
}

// Shared by getOrCreateUser's bootstrap and updateUser's self-heal path below
// — a user doc should always exist by the time PATCH runs (GET /users/me
// creates it lazily), but PATCH must not *depend* on that ordering.
function buildDefaultUserDoc(uid: string, claims: Claims): UserDoc {
  return {
    uid,
    displayName: claims.name ?? claims.email?.split("@")[0] ?? "New user",
    username: null,
    email: claims.email ?? "",
    photoURL: claims.picture ?? null,
    createdAt: new Date(),
    listVisible: true,
    followRequiresApproval: false,
    status: "active",
    statusExpiresAt: null,
    favoriteGenres: null,
    preferredLanguages: null,
    onboardingComplete: false,
    notificationPrefs: { emailEnabled: true },
    themePreference: "dark",
    accentTheme: "emerald",
    hideFromDiscovery: false
  };
}

// GET /users/me — lazy bootstrap-or-fetch pattern, api-contracts.md §11 / hld.md §13.
// No POST /users: a brand-new verified token creates the profile right here.
// isNewUser is true only on this exact bootstrap call (hld.md §13) — the frontend's
// actual "show onboarding" check is isNewUser || !onboardingComplete.
export async function getOrCreateUser(uid: string, claims: Claims): Promise<UserProfile> {
  const db = requireDb();
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();

  if (snap.exists) {
    return toResponse(snap.data() as UserDoc, false);
  }

  const newUser = buildDefaultUserDoc(uid, claims);
  await ref.set(newUser);
  return toResponse(newUser, true);
}

// GET /users/username-available — api-contracts.md §11. Unauthenticated: needed
// before an account necessarily exists to attach a reservation to (checked live
// during onboarding step 3, before the PATCH that actually claims it).
// `callerUid` mirrors the exclusion updateUser's own claim transaction
// already applies (a reservation owned by the caller isn't "taken") — this
// pre-submit check used to have no notion of the caller at all, so it wrongly
// reported someone's own already-saved username as taken the moment they
// revisited this step (Continue stayed disabled even though re-submitting
// the same username would actually have succeeded).
export async function isUsernameAvailable(rawUsername: string, callerUid?: string): Promise<boolean> {
  const username = rawUsername.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw new AppError("INVALID_USERNAME", "Username must be 3-30 characters: lowercase letters, numbers, dots, underscores", 400);
  }

  const db = requireDb();
  const snap = await db.collection("usernames").doc(username).get();
  if (!snap.exists) return true;
  return callerUid !== undefined && snap.data()?.uid === callerUid;
}

const SIMPLE_PATCHABLE_FIELDS = [
  "displayName",
  "listVisible",
  "followRequiresApproval",
  "favoriteGenres",
  "preferredLanguages",
  "onboardingComplete",
  "themePreference",
  "accentTheme",
  "hideFromDiscovery",
  // Settings' "Email me about activity" toggle (frontend/src/features/settings) —
  // notificationPrefs existed on UserProfile/UserDoc since onboarding, but PATCH
  // never accepted it. Same plain pass-through as every other field here; no
  // sub-field validation, same as e.g. favoriteGenres/preferredLanguages above.
  "notificationPrefs"
] as const;

// PATCH /users/me — api-contracts.md §11. `username` is handled separately from
// the other fields since claiming one needs a transactional uniqueness check
// against usernames/{username} (schema.md) — everything else is a plain update.
export async function updateUser(uid: string, claims: Claims, body: Record<string, unknown>): Promise<UserProfile> {
  const db = requireDb();
  const updates: Record<string, unknown> = {};

  for (const field of SIMPLE_PATCHABLE_FIELDS) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  const wantsUsername = "username" in body;
  let newUsername: string | null = null;
  if (wantsUsername) {
    newUsername = String(body.username ?? "").trim().toLowerCase();
    if (!USERNAME_RE.test(newUsername)) {
      throw new AppError("INVALID_USERNAME", "Username must be 3-30 characters: lowercase letters, numbers, dots, underscores", 400);
    }
  }

  if (Object.keys(updates).length === 0 && !wantsUsername) {
    throw new AppError("NO_UPDATABLE_FIELDS", "No recognized fields in request body", 400);
  }

  const userRef = db.collection("users").doc(uid);

  if (wantsUsername) {
    const usernameRef = db.collection("usernames").doc(newUsername!);
    await db.runTransaction(async (tx) => {
      const [usernameSnap, userSnap] = await Promise.all([tx.get(usernameRef), tx.get(userRef)]);
      if (usernameSnap.exists && usernameSnap.data()?.uid !== uid) {
        throw new AppError("USERNAME_TAKEN", "That username is already taken", 409);
      }
      const oldUsername = userSnap.data()?.username as string | null | undefined;
      if (oldUsername && oldUsername !== newUsername) {
        tx.delete(db.collection("usernames").doc(oldUsername));
      }
      tx.set(usernameRef, { uid });
      // Self-heal: if the profile doc doesn't exist yet (PATCH reached us before
      // GET /users/me ever bootstrapped it), build it now instead of failing —
      // tx.update() would throw NOT_FOUND on a missing doc.
      const base = userSnap.exists ? (userSnap.data() as UserDoc) : buildDefaultUserDoc(uid, claims);
      tx.set(userRef, { ...base, ...updates, username: newUsername });
    });
  } else {
    const userSnap = await userRef.get();
    const base = userSnap.exists ? (userSnap.data() as UserDoc) : buildDefaultUserDoc(uid, claims);
    await userRef.set({ ...base, ...updates });
  }

  const snap = await userRef.get();
  return toResponse(snap.data() as UserDoc, false);
}

function toIso(value: FirebaseFirestore.Timestamp | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

// Preview cap for the watched list shown on a public profile — not a
// paginated list (that's GET /users/me/watched for the owner's own view),
// just enough for a "recently watched" section. Sliced client-side (not a
// Firestore .limit()) so a mostly-private list doesn't undercount the public
// entries that actually exist — the full unfiltered fetch is shared with the
// aggregate stats below (watchedCount/topGenres), which need every entry
// regardless of per-item visibility anyway.
const PROFILE_WATCHED_PREVIEW = 12;
const PROFILE_ACTIVITY_LIMIT = 6;
const PROFILE_TOP_GENRES = 5;

function toMillis(value: FirebaseFirestore.Timestamp | Date | null | undefined): number {
  if (!value) return 0;
  return value instanceof Date ? value.getTime() : value.toDate().getTime();
}

// Overview tab's "Favorite Genres" bars — % of the target's watched movies
// that carry each genre (computed from the movie catalog, not the manually-
// picked `favoriteGenres` onboarding list). A movie can carry more than one
// genre, so percentages don't sum to 100. Ties broken alphabetically for a
// deterministic order. Scales with the target's watched-list size (one read
// per movie, same join pattern the existing preview above already used) —
// fine at this app's current scale, worth revisiting with a denormalized
// genre-count field on the user doc if watched lists get large.
async function computeTopGenres(
  db: FirebaseFirestore.Firestore,
  watchedDocs: FirebaseFirestore.QueryDocumentSnapshot[]
): Promise<ProfileGenreStat[]> {
  if (watchedDocs.length === 0) return [];
  const movieSnaps = await Promise.all(watchedDocs.map((d) => db.collection("movies").doc(d.id).get()));
  const counts = new Map<string, number>();
  for (const snap of movieSnaps) {
    const genres = (snap.data()?.genres as string[] | undefined) ?? [];
    for (const genre of genres) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  const total = watchedDocs.length;
  return [...counts.entries()]
    .map(([genre, count]) => ({ genre, percent: Math.round((count / total) * 100) }))
    .sort((a, b) => b.percent - a.percent || a.genre.localeCompare(b.genre))
    .slice(0, PROFILE_TOP_GENRES);
}

// Reviews have no per-user list of their own (they live at
// movies/{movieId}/reviews/{uid} — reviews.service.ts), so counting a user's
// reviews means scanning every "reviews" subcollection in the store via a
// collectionGroup query and matching on doc id (== uid) client-side, since
// review docs don't carry a separate authorId field to filter on server-side.
// Bounded by the app's total review volume, not the target's own — fine at
// this app's current scale, same tradeoff noted on computeTopGenres above.
async function getReviewCount(db: FirebaseFirestore.Firestore, targetUid: string): Promise<number> {
  const snap = await db.collectionGroup("reviews").get();
  return snap.docs.filter((d) => d.id === targetUid && d.data().deleted !== true).length;
}

// GET /users/:uid/reviews — Profile page's Reviews tab. Same collectionGroup
// scan + filter-by-doc-id approach as getReviewCount above, just returning
// the reviews themselves (with movie title/poster joined in) instead of a
// count. `ref.parent.parent.id` is the review's movie — a synchronous
// property read on a real QueryDocumentSnapshot, not a network call.
// Anonymous reviews are only included when the caller IS the target (self
// always sees their own, even ones marked anonymous elsewhere) — showing an
// anonymous review on someone else's Reviews tab would defeat the entire
// point of marking it anonymous.
export async function getUserReviews(callerUid: string, targetUid: string): Promise<{ items: ProfileReviewEntry[] }> {
  const db = requireDb();
  const isSelf = callerUid === targetUid;
  const snap = await db.collectionGroup("reviews").get();
  const mine = snap.docs.filter((d) => d.id === targetUid && d.data().deleted !== true && (isSelf || !d.data().isAnonymous));

  const items = await Promise.all(
    mine.map(async (d): Promise<ProfileReviewEntry> => {
      const movieId = d.ref.parent.parent!.id;
      const movieSnap = await db.collection("movies").doc(movieId).get();
      const data = d.data();
      return {
        movieId,
        movieTitle: movieSnap.data()?.title ?? null,
        moviePoster: movieSnap.data()?.poster ?? null,
        rating: data.rating as number,
        reviewText: (data.reviewText as string | null) ?? null,
        isAnonymous: Boolean(data.isAnonymous),
        createdAt: toIso((data.createdAt as FirebaseFirestore.Timestamp | Date | undefined) ?? null)
      };
    })
  );

  items.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
  return { items };
}

// Overview tab's "Recent Activity" — reuses home.service.ts's own `activity`
// collection (written by userMovies.service.ts's watched/watchlist writes),
// just scoped to one uid instead of home's `following`-list fan-out. Gated
// by the same watchedListVisible flag as the `watched` preview above (the
// mockup's "private" scenario hides this section but not the stat counts).
async function getRecentActivity(db: FirebaseFirestore.Firestore, targetUid: string, displayName: string): Promise<ActivityItem[]> {
  const snap = await db.collection("activity").where("uid", "==", targetUid).orderBy("createdAt", "desc").limit(PROFILE_ACTIVITY_LIMIT).get();
  return Promise.all(
    snap.docs.map(async (d): Promise<ActivityItem> => {
      const data = d.data();
      const movieSnap = await db.collection("movies").doc(data.movieId).get();
      return {
        activityId: d.id,
        uid: targetUid,
        displayName,
        type: data.type,
        movieId: data.movieId,
        movieTitle: movieSnap.data()?.title ?? null,
        moviePoster: movieSnap.data()?.poster ?? null,
        createdAt: toIso(data.createdAt ?? null)
      };
    })
  );
}

// "Taste Match with you" card — reads the caller's own precomputed match
// score for this target, the same users/{uid}/tasteMatches/{otherUid} docs
// GET /users/me/tasteMatches (people.service.ts) reads; not recomputed here.
// null on your own profile, or when this pair hasn't been scored yet.
async function getTasteMatchScore(db: FirebaseFirestore.Firestore, callerUid: string, targetUid: string): Promise<number | null> {
  if (callerUid === targetUid) return null;
  const snap = await db.collection("users").doc(callerUid).collection("tasteMatches").doc(targetUid).get();
  return snap.exists ? ((snap.data()?.score as number) ?? null) : null;
}

// GET /users/:uid — api-contracts.md §11b, hld.md §5a/§8. The public-facing
// counterpart to GET /users/me: same privacy rules as getMovieWatchedBy
// (list-level users.listVisible + per-entry watched.visibility), just not
// scoped to the caller's `following` list here — profile info is public.
export async function getPublicProfile(callerUid: string, targetUid: string): Promise<PublicProfile> {
  const db = requireDb();
  const targetRef = db.collection("users").doc(targetUid);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new AppError("USER_NOT_FOUND", "No such user", 404);
  }
  const target = targetSnap.data() as UserDoc;

  const [followersSnap, followingSnap, allWatchedSnap, watchlistSnap] = await Promise.all([
    targetRef.collection("followers").get(),
    targetRef.collection("following").get(),
    targetRef.collection("watched").get(),
    targetRef.collection("watchlist").get()
  ]);

  let relationship: PublicProfile["relationship"];
  if (targetUid === callerUid) {
    relationship = "self";
  } else {
    const [followingCallerSnap, requestSnap] = await Promise.all([
      db.collection("users").doc(callerUid).collection("following").doc(targetUid).get(),
      targetRef.collection("followRequests").doc(callerUid).get()
    ]);
    relationship = followingCallerSnap.exists ? "following" : requestSnap.exists ? "pending" : "none";
  }

  // watchedListVisible reports the setting as-is (whether OTHERS can see this
  // list) — it stays false when the owner has turned it off, since that's a
  // real fact the frontend may want to show them (e.g. "this is currently
  // hidden from others"). It's just not what gates the actual data below:
  // the owner viewing their own profile always sees their own watched list
  // regardless (QA docs/qa/settings-bugs.md #2 — this toggle hides your list
  // from other visitors, not from you).
  const watchedListVisible = target.listVisible === true;
  const isSelf = targetUid === callerUid;
  const watchedDocsByRecency = [...allWatchedSnap.docs].sort((a, b) => toMillis(b.data().watchedAt) - toMillis(a.data().watchedAt));

  let watched: PublicProfile["watched"] = [];
  let recentActivity: ActivityItem[] = [];
  if (watchedListVisible || isSelf) {
    const publicEntries = watchedDocsByRecency.filter((d) => d.data().visibility !== "private").slice(0, PROFILE_WATCHED_PREVIEW);
    [watched, recentActivity] = await Promise.all([
      Promise.all(
        publicEntries.map(async (d) => {
          const movieSnap = await db.collection("movies").doc(d.id).get();
          return {
            movieId: d.id,
            title: movieSnap.data()?.title ?? null,
            poster: movieSnap.data()?.poster ?? null,
            watchedAt: toIso(d.data().watchedAt ?? null)
          };
        })
      ),
      getRecentActivity(db, targetUid, target.displayName)
    ]);
  }

  const [topGenres, reviewCount, tasteMatchScore] = await Promise.all([
    computeTopGenres(db, allWatchedSnap.docs),
    getReviewCount(db, targetUid),
    getTasteMatchScore(db, callerUid, targetUid)
  ]);

  return {
    uid: targetUid,
    displayName: target.displayName,
    username: target.username,
    photoURL: target.photoURL,
    favoriteGenres: target.favoriteGenres,
    preferredLanguages: target.preferredLanguages,
    followerCount: followersSnap.docs.length,
    followingCount: followingSnap.docs.length,
    relationship,
    watchedListVisible,
    watched,
    joinedAt: toIso(target.createdAt ?? null),
    watchedCount: allWatchedSnap.docs.length,
    watchlistCount: watchlistSnap.docs.length,
    reviewCount,
    topGenres,
    recentActivity,
    tasteMatchScore
  };
}
