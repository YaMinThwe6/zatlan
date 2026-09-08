import type { RecommendationItem, SimilarMovieItem } from "@binj/shared-types";
import { requireDb } from "../lib/firebaseAdmin.js";
import { AppError } from "../utils/AppError.js";

const CANDIDATE_POOL = 30;
const RESULT_LIMIT = 10;
const MAX_GENRES = 10; // Firestore array-contains-any caps at 10 values
const SIMILAR_MOVIES_LIMIT = 6;

// Heuristic, not a learned model: 70% weight on how much of the caller's preferred
// genres this movie covers, 30% weight on its own TMDB rating. Only meaningful when
// there's an actual preference signal — the trending/cold-start fallback has nothing
// to score against, so those items carry matchScore: null (frontend shows the rating
// alone in that case, no "% match" badge).
function computeMatchScore(movieGenres: string[], voteAverage: number, preferredGenres: string[]): number | null {
  if (preferredGenres.length === 0) return null;
  const preferredSet = new Set(preferredGenres);
  const overlap = movieGenres.filter((g) => preferredSet.has(g)).length;
  const genreRatio = Math.min(1, overlap / preferredGenres.length);
  return Math.round(genreRatio * 70 + (voteAverage / 10) * 30);
}

function toSummary(id: string, data: FirebaseFirestore.DocumentData, preferredGenres: string[]): RecommendationItem {
  const genres = (data.genres as string[] | undefined) ?? [];
  const voteAverage = data.voteAverage ?? 0;
  return {
    movieId: id,
    title: data.title,
    poster: data.poster ?? null,
    year: data.year ?? null,
    genres,
    voteAverage,
    matchScore: computeMatchScore(genres, voteAverage, preferredGenres)
  };
}

// GET /recommendations — hld.md §6: content-based, live request-time computation,
// cold-start users get a trending fallback transparently. api-contracts.md §6.
export async function getRecommendations(uid: string): Promise<{ items: RecommendationItem[] }> {
  const db = requireDb();
  const userRef = db.collection("users").doc(uid);
  const [watchedSnap, watchlistSnap, userSnap] = await Promise.all([
    userRef.collection("watched").get(),
    userRef.collection("watchlist").get(),
    userRef.get()
  ]);

  const excludeIds = new Set<string>([
    ...watchedSnap.docs.map((d) => d.id),
    ...watchlistSnap.docs.map((d) => d.id)
  ]);

  // Preferred-genre signal: frequency across watched movies first (hld.md §6's
  // "highly-rated/watched" — reviews don't exist yet, so watched history is the
  // available proxy); falls back to onboarding's favoriteGenres when there's no
  // watch history yet, before finally falling back to trending (true cold start).
  let preferredGenres: string[] = [];
  if (watchedSnap.docs.length > 0) {
    const watchedMovies = await Promise.all(watchedSnap.docs.map((d) => db.collection("movies").doc(d.id).get()));
    const genreCounts = new Map<string, number>();
    for (const snap of watchedMovies) {
      for (const genre of (snap.data()?.genres as string[] | undefined) ?? []) {
        genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
      }
    }
    preferredGenres = [...genreCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_GENRES)
      .map(([genre]) => genre);
  } else {
    preferredGenres = ((userSnap.data()?.favoriteGenres as string[] | null) ?? []).slice(0, MAX_GENRES);
  }

  // Independent of the genre-derivation branch above (watch history vs
  // favoriteGenres) — preferredLanguages has no "derive from watch history"
  // equivalent yet, it's just the flat onboarding pick.
  const preferredLanguages = ((userSnap.data()?.preferredLanguages as string[] | null) ?? []).slice(0, MAX_GENRES);

  let candidates: FirebaseFirestore.QuerySnapshot;
  // Language-primary when a language preference exists, even alongside a
  // genre signal — real reported bug: "Top picks for you" used to ignore
  // preferredLanguages entirely, and the local "movies" collection skews
  // toward whatever's been searched/opened most (in practice, English), so a
  // genre-first top-CANDIDATE_POOL-by-voteAverage slice could easily contain
  // zero matches for someone who picked a narrower language, even when the
  // collection has plenty — just not within that slice. Same fix as
  // onboarding.service.ts's watched-candidates query.
  if (preferredLanguages.length > 0) {
    candidates = await db
      .collection("movies")
      .where("originalLanguage", "in", preferredLanguages)
      .orderBy("voteAverage", "desc")
      .limit(CANDIDATE_POOL)
      .get();
  } else if (preferredGenres.length > 0) {
    candidates = await db
      .collection("movies")
      .where("genres", "array-contains-any", preferredGenres)
      .orderBy("voteAverage", "desc")
      .limit(CANDIDATE_POOL)
      .get();
  } else {
    // True cold start — no watch history, no favoriteGenres, no preferredLanguages — trending fallback.
    candidates = await db.collection("movies").orderBy("voteAverage", "desc").limit(CANDIDATE_POOL).get();
  }

  let filtered = candidates.docs.filter((d) => !excludeIds.has(d.id));
  // When both were given, the genre filter is applied in-app on top of the
  // language-primary query above — Firestore can't combine an `in` filter
  // with array-contains-any on a different field in one query.
  if (preferredLanguages.length > 0 && preferredGenres.length > 0) {
    filtered = filtered.filter((d) => ((d.data().genres as string[] | undefined) ?? []).some((g) => preferredGenres.includes(g)));
  }

  const items = filtered.slice(0, RESULT_LIMIT).map((d) => toSummary(d.id, d.data(), preferredGenres));

  return { items };
}

// GET /movies/:movieId/similar — "Similar taste picks for you" (movie detail's
// right rail, mockup-driven like home.service.ts's friends-recommendations).
// Movie-to-movie, not the user-preference content-based scoring above: same
// array-contains-any-on-genres query getRecommendations already uses, just
// keyed off the movie being viewed instead of the caller's own history, and
// with no matchScore (there's no user preference here to score against).
// Public, unauthenticated — same as GET /movies/:movieId itself.
export async function getSimilarMovies(movieId: string): Promise<{ items: SimilarMovieItem[] }> {
  const db = requireDb();
  const movieSnap = await db.collection("movies").doc(movieId).get();
  if (!movieSnap.exists) {
    throw new AppError("MOVIE_NOT_FOUND", "No such movie", 404);
  }

  const genres = ((movieSnap.data()?.genres as string[] | undefined) ?? []).slice(0, MAX_GENRES);
  if (genres.length === 0) return { items: [] };

  // +1 over the result limit: the source movie itself always matches its own
  // genres and would otherwise crowd out a genuine "different movie" result
  // when it's filtered out below.
  const candidates = await db
    .collection("movies")
    .where("genres", "array-contains-any", genres)
    .orderBy("voteAverage", "desc")
    .limit(SIMILAR_MOVIES_LIMIT + 1)
    .get();

  const items: SimilarMovieItem[] = candidates.docs
    .filter((d) => d.id !== movieId)
    .slice(0, SIMILAR_MOVIES_LIMIT)
    .map((d) => {
      const data = d.data();
      return {
        movieId: d.id,
        title: data.title,
        poster: data.poster ?? null,
        year: data.year ?? null,
        voteAverage: data.voteAverage ?? 0
      };
    });

  return { items };
}
