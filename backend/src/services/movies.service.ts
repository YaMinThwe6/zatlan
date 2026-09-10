import type { MovieDetail, MovieSummary } from "@zatlan/shared-types";
import { db } from "../lib/firebaseAdmin.js";
import {
  fetchMovieDetails,
  searchMovies as tmdbSearchMovies,
  getRecentMovies as tmdbGetRecentMovies,
  discoverMovies as tmdbDiscoverMovies,
  type TmdbMovie
} from "../lib/tmdb.js";
import { buildSearchTerms, significantWords } from "../lib/searchIndex.js";
import { rankCandidate } from "../lib/searchRanking.js";
import { AppError } from "../utils/AppError.js";

// A movie that's never been rated/liked has no reason to have zatlanRating/likeCount
// actually written in Firestore — this normalizes the response so the client never
// has to special-case "field is missing" vs. "field is zero".
function withRatingDefaults(data: FirebaseFirestore.DocumentData): MovieDetail {
  return {
    ...data,
    zatlanRating: data.zatlanRating ?? { sum: 0, count: 0 },
    likeCount: data.likeCount ?? 0
  } as MovieDetail;
}

// cache (not yet built, see docs/schema.md §28) → Firestore → TMDB, hld.md §2
export async function getMovieDetail(movieId: string): Promise<MovieDetail> {
  try {
    let existingData: FirebaseFirestore.DocumentData | undefined;
    if (db) {
      const snap = await db.collection("movies").doc(movieId).get();
      if (snap.exists) {
        existingData = snap.data()!;
        // hld.md §18's search index seeding (seedSearchCatalog.ts,
        // refreshRecentMovies.ts, and a live search's upsertSearchable) only
        // ever writes title/poster/year/titleSearchTerms — never the full
        // detail fields below. `genres` is always written (possibly []) by
        // the full-detail path this function itself runs, so its absence is
        // the signal this doc still needs backfilling from TMDB rather than
        // being served as-is (which would hand the frontend a movie missing
        // genres/cast/crew/synopsis/runtime/etc.).
        if (existingData.genres !== undefined) {
          return withRatingDefaults(existingData);
        }
      }
    }

    const movie: TmdbMovie = await fetchMovieDetails(movieId);
    const { credits, ...movieDoc } = movie;

    // Preserve any rating aggregate a lightweight doc already accumulated
    // rather than resetting it — backfilling detail shouldn't erase real data.
    const toStore = {
      ...movieDoc,
      zatlanRating: existingData?.zatlanRating ?? { sum: 0, count: 0 },
      ...(existingData?.likeCount !== undefined ? { likeCount: existingData.likeCount } : {}),
      streamingLastFetched: new Date(),
      lastFetched: new Date(),
      // A movie discovered via detail view (someone opened it directly, not
      // via search) becomes locally searchable too — hld.md §18's local
      // index isn't only populated by searching.
      titleSearchTerms: buildSearchTerms(movieDoc.title)
    };

    if (db) {
      await db.collection("movies").doc(movieId).set(toStore);

      // Upsert people/{personId} for everyone credited on this movie — lazy
      // "create on first need" ingestion, same as the movie itself (schema.md §1).
      const batch = db.batch();
      for (const person of credits) {
        const ref = db.collection("people").doc(person.personId);
        batch.set(
          ref,
          {
            name: person.name,
            photo: person.photo,
            knownForDepartment: person.knownForDepartment,
            popularity: person.popularity,
            // GET /people/search's index (people.service.ts) — same helper,
            // same array-contains-any pattern movies.titleSearchTerms uses.
            nameSearchTerms: buildSearchTerms(person.name),
            lastFetched: new Date()
          },
          { merge: true }
        );
      }
      if (credits.length > 0) await batch.commit();
    }

    return withRatingDefaults(toStore);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("TMDB_UPSTREAM_ERROR", "Failed to fetch movie details", 502);
  }
}

