import type { MovieSummary } from "@zatlan/shared-types";
import { env } from "./env.js";

const TMDB_BASE = "https://api.themoviedb.org/3";
const STREAMING_REGION = "IN"; // hardcoded for the prototype — hld.md §8

export interface TmdbPersonCredit {
  personId: string;
  name: string;
  photo: string | null;
  knownForDepartment: string | null;
  popularity: number;
}

export interface TmdbMovie {
  movieId: string;
  title: string;
  year: number | null;
  runtime: number | null;
  genres: string[];
  originalLanguage: string; // ISO 639-1, e.g. "en", "ta", "ko" — TMDB's original_language
  synopsis: string | null;
  poster: string | null;
  cast: { personId: string; name: string; character: string; photo: string | null }[];
  crew: { personId: string; name: string; role: string; photo: string | null }[];
  isAdult: boolean;
  voteAverage: number;
  voteCount: number;
  releaseDate: string | null; // TMDB's raw ISO date — movies.service.ts stores this so onboarding's local candidate query can exclude not-yet-released movies
  trailerKey: string | null; // YouTube video id, e.g. https://www.youtube.com/watch?v={trailerKey}
  backdrop: string | null; // TMDB's raw backdrop_path — widescreen key art for the movie detail hero, distinct from the portrait poster
  streamingProviders: { name: string; type: "subscription" | "rent" | "buy"; logo: string }[];
  credits: TmdbPersonCredit[]; // full person-doc-shape data for everyone in cast/crew above, for upserting people/{personId} (schema.md)
}

async function tmdbFetch(path: string): Promise<any> {
  const res = await fetch(`${TMDB_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${env.TMDB_READ_ACCESS_TOKEN}`,
      accept: "application/json"
    }
  });
  if (!res.ok) {
    throw new Error(`TMDB request failed: ${res.status} ${res.statusText} (${path})`);
  }
  return res.json();
}

function pickTrailer(videosResponse: any): string | null {
  const results: any[] = videosResponse?.results ?? [];
  const youtubeTrailers = results.filter((v) => v.site === "YouTube" && v.type === "Trailer");
  const official = youtubeTrailers.find((v) => v.official);
  return (official ?? youtubeTrailers[0])?.key ?? null;
}

function mapProviders(providersResponse: any): TmdbMovie["streamingProviders"] {
  const region = providersResponse?.results?.[STREAMING_REGION];
  if (!region) return [];

  const buckets: [string, "subscription" | "rent" | "buy"][] = [
    ["flatrate", "subscription"],
    ["rent", "rent"],
    ["buy", "buy"]
  ];

  const out: TmdbMovie["streamingProviders"] = [];
  for (const [key, type] of buckets) {
    for (const p of region[key] ?? []) {
      out.push({ name: p.provider_name, type, logo: p.logo_path ?? "" });
    }
  }
  return out;
}

export async function fetchMovieDetails(tmdbId: string): Promise<TmdbMovie> {
  const data = await tmdbFetch(
    `/movie/${encodeURIComponent(tmdbId)}?append_to_response=credits,watch/providers,videos`
  );

  const cast = (data.credits?.cast ?? [])
    .slice(0, 10)
    .map((c: any) => ({ personId: String(c.id), name: c.name, character: c.character ?? "", photo: c.profile_path || null }));

  const crew = (data.credits?.crew ?? [])
    .filter((c: any) => c.job === "Director" || c.job === "Writer")
    .map((c: any) => ({ personId: String(c.id), name: c.name, role: c.job, photo: c.profile_path || null }));

  // Every credited person gets a people/{personId} record (schema.md) — not just the
  // top-10 cast + Director/Writer subset the movie page itself displays above. Small
  // roles and full crew are followable celebrities too, per explicit product direction.
  const creditedRaw = [...(data.credits?.cast ?? []), ...(data.credits?.crew ?? [])];
  const creditsById = new Map<string, TmdbPersonCredit>();
  for (const c of creditedRaw) {
    const personId = String(c.id);
    if (!creditsById.has(personId)) {
      creditsById.set(personId, {
        personId,
        name: c.name,
        photo: c.profile_path || null,
        knownForDepartment: c.known_for_department ?? null,
        popularity: c.popularity ?? 0
      });
    }
  }

  return {
    movieId: String(data.id),
    title: data.title,
    year: data.release_date ? Number(data.release_date.slice(0, 4)) : null,
    runtime: data.runtime ?? null,
    genres: (data.genres ?? []).map((g: any) => g.name),
    originalLanguage: data.original_language ?? "en",
    synopsis: data.overview || null,
    poster: data.poster_path || null,
    cast,
    crew,
    isAdult: Boolean(data.adult),
    voteAverage: data.vote_average ?? 0,
    voteCount: data.vote_count ?? 0,
    releaseDate: data.release_date || null,
    trailerKey: pickTrailer(data.videos),
    backdrop: data.backdrop_path || null,
    streamingProviders: mapProviders(data["watch/providers"]),
    credits: [...creditsById.values()]
  };
}

