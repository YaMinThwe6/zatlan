import type { Review } from "@zatlan/shared-types";
import { requireDb } from "../lib/firebaseAdmin.js";
import { AppError } from "../utils/AppError.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parseLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function toIso(value: FirebaseFirestore.Timestamp | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

export interface ReviewInput {
  rating?: unknown;
  isAnonymous?: unknown;
  reviewText?: unknown;
}

// PUT /movies/:movieId/reviews/me — hld.md §20. Submit and edit are the same
// operation: the review doc is keyed by the caller's own uid, so writing to
// it either creates it (first time) or overwrites it (editing) — no separate
// create-vs-update branch, no "find my existing review" query.
export async function upsertReview(uid: string, movieId: string, body: ReviewInput) {
  const rating = body.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new AppError("INVALID_RATING", "rating must be an integer from 1 to 5", 400);
  }
  if (typeof body.isAnonymous !== "boolean") {
    throw new AppError("INVALID_BODY", "isAnonymous (boolean) is required", 400);
  }
  const reviewText: string | null = typeof body.reviewText === "string" ? body.reviewText : null;

  const db = requireDb();
  const movieRef = db.collection("movies").doc(movieId);
  const movieSnap = await movieRef.get();
  if (!movieSnap.exists) {
    throw new AppError("MOVIE_NOT_FOUND", "No such movie", 404);
  }

  const userSnap = await db.collection("users").doc(uid).get();
  if (userSnap.data()?.status && userSnap.data()?.status !== "active") {
    throw new AppError("ACCOUNT_RESTRICTED", "Your account can't post reviews right now", 403);
  }

  const reviewRef = movieRef.collection("reviews").doc(uid);
  const now = new Date();

  const result = await db.runTransaction(async (tx) => {
    const [reviewSnap, freshMovieSnap] = await Promise.all([tx.get(reviewRef), tx.get(movieRef)]);
    const existing = reviewSnap.exists ? (reviewSnap.data() as { rating: number; deleted: boolean; createdAt: unknown }) : null;
    const isFirstTime = !existing || existing.deleted;

    const currentAggregate = (freshMovieSnap.data()?.zatlanRating as { sum: number; count: number } | undefined) ?? { sum: 0, count: 0 };
    const newAggregate = isFirstTime
      ? { sum: currentAggregate.sum + rating, count: currentAggregate.count + 1 }
      : { sum: currentAggregate.sum + (rating - existing!.rating), count: currentAggregate.count };

    const createdAt = isFirstTime ? now : existing!.createdAt;
    tx.set(reviewRef, {
      rating,
      reviewText,
      isAnonymous: body.isAnonymous,
      deleted: false,
      modRemovalCount: isFirstTime ? 0 : (reviewSnap.data()?.modRemovalCount ?? 0),
      createdAt,
      updatedAt: now
    });
    tx.update(movieRef, { zatlanRating: newAggregate });

    return { createdAt, updatedAt: now };
  });

  return {
    rating,
    reviewText,
    isAnonymous: body.isAnonymous as boolean,
    createdAt: toIso(result.createdAt as Date),
    updatedAt: toIso(result.updatedAt)
  };
}

// DELETE /movies/:movieId/reviews/me — hld.md §21: soft delete, reverses the
// review's contribution to the movie's aggregate rating.
export async function deleteReview(uid: string, movieId: string): Promise<void> {
  const db = requireDb();
  const movieRef = db.collection("movies").doc(movieId);
  const reviewRef = movieRef.collection("reviews").doc(uid);

  const result = await db.runTransaction(async (tx) => {
    const [reviewSnap, movieSnap] = await Promise.all([tx.get(reviewRef), tx.get(movieRef)]);
    if (!reviewSnap.exists || reviewSnap.data()?.deleted) {
      return "not_found" as const;
    }
    const rating = reviewSnap.data()?.rating as number;
    const currentAggregate = (movieSnap.data()?.zatlanRating as { sum: number; count: number } | undefined) ?? { sum: 0, count: 0 };
    tx.update(movieRef, {
      zatlanRating: { sum: Math.max(0, currentAggregate.sum - rating), count: Math.max(0, currentAggregate.count - 1) }
    });
    tx.update(reviewRef, { deleted: true, updatedAt: new Date() });
    return "deleted" as const;
  });

  if (result === "not_found") {
    throw new AppError("REVIEW_NOT_FOUND", "You haven't reviewed this movie", 404);
  }
}

// GET /movies/:movieId/reviews — public list, api-contracts.md §3. Anonymous
// reviews are redacted server-side (authorId/displayName: null) — never trust
// the client to hide this once it already has the data.
export async function listReviews(movieId: string, rawLimit: unknown, rawCursor: unknown) {
  const db = requireDb();
  const limit = parseLimit(rawLimit);
  const cursor = typeof rawCursor === "string" ? rawCursor : null;

  const col = db.collection("movies").doc(movieId).collection("reviews");
  let query: FirebaseFirestore.Query = col.where("deleted", "==", false).orderBy("createdAt", "desc").limit(limit);
  if (cursor) {
    const cursorSnap = await col.doc(cursor).get();
    if (cursorSnap.exists) query = query.startAfter(cursorSnap);
  }

  const snap = await query.get();
  const items: Review[] = await Promise.all(
    snap.docs.map(async (d): Promise<Review> => {
      const data = d.data();
      const isAnonymous = Boolean(data.isAnonymous);
      let displayName: string | null = null;
      if (!isAnonymous) {
        const userSnap = await db.collection("users").doc(d.id).get();
        displayName = userSnap.data()?.displayName ?? "Unknown";
      }
      return {
        authorId: isAnonymous ? null : d.id,
        displayName,
        rating: data.rating,
        reviewText: data.reviewText ?? null,
        isAnonymous,
        createdAt: toIso(data.createdAt),
        updatedAt: toIso(data.updatedAt)
      };
    })
  );
  const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;

  return { items, nextCursor };
}