// GET /movies/recent — powers the public Discover page's "recently released"
// section (the default browse-without-a-query view).
//
// Reads discover/recentMovies, refreshed periodically by
// scripts/refreshRecentMovies.ts (a real Cloud Scheduler job is the eventual
// upgrade path, same shortcut as §5b's taste matches) — falls back to a live
// TMDB call when that cache doc doesn't exist yet (before the script has ever
// run) or Firestore isn't configured, so this endpoint works either way
// rather than depending on the script having been run first.
export async function getRecentMoviesService(): Promise<{ items: MovieSummary[] }> {
  try {
    if (db) {
      const snap = await db.collection("discover").doc("recentMovies").get();
      if (snap.exists) {
        return { items: (snap.data()?.items as MovieSummary[] | undefined) ?? [] };
      }
    }
    const items = await tmdbGetRecentMovies();
    return { items };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("TMDB_UPSTREAM_ERROR", "Failed to fetch recent movies", 502);
  }
}

// Browse-by-facet catalog — the frontend's chip (`Browse Korean films`) only
// ever sends a value from this same list, but the endpoint is public and
// validates its own input rather than trusting the caller. Third copy of this
// taxonomy in the tree (frontend onboarding constants.ts, tmdb.ts's
// GENRE_NAME_TO_ID) — kept in sync by hand, same call tmdb.ts already made
// ("hardcoded rather than fetched, since it practically never changes").
const KNOWN_GENRES = new Set([
  "Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family",
  "Fantasy", "History", "Horror", "Music", "Mystery", "Romance", "Science Fiction", "Thriller", "War", "Western"
]);
const KNOWN_LANGUAGES = new Set(["en", "hi", "ta", "te", "ml", "kn", "bn", "pa", "ko", "ja", "zh", "th", "es", "fr", "ru"]);
const DISCOVER_MAX_PAGE = 500; // TMDB's /discover hard cap — asking past it just 422s

// GET /discover/movies?genre=&language=&page= — a browse-by-facet listing,
// distinct from GET /search/movies (that's text-relevance ranked; this is
// "show me everything in this genre/language, popularity-ordered"). Public,
// same as search. Backed by TMDB's own paginated /discover/movie
// (tmdb.ts's discoverMovies), and every page's results are upserted into the
// local index — same lightweight docs a live search writes — so a card the
// user taps opens straight from Firestore instead of a cold TMDB fetch.
export async function discoverMoviesService(
  rawGenre: unknown,
  rawLanguage: unknown,
  rawPage: unknown
): Promise<{ items: MovieSummary[]; page: number; totalPages: number }> {
  const genre = typeof rawGenre === "string" && KNOWN_GENRES.has(rawGenre.trim()) ? rawGenre.trim() : null;
  const language = typeof rawLanguage === "string" && KNOWN_LANGUAGES.has(rawLanguage.trim()) ? rawLanguage.trim() : null;

  if (!genre && !language) {
    throw new AppError("MISSING_FILTER", "A known genre or language is required", 400);
  }

  const parsedPage = Math.floor(Number(rawPage));
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.min(parsedPage, DISCOVER_MAX_PAGE) : 1;

  try {
    const { items, totalPages } = await tmdbDiscoverMovies(genre ? [genre] : [], language ? [language] : [], page);
    const summaries: MovieSummary[] = items.map((m) => ({ movieId: m.movieId, title: m.title, poster: m.poster, year: m.year }));
    await upsertSearchable(summaries);
    return { items: summaries, page, totalPages: Math.min(totalPages, DISCOVER_MAX_PAGE) };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("TMDB_UPSTREAM_ERROR", "Failed to load discover results", 502);
  }
}

const MAX_QUERY_WORDS = 30; // Firestore's array-contains-any cap
const RESULTS_TOP_N = 20;

interface SearchCandidate {
  title: string;
  poster: string | null;
  year: number | null;
  popularitySignal: number;
}

// Writes TMDB's live-search results into Firestore (lightweight — title/
// poster/year/titleSearchTerms, not a full detail-ingestion) so the local
// index keeps growing over time, independent of whether it already had a
// match for this particular search.
async function upsertSearchable(items: MovieSummary[]): Promise<void> {
  if (!db || items.length === 0) return;
  const batch = db.batch();
  for (const item of items) {
    const ref = db.collection("movies").doc(item.movieId);
    batch.set(ref, { title: item.title, poster: item.poster, year: item.year, titleSearchTerms: buildSearchTerms(item.title) }, { merge: true });
  }
  await batch.commit();
}

