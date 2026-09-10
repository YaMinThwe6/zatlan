import type { Greeting, ActivityItem, FriendsRecommendationItem } from "@zatlan/shared-types";
import { requireDb } from "../lib/firebaseAdmin.js";
import { pickQuoteForMovieIds, pickRandomQuote } from "../data/movieQuotes.js";

const MAX_FOLLOWING_FOR_FEED = 30; // Firestore "in" query cap, also our fan-out bound below
const DEFAULT_ACTIVITY_LIMIT = 12;
const FRIENDS_RECOMMENDATION_LIMIT = 10;

function toIso(value: FirebaseFirestore.Timestamp | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

// GET /home/greeting — hld.md §6/§13's movie-dialogue greeting. Prefers a quote
// from a movie the caller has actually watched (this is what makes a brand-new
// user's very first Home visit already feel personalized, per §13's note); falls
// back to a random pick from the full curated pool otherwise.
export async function getGreeting(uid: string): Promise<Greeting> {
  const db = requireDb();
  const watchedSnap = await db.collection("users").doc(uid).collection("watched").get();
  const watchedIds = watchedSnap.docs.map((d) => d.id);
  const matched = pickQuoteForMovieIds(watchedIds);
  const picked = matched ?? pickRandomQuote();

  return {
    quote: picked.quote,
    attribution: picked.attribution,
    source: matched ? "watched" : "random"
  };
}

// GET /home/activity — "Friends are watching". Fans out from the caller's own
// (bounded) following list, same shape as §5a's "people who watched this movie" —
// never a global feed, only people the caller actually follows. Reviews/ratings
// don't exist yet, so activity types are currently limited to what real write
// paths produce: "watched" and "watchlist_added" (written in userMovies.ts).
export async function getActivity(uid: string): Promise<{ items: ActivityItem[] }> {
  const db = requireDb();
  const followingSnap = await db.collection("users").doc(uid).collection("following").get();
  const followingIds = followingSnap.docs.map((d) => d.id).slice(0, MAX_FOLLOWING_FOR_FEED);

  if (followingIds.length === 0) {
    return { items: [] };
  }

  const snap = await db
    .collection("activity")
    .where("uid", "in", followingIds)
    .orderBy("createdAt", "desc")
    .limit(DEFAULT_ACTIVITY_LIMIT)
    .get();

  const items: ActivityItem[] = await Promise.all(
    snap.docs.map(async (d): Promise<ActivityItem> => {
      const data = d.data();
      const [userSnap, movieSnap] = await Promise.all([
        db.collection("users").doc(data.uid).get(),
        db.collection("movies").doc(data.movieId).get()
      ]);
      return {
        activityId: d.id,
        uid: data.uid,
        displayName: userSnap.data()?.displayName ?? "Unknown",
        type: data.type,
        movieId: data.movieId,
        movieTitle: movieSnap.data()?.title ?? null,
        moviePoster: movieSnap.data()?.poster ?? null,
        createdAt: toIso(data.createdAt)
      };
    })
  );

  return { items };
}

// GET /home/friends-recommendations — "Because your friends watched these" (hld.md
// §6 implementation note, mockup-driven like greeting/activity above). Deliberately
// has no trending/cold-start fallback: an empty `following` list returns no items
// rather than a global feed, and the frontend hides the whole section in that case
// (same "gate, don't fabricate" choice §5b's taste matches made) — this only makes
// sense once the caller actually has connections.
//
// Signal is followed people's full `watched` history, not just the `activity` log
// (that's capped to the most recent DEFAULT_ACTIVITY_LIMIT events and exists for a
// different purpose — a feed, not a ranking source). Ranked by how many followed
// people watched each title, excluding anything the caller has already watched or
// already has on their watchlist. Respects §5a's per-entry privacy override, same
// as `getActivity` above: a followed person's `watched` entry marked
// `visibility: "private"` never counts here either, even though nothing here is
// attributed to a name.
export async function getFriendsRecommendations(uid: string): Promise<{ items: FriendsRecommendationItem[] }> {
  const db = requireDb();
  const userRef = db.collection("users").doc(uid);
  const [followingSnap, watchedSnap, watchlistSnap] = await Promise.all([
    userRef.collection("following").get(),
    userRef.collection("watched").get(),
    userRef.collection("watchlist").get()
  ]);
  const followingIds = followingSnap.docs.map((d) => d.id).slice(0, MAX_FOLLOWING_FOR_FEED);
  if (followingIds.length === 0) return { items: [] };

  const excludeIds = new Set<string>([...watchedSnap.docs.map((d) => d.id), ...watchlistSnap.docs.map((d) => d.id)]);

  const friendsWatchedSnaps = await Promise.all(
    followingIds.map((followedUid) => db.collection("users").doc(followedUid).collection("watched").get())
  );

  const watchedByCount = new Map<string, number>();
  for (const snap of friendsWatchedSnaps) {
    for (const doc of snap.docs) {
      if (excludeIds.has(doc.id)) continue;
      if (doc.data()?.visibility === "private") continue;
      watchedByCount.set(doc.id, (watchedByCount.get(doc.id) ?? 0) + 1);
    }
  }

  const ranked = [...watchedByCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, FRIENDS_RECOMMENDATION_LIMIT);
  const movieSnaps = await Promise.all(ranked.map(([movieId]) => db.collection("movies").doc(movieId).get()));

  const items: FriendsRecommendationItem[] = ranked.map(([movieId, watchedByCount], i) => {
    const data = movieSnaps[i].data() ?? {};
    return {
      movieId,
      title: data.title ?? "",
      poster: data.poster ?? null,
      year: data.year ?? null,
      genres: data.genres ?? [],
      voteAverage: data.voteAverage ?? 0,
      watchedByCount
    };
  });

  return { items };
}
