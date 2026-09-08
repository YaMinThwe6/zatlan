import { describe, it, expect, vi, afterEach } from "vitest";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("tmdb.searchMovies", () => {
  it("maps TMDB's raw search results, including vote_count as voteCount — the local+TMDB merged search's popularity tie-break signal", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { id: 27205, title: "Inception", poster_path: "/poster.jpg", release_date: "2010-07-15", vote_count: 34000 }
        ]
      })
    }) as unknown as typeof fetch;

    const { searchMovies } = await import("../src/lib/tmdb.js");
    const items = await searchMovies("inception");

    expect(items).toEqual([{ movieId: "27205", title: "Inception", poster: "/poster.jpg", year: 2010, voteCount: 34000 }]);
  });

  it("defaults voteCount to 0 when TMDB omits it", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ id: 1, title: "Untitled", poster_path: null, release_date: null }] })
    }) as unknown as typeof fetch;

    const { searchMovies } = await import("../src/lib/tmdb.js");
    const items = await searchMovies("untitled");

    expect(items[0].voteCount).toBe(0);
  });
});

describe("tmdb.discoverMovies", () => {
  it("translates genre names to TMDB's genre ids and passes the page through", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            id: 157336,
            title: "Interstellar",
            poster_path: "/poster.jpg",
            release_date: "2014-11-05",
            genre_ids: [878, 18],
            original_language: "en",
            vote_average: 8.4
          }
        ],
        total_pages: 12
      })
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { discoverMovies } = await import("../src/lib/tmdb.js");
    const result = await discoverMovies(["Science Fiction", "Drama"], [], 3);

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/discover/movie?");
    // Pipe-separated — TMDB's OR for with_genres. A comma would be AND
    // (must match every genre listed), which is the bug this fixes: picking
    // more genres should widen the match, not require all of them at once.
    expect(url).toContain("with_genres=878%7C18");
    expect(url).toContain("page=3");
    expect(result).toEqual({
      items: [
        {
          movieId: "157336",
          title: "Interstellar",
          poster: "/poster.jpg",
          year: 2014,
          genres: ["Science Fiction", "Drama"],
          originalLanguage: "en",
          voteAverage: 8.4
        }
      ],
      totalPages: 12
    });
  });

  it("passes with_original_language for a single chosen language", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [], total_pages: 1 }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { discoverMovies } = await import("../src/lib/tmdb.js");
    await discoverMovies([], ["ko"], 1);
    expect(fetchMock.mock.calls[0][0]).toContain("with_original_language=ko");
  });

  // Real bug this fixes: TMDB's with_original_language only accepts one code
  // (no OR syntax like with_genres' pipe), so multiple chosen languages used
  // to mean one unfiltered, popularity.desc-sorted global request, cross-
  // checked in-app afterward. A popularity-sorted global pool is dominated by
  // English-language content, so a page could come back with genuinely zero
  // matches for a narrower pair like Tamil+Malayalam, sometimes for several
  // pages in a row — the reported "slow, English-biased" onboarding
  // candidates. Querying each language's own Discover page directly and
  // interleaving guarantees every chosen language is actually represented.
  it("fans out one request per language when multiple are given, interleaving the merged results round-robin", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.includes("with_original_language=ta")
          ? {
              results: [
                { id: 1, title: "Tamil A", poster_path: null, release_date: "2020-01-01", genre_ids: [], original_language: "ta", vote_average: 7 },
                { id: 2, title: "Tamil B", poster_path: null, release_date: "2020-01-01", genre_ids: [], original_language: "ta", vote_average: 6 }
              ],
              total_pages: 3
            }
          : {
              results: [{ id: 3, title: "Malayalam A", poster_path: null, release_date: "2020-01-01", genre_ids: [], original_language: "ml", vote_average: 8 }],
              total_pages: 5
            }
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { discoverMovies } = await import("../src/lib/tmdb.js");
    const result = await discoverMovies(["Drama"], ["ta", "ml"], 1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes("with_original_language=ta") && u.includes("with_genres="))).toBe(true);
    expect(urls.some((u) => u.includes("with_original_language=ml") && u.includes("with_genres="))).toBe(true);

    // Round-robin: one from Tamil, one from Malayalam, then the Tamil leftover.
    expect(result.items.map((m) => m.movieId)).toEqual(["1", "3", "2"]);
    // Keep paging until every language is exhausted, not just the first.
    expect(result.totalPages).toBe(5);
  });

  it("defaults totalPages to 1 and drops unrecognized genre names", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) }) as unknown as typeof fetch;

    const { discoverMovies } = await import("../src/lib/tmdb.js");
    const result = await discoverMovies(["Not A Real Genre"], [], 1);

    expect(result).toEqual({ items: [], totalPages: 1 });
  });

  it("filters out unreleased movies via primary_release_date.lte, so onboarding's watched-candidates never offers something not out yet", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [], total_pages: 1 }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const { discoverMovies } = await import("../src/lib/tmdb.js");
      await discoverMovies([], [], 1);
      expect(fetchMock.mock.calls[0][0]).toContain("primary_release_date.lte=2026-09-05");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("tmdb.fetchMovieDetails", () => {
  it("captures releaseDate from TMDB's raw release_date, for local release-date filtering", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 27205,
        title: "Inception",
        release_date: "2010-07-15",
        genres: [],
        credits: { cast: [], crew: [] }
      })
    }) as unknown as typeof fetch;

    const { fetchMovieDetails } = await import("../src/lib/tmdb.js");
    const movie = await fetchMovieDetails("27205");

    expect(movie.releaseDate).toBe("2010-07-15");
  });

  it("defaults releaseDate to null when TMDB omits it", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 1, title: "Untitled", genres: [], credits: { cast: [], crew: [] } })
    }) as unknown as typeof fetch;

    const { fetchMovieDetails } = await import("../src/lib/tmdb.js");
    const movie = await fetchMovieDetails("1");

    expect(movie.releaseDate).toBeNull();
  });

  it("captures backdrop from TMDB's raw backdrop_path — the movie detail hero's large widescreen image, distinct from the portrait poster", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 27205,
        title: "Inception",
        backdrop_path: "/wide-image.jpg",
        genres: [],
        credits: { cast: [], crew: [] }
      })
    }) as unknown as typeof fetch;

    const { fetchMovieDetails } = await import("../src/lib/tmdb.js");
    const movie = await fetchMovieDetails("27205");

    expect(movie.backdrop).toBe("/wide-image.jpg");
  });

  it("defaults backdrop to null when TMDB omits it", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 1, title: "Untitled", genres: [], credits: { cast: [], crew: [] } })
    }) as unknown as typeof fetch;

    const { fetchMovieDetails } = await import("../src/lib/tmdb.js");
    const movie = await fetchMovieDetails("1");

    expect(movie.backdrop).toBeNull();
  });
});
