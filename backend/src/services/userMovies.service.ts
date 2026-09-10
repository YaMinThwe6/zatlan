import type { MovieStatus, MovieStatusLite, MyWatchlistEntry, MyWatchedEntry } from "@zatlan/shared-types";
import { requireDb } from "../lib/firebaseAdmin.js";
import { AppError } from "../utils/AppError.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parseLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

async function movieExists(movieId: string): Promise<boolean> {
  const db = requireDb();
  const snap = await db.collection("movies").doc(movieId).get();
  return snap.exists;
}

async function requireMovieExists(movieId: string): Promise<void> {
  if (!(await movieExists(movieId))) {
    throw new AppError("MOVIE_NOT_FOUND", "No such movie", 404);
  }
}

// Feeds Home's "Friends are watching" (home.service.ts's activity feed). Fire-and-forget
// from the caller's perspective — never blocks or fails the watchlist/watched write itself.
async function writeActivity(uid: string, type: "watched" | "watchlist_added", movieId: string): Promise<void> {
  const db = requireDb();
  await db.collection("activity").add({ uid, type, movieId, createdAt: new Date() });
}

function toIso(value: FirebaseFirestore.Timestamp | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

// ---------------------------------------------------------------------------
// Watchlist — api-contracts.md §2, hld.md §3, schema.md users/{uid}/watchlist
// ---------------------------------------------------------------------------

export async function addToWatchlist(uid: string, movieId: string): Promise<void> {
  await requireMovieExists(movieId);
  const db = requireDb();
  await db.collection("users").doc(uid).collection("watchlist").doc(movieId).set({ addedAt: new Date() });
  await writeActivity(uid, "watchlist_added", movieId);
}

export async function removeFromWatchlist(uid: string, movieId: string): Promise<void> {
  const db = requireDb();
  await db.collection("users").doc(uid).collection("watchlist").doc(movieId).delete();
}

// Movie title/poster joined in (one read per item, same tradeoff already
// accepted on getPublicProfile's watched preview) so the Profile page's
// Watchlist tab doesn't need a second round-trip per movie.
export async function listWatchlist(uid: string, rawLimit: unknown, cursor: string | null): Promise<{ items: MyWatchlistEntry[]; nextCursor: string | null }> {
  const db = requireDb();
  const limit = parseLimit(rawLimit);
  const col = db.collection("users").doc(uid).collection("watchlist");
  let query = col.orderBy("addedAt", "desc").limit(limit);
  if (cursor) {
    const cursorSnap = await col.doc(cursor).get();
    if (cursorSnap.exists) query = query.startAfter(cursorSnap);
  }
  const snap = await query.get();
  const items = await Promise.all(
    snap.docs.map(async (d): Promise<MyWatchlistEntry> => {
      const movieSnap = await db.collection("movies").doc(d.id).get();
      return {
        movieId: d.id,
        title: movieSnap.data()?.title ?? null,
        poster: movieSnap.data()?.poster ?? null,
        addedAt: toIso(d.data().addedAt)
      };
    })
  );
  const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;
  return { items, nextCursor };
}

// ---------------------------------------------------------------------------
// Watched — api-contracts.md §2, hld.md §5a, schema.md users/{uid}/watched
// ---------------------------------------------------------------------------

export async function markWatched(uid: string, movieId: string, rawVisibility: unknown, rawWatchedAt: unknown): Promise<void> {
  await requireMovieExists(movieId);
  const db = requireDb();
  const visibility = rawVisibility === "private" ? "private" : "public";
  const watchedAt = rawWatchedAt ? new Date(rawWatchedAt as string) : new Date();

  await db.collection("users").doc(uid).collection("watched").doc(movieId).set({ watchedAt, visibility });
  // hld.md §5a's per-entry privacy override applies here too — a private watched
  // entry must stay invisible to followers, not just to the general public.
  if (visibility === "public") {
    await writeActivity(uid, "watched", movieId);
  }
}

export async function unmarkWatched(uid: string, movieId: string): Promise<void> {
  const db = requireDb();
  await db.collection("users").doc(uid).collection("watched").doc(movieId).delete();
}

export async function updateWatchedVisibility(uid: string, movieId: string, visibility: unknown): Promise<void> {
  if (visibility !== "public" && visibility !== "private") {
    throw new AppError("INVALID_VISIBILITY", "visibility must be 'public' or 'private'", 400);
  }
  const db = requireDb();
  const ref = db.collection("users").doc(uid).collection("watched").doc(movieId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new AppError("NOT_WATCHED", "This movie is not marked as watched", 404);
  }
  await ref.update({ visibility });
}

// Same movie-join tradeoff as listWatchlist above — powers the Profile
// page's Watched tab.
export async function listWatched(uid: string, rawLimit: unknown, cursor: string | null): Promise<{ items: MyWatchedEntry[]; nextCursor: string | null }> {
  const db = requireDb();
  const limit = parseLimit(rawLimit);
  const col = db.collection("users").doc(uid).collection("watched");
  let query = col.orderBy("watchedAt", "desc").limit(limit);
  if (cursor) {
    const cursorSnap = await col.doc(cursor).get();
    if (cursorSnap.exists) query = query.startAfter(cursorSnap);
  }
  const snap = await query.get();
  const items = await Promise.all(
    snap.docs.map(async (d): Promise<MyWatchedEntry> => {
      const movieSnap = await db.collection("movies").doc(d.id).get();
      return {
        movieId: d.id,
        title: movieSnap.data()?.title ?? null,
        poster: movieSnap.data()?.poster ?? null,
        watchedAt: toIso(d.data().watchedAt),
        visibility: d.data().visibility
      };
    })
  );
  const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;
  return { items, nextCursor };
}

// ---------------------------------------------------------------------------
// Likes — api-contracts.md §2, data-model.md LikeEntry, schema.md users/{uid}/likes
// Toggle semantics: movies.likeCount is maintained transactionally, idempotent.
// ---------------------------------------------------------------------------

export async function likeMovie(uid: string, movieId: string): Promise<void> {
  const db = requireDb();
  const likeRef = db.collection("users").doc(uid).collection("likes").doc(movieId);
  const movieRef = db.collection("movies").doc(movieId);

  await db.runTransaction(async (tx) => {
    const [likeSnap, movieSnap] = await Promise.all([tx.get(likeRef), tx.get(movieRef)]);
    if (!movieSnap.exists) {
      throw new AppError("MOVIE_NOT_FOUND", "No such movie", 404);
    }
    if (likeSnap.exists) return; // already liked — idempotent no-op
    tx.set(likeRef, { createdAt: new Date() });
    tx.update(movieRef, { likeCount: (movieSnap.data()?.likeCount ?? 0) + 1 });
  });
}

export async function unlikeMovie(uid: string, movieId: string): Promise<void> {
  const db = requireDb();
  const likeRef = db.collection("users").doc(uid).collection("likes").doc(movieId);
  const movieRef = db.collection("movies").doc(movieId);

  await db.runTransaction(async (tx) => {
    const [likeSnap, movieSnap] = await Promise.all([tx.get(likeRef), tx.get(movieRef)]);
    if (!likeSnap.exists) return; // not liked — idempotent no-op
    tx.delete(likeRef);
    if (movieSnap.exists) {
      tx.update(movieRef, { likeCount: Math.max(0, (movieSnap.data()?.likeCount ?? 1) - 1) });
    }
  });
}

// ---------------------------------------------------------------------------
// Status bundle — Movie Detail needs the caller's relationship to one movie
// across watchlist/watched/likes/reviews to render its action bar; one
// request here instead of four.
// ---------------------------------------------------------------------------

// GET /users/me/movies/status?ids=a,b,c — the batch counterpart to
// getMovieStatus below, for a whole result set at once (search cards, the
// discover grid). Each id costs three subcollection point-reads; capped so a
// crafted `ids` list can't fan a single request out into thousands of reads.
// Reviews are deliberately not joined — the surfaces this feeds only badge
// watchlist/watched/liked, never render review text.
const MAX_STATUS_IDS = 60;

export async function getMovieStatuses(uid: string, rawIds: unknown): Promise<{ items: Record<string, MovieStatusLite> }> {
  const ids = [
    ...new Set(
      String(rawIds ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ].slice(0, MAX_STATUS_IDS);
  if (ids.length === 0) return { items: {} };

  const db = requireDb();
  const userRef = db.collection("users").doc(uid);
  const entries = await Promise.all(
    ids.map(async (movieId): Promise<[string, MovieStatusLite]> => {
      const [watchlistSnap, watchedSnap, likeSnap] = await Promise.all([
        userRef.collection("watchlist").doc(movieId).get(),
        userRef.collection("watched").doc(movieId).get(),
        userRef.collection("likes").doc(movieId).get()
      ]);
      return [movieId, { watchlisted: watchlistSnap.exists, watched: watchedSnap.exists, liked: likeSnap.exists }];
    })
  );

  return { items: Object.fromEntries(entries) };
}

export async function getMovieStatus(uid: string, movieId: string): Promise<MovieStatus> {
  const db = requireDb();
  const userRef = db.collection("users").doc(uid);
  const [watchlistSnap, watchedSnap, likeSnap, reviewSnap] = await Promise.all([
    userRef.collection("watchlist").doc(movieId).get(),
    userRef.collection("watched").doc(movieId).get(),
    userRef.collection("likes").doc(movieId).get(),
    db.collection("movies").doc(movieId).collection("reviews").doc(uid).get()
  ]);

  const reviewData = reviewSnap.exists ? reviewSnap.data() : null;
  return {
    watchlisted: watchlistSnap.exists,
    watched: watchedSnap.exists,
    liked: likeSnap.exists,
    review:
      reviewData && !reviewData.deleted
        ? {
            rating: reviewData.rating,
            reviewText: reviewData.reviewText ?? null,
            isAnonymous: reviewData.isAnonymous,
            createdAt: toIso(reviewData.createdAt),
            updatedAt: toIso(reviewData.updatedAt)
          }
        : null
  };
}