// GET /search/movies — hld.md §18 (redesigned 2026-08-31). The local index
// and live TMDB are queried together on *every* search — never a cascade
// where TMDB only gets asked if the local index came up empty — then merged
// into one pool, deduplicated by movieId, and scored through the same
// searchRanking.ts pass so a same-titled duplicate that only TMDB knows
// about can't get buried behind a weaker local match, and vice versa:
//   - Local index: Firestore titleSearchTerms array-contains-any <query
//     words>, catching exact/prefix/token matches and precomputed
//     single-typo variants (searchIndex.ts unions both into that field).
//     TMDB itself has no typo tolerance at all — confirmed directly — so
//     this is the only source of that.
//   - Live TMDB: catches everything the local index doesn't have yet at
//     all, including every version of a same-titled movie (all returned in
//     one call, no completeness tracking needed) — and refreshes stale
//     local data when both sides return the same movie.
// A live TMDB failure degrades to local-only results rather than failing
// the whole search, as long as the local index has something to offer.
//
// The previous design's second tier — a real-time Levenshtein scan over up
// to 2000 local docs, run only when the indexed lookup found nothing — is
// dropped. It existed to squeeze extra value from the local catalog before
// giving up and asking TMDB; now that TMDB is asked unconditionally, its
// job is redundant and its cost (scanning/scoring up to 2000 docs) would
// otherwise run on every search instead of only a rare empty-tier-1 case.
export async function searchMoviesService(query: string): Promise<{ items: MovieSummary[]; nextCursor: null }> {
  if (!query) {
    throw new AppError("MISSING_QUERY", "q query param is required", 400);
  }

  try {
    const queryWords = significantWords(query).slice(0, MAX_QUERY_WORDS);

    const localPromise: Promise<{ id: string; data: FirebaseFirestore.DocumentData }[]> =
      db && queryWords.length > 0
        ? db
            .collection("movies")
            .where("titleSearchTerms", "array-contains-any", queryWords)
            .get()
            .then((snap) => snap.docs.map((d) => ({ id: d.id, data: d.data() })))
        : Promise.resolve([]);

    // A TMDB failure shouldn't fail the whole search when the local index
    // still has something to offer — null (not a throw) signals "TMDB is
    // unavailable this time", handled below, distinct from "TMDB ran fine
    // and legitimately found nothing" ([]).
    const tmdbPromise = tmdbSearchMovies(query).catch(() => null);

    const [localDocs, tmdbResults] = await Promise.all([localPromise, tmdbPromise]);

    if (tmdbResults) {
      await upsertSearchable(tmdbResults);
    }

    const byId = new Map<string, SearchCandidate>();
    for (const { id, data } of localDocs) {
      byId.set(id, {
        title: data.title as string,
        poster: (data.poster as string | null) ?? null,
        year: (data.year as number | null) ?? null,
        popularitySignal: (data.voteCount as number | undefined) ?? 0
      });
    }
    // TMDB's live data overwrites a possibly-stale local doc for the same
    // movie rather than appearing as a separate duplicate entry.
    for (const r of tmdbResults ?? []) {
      byId.set(r.movieId, { title: r.title, poster: r.poster, year: r.year, popularitySignal: r.voteCount });
    }

    const items = [...byId.entries()]
      .map(([id, candidate]) => ({ id, candidate, ...rankCandidate(query, { title: candidate.title, popularitySignal: candidate.popularitySignal }) }))
      .filter((r) => r.matchType !== "none")
      .sort((a, b) => b.score - a.score)
      .slice(0, RESULTS_TOP_N)
      .map(({ id, candidate }) => ({ movieId: id, title: candidate.title, poster: candidate.poster, year: candidate.year }));

    if (items.length === 0 && tmdbResults === null) {
      // Both sides came up empty: local had nothing, and TMDB didn't
      // legitimately return zero results, it *failed* — surface that
      // rather than silently claiming "no movies found".
      throw new AppError("TMDB_UPSTREAM_ERROR", "Failed to search movies", 502);
    }

    return { items, nextCursor: null };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("TMDB_UPSTREAM_ERROR", "Failed to search movies", 502);
  }
}