// GET /movies/recent — TMDB's "now playing" list (theatrical releases
// currently in cinemas), region-scoped to match STREAMING_REGION's existing
// hardcoded-India convention (hld.md §8). Same MovieSummary shape as search
// results — the frontend's Discover page renders both with the same card.
export async function getRecentMovies(): Promise<MovieSummary[]> {
  const data = await tmdbFetch(`/movie/now_playing?region=${STREAMING_REGION}`);
  return (data.results ?? []).map((r: any) => ({
    movieId: String(r.id),
    title: r.title,
    poster: r.poster_path || null,
    year: r.release_date ? Number(r.release_date.slice(0, 4)) : null
  }));
}

// scripts/seedSearchCatalog.ts — bulk-seeds the local search index (hld.md
// §18) with a broad slice of well-known titles, not just whatever's been
// incidentally viewed or searched. TMDB's `/movie/popular`, paginated (20
// movies/page); `pages` is the caller's choice of how much catalog breadth
// to pull in one run.
export async function getPopularMovies(pages: number): Promise<MovieSummary[]> {
  const results: MovieSummary[] = [];
  for (let page = 1; page <= pages; page++) {
    const data = await tmdbFetch(`/movie/popular?region=${STREAMING_REGION}&page=${page}`);
    for (const r of data.results ?? []) {
      results.push({
        movieId: String(r.id),
        title: r.title,
        poster: r.poster_path || null,
        year: r.release_date ? Number(r.release_date.slice(0, 4)) : null
      });
    }
  }
  return results;
}

// hld.md §18 — the local index + live TMDB are merged and ranked together
// on every search (movies.service.ts's searchMoviesService), so TMDB's
// results need a popularity signal for that shared ranking to break ties
// with, not just the bare MovieSummary shape the frontend renders.
export interface TmdbSearchResult extends MovieSummary {
  voteCount: number;
}

export async function searchMovies(query: string): Promise<TmdbSearchResult[]> {
  const data = await tmdbFetch(`/search/movie?query=${encodeURIComponent(query)}`);
  return (data.results ?? []).map((r: any) => ({
    movieId: String(r.id),
    title: r.title,
    poster: r.poster_path || null,
    year: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
    voteCount: r.vote_count ?? 0
  }));
}

// TMDB's fixed movie-genre table (/genre/movie/list) — hardcoded rather than
// fetched, since it practically never changes and every other place in this
// codebase already stores genres by name (movies.genres, GENRE_OPTIONS), not
// TMDB's internal ids — discover is the one endpoint that needs ids, so the
// translation happens right here at the boundary.
const GENRE_NAME_TO_ID: Record<string, number> = {
  Action: 28,
  Adventure: 12,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Documentary: 99,
  Drama: 18,
  Family: 10751,
  Fantasy: 14,
  History: 36,
  Horror: 27,
  Music: 10402,
  Mystery: 9648,
  Romance: 10749,
  "Science Fiction": 878,
  Thriller: 53,
  War: 10752,
  Western: 37
};

const GENRE_ID_TO_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(GENRE_NAME_TO_ID).map(([name, id]) => [id, name])
);

