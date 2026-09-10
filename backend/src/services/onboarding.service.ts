import type { MovieCandidate, CelebritySuggestion } from "@zatlan/shared-types";
import { requireDb } from "../lib/firebaseAdmin.js";
import { discoverMovies } from "../lib/tmdb.js";
import { getMovieDetail } from "./movies.service.js";

const CANDIDATE_LIMIT = 30;
const MAX_ARRAY_CONTAINS_ANY = 10; // Firestore's cap

function parseListParam(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_ARRAY_CONTAINS_ANY);
}

// A page number cursor for the genre/language-filtered TMDB Discover paging
// below — opaque to the frontend (it just round-trips whatever nextCursor it
// was handed), but it's literally the next /discover/movie page to fetch.
function parseCursor(raw: unknown): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number(raw.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

// At most this many backfills run at once, process-wide — not per call. A
// scroll session can trigger this dozens of times in a row (one per page),
// and without a shared cap, each of those unboundedly fires off ~20 more
// full TMDB detail fetches (several sub-requests each) plus Firestore
// writes; those pile up faster than they drain and end up starving out
// completely unrelated requests on the same server (a plain username save
// was seen hanging behind the backlog). A real getMovieDetail() call for an
// already-cached movie is cheap (one Firestore read, no TMDB round-trip) —
// this queue only meaningfully throttles genuinely new movies.
const BACKFILL_CONCURRENCY = 4;
const backfillQueue: string[] = [];
let backfillWorkersRunning = 0;

function runBackfillWorker(): void {
  const movieId = backfillQueue.shift();
  if (movieId === undefined) {
    backfillWorkersRunning--;
    return;
  }
  getMovieDetail(movieId)
    .catch(() => {})
    .finally(runBackfillWorker);
}

// Fire-and-forget: pulls each discovered movie through getMovieDetail's
// existing fetch-and-upsert path so it becomes exactly as locally-cached and
// search-indexed as one someone opened by hand — but NOT awaited by either
// caller below. Awaiting a full TMDB detail fetch (credits/videos/watch-
// providers, several sub-requests) for every item on a scroll page was the
// original bug reported: correct data, but 15-20+ seconds per page with the
// UI showing nothing but a static "Loading more…" the whole time. Both
// callers only need what discoverMovies() already returned in ONE request;
// this just grows the local pool for next time, in the background, bounded
// by BACKFILL_CONCURRENCY above.
function backfillInBackground(movieIds: string[]): void {
  backfillQueue.push(...movieIds);
  while (backfillWorkersRunning < BACKFILL_CONCURRENCY && backfillQueue.length > 0) {
    backfillWorkersRunning++;
    runBackfillWorker();
  }
}

// Cheap local-only lookup — no TMDB call — for celebrity-suggestions' cursor
// paging below: cast/crew isn't in a Discover result at all (only a full
// detail fetch has credits), so a newly-discovered movie's people can't be
// known synchronously without paying the same latency backfillInBackground
// is deliberately avoiding. A movie already backfilled (by a past visit here,
// by watched-candidates' own background backfill, or by someone opening its
// detail page directly) answers instantly instead.
async function getCachedCredits(movieId: string): Promise<CreditedMovie | null> {
  const db = requireDb();
  const snap = await db.collection("movies").doc(movieId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data?.genres === undefined) return null; // not yet full-detail-fetched
  return { cast: data.cast, crew: data.crew };
}

// GET /onboarding/watched-candidates — api-contracts.md §11, hld.md §13.
// Filtered by the genres/languages the user just picked in the prior onboarding
// steps; trending fallback when neither is given. Unlike /recommendations (§6),
// nothing gets excluded — the whole point is candidates *to* mark as watched.
//
// Paging (redesigned for infinite scroll): the first page (no cursor) is the
// original fast local-index query below, untouched. Every page after that
// comes straight from discoverMovies()'s own response — genres, language,
// and vote average are already right there in a Discover result, so this
// responds off ONE TMDB request instead of waiting on a full detail fetch
// (credits/videos/watch-providers) per movie. Full detail still gets pulled
// in — just in the background (backfillInBackground), so it doesn't block
// this response the way it used to.
export async function getWatchedCandidates(
  rawGenres: unknown,
  rawLanguages: unknown,
  rawCursor?: unknown
): Promise<{ items: MovieCandidate[]; nextCursor: string | null }> {
  const genres = parseListParam(rawGenres);
  const languages = parseListParam(rawLanguages);
  const cursor = parseCursor(rawCursor);

  if (cursor !== null) {
    const { items: discovered, totalPages } = await discoverMovies(genres, languages, cursor);
    // discoverMovies() (tmdb.ts) already guarantees language-correctness
    // itself now — it fans out one request per language and interleaves when
    // more than one is chosen, rather than a single unfiltered request this
    // used to have to cross-check in-app afterward.
    const items: MovieCandidate[] = discovered.map((d) => ({
      movieId: d.movieId,
      title: d.title,
      poster: d.poster,
      year: d.year,
      genres: d.genres,
      originalLanguage: d.originalLanguage,
      voteAverage: d.voteAverage
    }));

    backfillInBackground(discovered.map((d) => d.movieId));
    return { items, nextCursor: cursor < totalPages ? String(cursor + 1) : null };
  }

  const db = requireDb();
  let candidates: FirebaseFirestore.QuerySnapshot;
  // Language-primary when a language preference exists, even alongside a
  // genre pick — real reported bug: the local "movies" collection skews
  // toward whatever's been searched/opened most (in practice, English), so a
  // genre-first query's top-CANDIDATE_LIMIT-by-voteAverage slice can easily
  // contain zero matches for a narrower language like Tamil, even when the
  // collection has plenty — just not within that slice. Filtering by
  // language in Firestore itself (an exact `in` query, not a post-hoc in-app
  // check) guarantees the pool is language-correct before genre ever narrows
  // it further.
  if (languages.length > 0) {
    candidates = await db
      .collection("movies")
      .where("originalLanguage", "in", languages)
      .orderBy("voteAverage", "desc")
      .limit(CANDIDATE_LIMIT)
      .get();
  } else if (genres.length > 0) {
    candidates = await db
      .collection("movies")
      .where("genres", "array-contains-any", genres)
      .orderBy("voteAverage", "desc")
      .limit(CANDIDATE_LIMIT)
      .get();
  } else {
    candidates = await db.collection("movies").orderBy("voteAverage", "desc").limit(CANDIDATE_LIMIT).get();
  }

  // Discover-backed cursor pages above filter unreleased movies out via
  // primary_release_date.lte (tmdb.ts) — this local index has no live TMDB
  // call to lean on, so it needs its own check against the releaseDate
  // movies.service.ts stores on every full-detail fetch. A doc with no
  // releaseDate at all is one only ever seeded by the lightweight search-index
  // path (never full-detail-fetched) rather than actually unreleased, so it's
  // let through rather than excluded on missing data.
  const now = Date.now();
  function isReleased(data: FirebaseFirestore.DocumentData): boolean {
    if (typeof data.releaseDate !== "string") return true;
    const parsed = Date.parse(data.releaseDate);
    return Number.isNaN(parsed) || parsed <= now;
  }

  let items: MovieCandidate[] = candidates.docs
    .filter((d) => isReleased(d.data()))
    .map((d) => {
      const data = d.data();
      return {
        movieId: d.id,
        title: data.title,
        poster: data.poster ?? null,
        year: data.year ?? null,
        genres: data.genres ?? [],
        originalLanguage: data.originalLanguage ?? null,
        voteAverage: data.voteAverage ?? 0
      };
    });

  // When both were given, the genre filter is applied in-app on top of the
  // language-primary query above — Firestore can't combine an `in` filter
  // with array-contains-any on a different field in one query.
  if (genres.length > 0 && languages.length > 0) {
    items = items.filter((m) => (m.genres as string[]).some((g) => genres.includes(g)));
  }

  // Always offer to keep scrolling: /discover/movie works fine unfiltered too
  // (page 2 is thus a genuine paginated fallback even in the "trending, no
  // genre/language chosen" case), and its catalog is large enough that
  // checking totalPages up front here isn't worth another round-trip.
  return { items, nextCursor: "2" };
}

interface CreditedMovie {
  cast?: { personId: string; name: string; photo: string | null }[];
  crew?: { personId: string; name: string; photo: string | null }[];
}

// Shared by both the watch-history ranking below and the genre/language
// discover-page ranking — same "how many of these movies do they appear in"
// scoring either way, just fed a different source movie list.
function rankPeopleFromMovies(movies: CreditedMovie[]): CelebritySuggestion[] {
  const appearances = new Map<string, number>();
  const personInfo = new Map<string, { name: string; photo: string | null }>();
  for (const movie of movies) {
    const credited = [...(movie.cast ?? []), ...(movie.crew ?? [])];
    const uniquePersonIds = new Set(credited.map((c) => c.personId));
    for (const personId of uniquePersonIds) {
      appearances.set(personId, (appearances.get(personId) ?? 0) + 1);
      if (!personInfo.has(personId)) {
        const c = credited.find((x) => x.personId === personId)!;
        personInfo.set(personId, { name: c.name, photo: c.photo });
      }
    }
  }
  return [...appearances.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([personId, appearsIn]) => ({ personId, name: personInfo.get(personId)!.name, photo: personInfo.get(personId)!.photo, appearsIn }));
}

// GET /onboarding/celebrity-suggestions — api-contracts.md §5, hld.md §13.
// Page 1 (no cursor) ranks cast/crew from the caller's already-saved watched
// movies, unchanged — the strongest, most personalized signal when it exists.
// Every page after that walks the same genre/language Discover paging
// watched-candidates uses — not just for "keep scrolling", but because watch
// history being thin or empty (Watched is skippable, and this step used to
// have zero fallback for that) previously meant this whole step rendered
// nothing; genre/language gives it something to suggest regardless.
//
// Unlike watched-candidates, this genuinely needs cast/crew — which a
// Discover result doesn't carry at all, only a full detail fetch does. Rather
// than block the response on that (the actual latency bug this whole cursor
// design had), a discovered movie only contributes here if it's *already*
// locally cached (getCachedCredits — a plain Firestore read, no TMDB call);
// anything not yet cached is skipped for this page and backfilled in the
// background instead, ready by the next visit or the next scroll.
export async function getCelebritySuggestions(
  uid: string,
  rawGenres: unknown,
  rawLanguages: unknown,
  rawCursor?: unknown
): Promise<{ items: CelebritySuggestion[]; nextCursor: string | null }> {
  const genres = parseListParam(rawGenres);
  const languages = parseListParam(rawLanguages);
  const cursor = parseCursor(rawCursor);

  if (cursor !== null) {
    const { items: discovered, totalPages } = await discoverMovies(genres, languages, cursor);
    const cached = await Promise.all(discovered.map((d) => getCachedCredits(d.movieId)));
    const uncachedIds = discovered.filter((_, i) => cached[i] === null).map((d) => d.movieId);
    backfillInBackground(uncachedIds);

    const movies = cached.filter((c): c is CreditedMovie => c !== null);
    return { items: rankPeopleFromMovies(movies), nextCursor: cursor < totalPages ? String(cursor + 1) : null };
  }

  const db = requireDb();
  const watchedSnap = await db.collection("users").doc(uid).collection("watched").get();

  let items: CelebritySuggestion[] = [];
  if (watchedSnap.docs.length > 0) {
    const movieSnaps = await Promise.all(watchedSnap.docs.map((d) => db.collection("movies").doc(d.id).get()));
    items = rankPeopleFromMovies(movieSnaps.map((s) => (s.data() ?? {}) as CreditedMovie)).slice(0, 20);
  }

  // Discover-page 1 (cursor="1") is next regardless of whether watch-history
  // produced anything — see the comment above.
  return { items, nextCursor: "1" };
}