// Everything MovieCandidate actually needs (movie.ts) is already sitting in
// TMDB's own /discover/movie response — genre_ids, vote_average,
// original_language — no separate detail fetch required. Only cast/crew
// needs a real getMovieDetail() call (Discover doesn't return credits at
// all); callers that need that pay for it themselves per movie, not here.
export interface TmdbDiscoverResult extends MovieSummary {
  genres: string[];
  originalLanguage: string;
  voteAverage: number;
}

// onboarding.service.ts's genre/language-filtered candidate & celebrity-suggestion
// paging (hld.md §13, redesigned for infinite scroll) — /discover/movie is the one
// TMDB endpoint that's natively paginated by genre+language, so it's the source
// that actually keeps growing as the user scrolls, unlike the local Firestore
// index (only ever populated by movies someone has individually opened).
export async function discoverMovies(genres: string[], languages: string[], page: number): Promise<{ items: TmdbDiscoverResult[]; totalPages: number }> {
  // TMDB's with_original_language only accepts one code — no OR syntax like
  // with_genres' pipe. A single unfiltered request used to sit here instead,
  // cross-checked in-app afterward — but popularity.desc sorting on an
  // unfiltered global pool is dominated by English-language content, so a
  // page could come back with genuinely zero matches for a chosen pair like
  // Tamil+Malayalam, sometimes for several pages in a row (masked as "slow
  // loading" by useInfinitePages' auto-continue, and whatever little got
  // through skewed English). Querying each language's own Discover page
  // directly and interleaving the results instead guarantees every chosen
  // language is actually represented, not just whatever survives an
  // unfiltered global-popularity cut.
  if (languages.length > 1) {
    const perLanguage = await Promise.all(languages.map((lang) => discoverMovies(genres, [lang], page)));
    return {
      items: interleave(perLanguage.map((r) => r.items)),
      // Keep offering a next page until every language's own Discover paging
      // is exhausted, not just whichever language happens to run out first.
      totalPages: Math.max(...perLanguage.map((r) => r.totalPages))
    };
  }

  const params = new URLSearchParams({ sort_by: "popularity.desc", page: String(page), include_adult: "false" });

  // Onboarding's "movies you've watched" is meant to offer things someone
  // could plausibly have already seen — a not-yet-released title showing up
  // there is a real bug users hit, not just noise. TMDB's own primary_release_date
  // filter does this server-side so it's exact, not a same-year approximation.
  params.set("primary_release_date.lte", new Date().toISOString().slice(0, 10));

  // TMDB's with_genres treats a comma-separated list as AND (must match
  // every genre listed) and pipe-separated as OR (match any) — confirmed
  // directly against TMDB's own docs. A comma here (the natural-looking
  // choice, and the original bug) makes the filter *stricter* the more
  // genres someone picks — with enough genres selected, almost nothing
  // satisfies "belongs to all of these at once", so Discover legitimately
  // runs out of pages almost immediately. Since a user picking several
  // genres means "any of these", not "all of these", pipe is correct here.
  const genreIds = genres.map((g) => GENRE_NAME_TO_ID[g]).filter((id): id is number => id !== undefined);
  if (genreIds.length > 0) params.set("with_genres", genreIds.join("|"));

  if (languages.length === 1) params.set("with_original_language", languages[0]);

  const data = await tmdbFetch(`/discover/movie?${params.toString()}`);
  const items: TmdbDiscoverResult[] = (data.results ?? []).map((r: any) => ({
    movieId: String(r.id),
    title: r.title,
    poster: r.poster_path || null,
    year: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
    genres: ((r.genre_ids ?? []) as number[]).map((id) => GENRE_ID_TO_NAME[id]).filter((g): g is string => g !== undefined),
    originalLanguage: r.original_language ?? "en",
    voteAverage: r.vote_average ?? 0
  }));
  return { items, totalPages: data.total_pages ?? 1 };
}

// Round-robins across each language's own result list rather than
// concatenating them — concatenating would let whichever language was
// requested first dominate the front of the merged page (still an implicit
// bias), especially once one language's list is longer than another's.
function interleave<T>(lists: T[][]): T[] {
  const result: T[] = [];
  const maxLength = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < maxLength; i++) {
    for (const list of lists) {
      if (i < list.length) result.push(list[i]);
    }
  }
  return result;
}
