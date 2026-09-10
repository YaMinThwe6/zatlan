import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { buildSearchTerms } from "../src/lib/searchIndex.js";

type DocData = Record<string, unknown>;
const store = new Map<string, DocData>();
const batchOps: { path: string; data: DocData; opts?: { merge?: boolean } }[] = [];

function makeDocRef(path: string) {
  return {
    get: vi.fn(async () => ({ exists: store.has(path), data: () => store.get(path) })),
    set: vi.fn(async (value: DocData) => {
      store.set(path, value);
    })
  };
}

function directChildren(path: string) {
  return [...store.entries()].filter(([key]) => {
    if (!key.startsWith(`${path}/`)) return false;
    return key.slice(path.length + 1).split("/").length === 1;
  });
}

type Where = { field: string; op: string; value: unknown };

function matchWhere(data: DocData, w: Where): boolean {
  if (w.op === "array-contains-any") {
    const arr = (data[w.field] as unknown[] | undefined) ?? [];
    return (w.value as unknown[]).some((v) => arr.includes(v));
  }
  return true;
}

function collectionRef(path: string) {
  function query(state: { wheres?: Where[]; lim?: number }) {
    return {
      where: (field: string, op: string, value: unknown) => query({ ...state, wheres: [...(state.wheres ?? []), { field, op, value }] }),
      limit: (n: number) => query({ ...state, lim: n }),
      get: async () => {
        let entries = directChildren(path);
        for (const w of state.wheres ?? []) entries = entries.filter(([, data]) => matchWhere(data, w));
        if (state.lim) entries = entries.slice(0, state.lim);
        return {
          empty: entries.length === 0,
          docs: entries.map(([key, data]) => ({ id: key.split("/").pop()!, data: () => data }))
        };
      }
    };
  }
  return {
    doc: (id: string) => ({ ...makeDocRef(`${path}/${id}`), __path: `${path}/${id}` }),
    ...query({})
  };
}

const db = {
  collection: (name: string) => collectionRef(name),
  batch: () => ({
    set: (ref: { __path: string }, data: DocData, opts?: { merge?: boolean }) => {
      batchOps.push({ path: ref.__path, data, opts });
    },
    commit: vi.fn(async () => {
      for (const op of batchOps) {
        const existing = store.get(op.path) ?? {};
        store.set(op.path, op.opts?.merge ? { ...existing, ...op.data } : op.data);
      }
      batchOps.length = 0;
    })
  })
};

vi.mock("../src/lib/firebaseAdmin.js", () => ({
  auth: { verifyIdToken: vi.fn() },
  db,
  requireDb: () => db,
  isFirebaseConfigured: () => true
}));

const fetchMovieDetails = vi.fn();
const searchMovies = vi.fn();
const getRecentMovies = vi.fn();
const discoverMovies = vi.fn();

vi.mock("../src/lib/tmdb.js", () => ({ fetchMovieDetails, searchMovies, getRecentMovies, discoverMovies }));

const { createApp } = await import("../src/app.js");

beforeEach(() => {
  store.clear();
  batchOps.length = 0;
  fetchMovieDetails.mockReset();
  searchMovies.mockReset();
  getRecentMovies.mockReset();
  discoverMovies.mockReset();
});

describe("GET /movies/:movieId", () => {
  it("returns the cached Firestore doc without hitting TMDB when it already exists", async () => {
    store.set("movies/27205", { title: "Inception (cached)", genres: ["Sci-Fi"] });
    const app = createApp();
    const res = await request(app).get("/movies/27205");

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ title: "Inception (cached)" });
    expect(fetchMovieDetails).not.toHaveBeenCalled();
  });

  it("always includes zatlanRating and likeCount, defaulting to zero when absent from storage", async () => {
    store.set("movies/27205", { title: "Inception (cached), never rated or liked", genres: ["Sci-Fi"] });
    const app = createApp();
    const res = await request(app).get("/movies/27205");
    expect(res.body.data.zatlanRating).toEqual({ sum: 0, count: 0 });
    expect(res.body.data.likeCount).toBe(0);
  });

  it("preserves real zatlanRating and likeCount when they're already stored", async () => {
    store.set("movies/27205", { title: "Inception (rated)", genres: ["Sci-Fi"], zatlanRating: { sum: 12, count: 3 }, likeCount: 7 });
    const app = createApp();
    const res = await request(app).get("/movies/27205");
    expect(res.body.data.zatlanRating).toEqual({ sum: 12, count: 3 });
    expect(res.body.data.likeCount).toBe(7);
  });

  it("backfills from TMDB when the cached doc is a lightweight search-index-only doc (no genres)", async () => {
    // Exactly the shape seedSearchCatalog.ts/refreshRecentMovies.ts/a live
    // search's upsertSearchable write — title/poster/year/titleSearchTerms
    // only, never the full detail fields.
    store.set("movies/27205", {
      title: "Inception",
      poster: "/poster.jpg",
      year: 2010,
      titleSearchTerms: buildSearchTerms("Inception")
    });
    fetchMovieDetails.mockResolvedValueOnce({
      movieId: "27205",
      title: "Inception",
      originalLanguage: "en",
      genres: ["Sci-Fi"],
      cast: [],
      crew: [],
      credits: []
    });

    const app = createApp();
    const res = await request(app).get("/movies/27205");

    expect(res.status).toBe(200);
    expect(fetchMovieDetails).toHaveBeenCalledWith("27205");
    expect(res.body.data.genres).toEqual(["Sci-Fi"]);

    const movieDoc = store.get("movies/27205") as { genres?: string[] };
    expect(movieDoc.genres).toEqual(["Sci-Fi"]);
  });

  it("preserves an existing rating aggregate on a lightweight doc when backfilling its detail", async () => {
    store.set("movies/27205", { title: "Inception", zatlanRating: { sum: 9, count: 2 }, likeCount: 4 });
    fetchMovieDetails.mockResolvedValueOnce({
      movieId: "27205",
      title: "Inception",
      originalLanguage: "en",
      genres: ["Sci-Fi"],
      cast: [],
      crew: [],
      credits: []
    });

    const app = createApp();
    const res = await request(app).get("/movies/27205");

    expect(res.body.data.zatlanRating).toEqual({ sum: 9, count: 2 });
    expect(res.body.data.likeCount).toBe(4);
  });

  it("on a cache miss: fetches TMDB, stores the movie doc without the credits field, and upserts people docs", async () => {
    fetchMovieDetails.mockResolvedValueOnce({
      movieId: "27205",
      title: "Inception",
      originalLanguage: "en",
      genres: ["Sci-Fi"],
      cast: [{ personId: "6193", name: "Leonardo DiCaprio", character: "Cobb", photo: null }],
      crew: [],
      credits: [
        { personId: "6193", name: "Leonardo DiCaprio", photo: null, knownForDepartment: "Acting", popularity: 9.7 }
      ]
    });

    const app = createApp();
    const res = await request(app).get("/movies/27205");

    expect(res.status).toBe(200);
    expect(res.body.data.credits).toBeUndefined();
    expect(res.body.data.title).toBe("Inception");
    expect(res.body.data.zatlanRating).toEqual({ sum: 0, count: 0 });
    expect(res.body.data.likeCount).toBe(0);

    const movieDoc = store.get("movies/27205") as { credits?: unknown; title: string; titleSearchTerms?: string[] };
    expect(movieDoc.credits).toBeUndefined();
    expect(movieDoc.title).toBe("Inception");
    // A movie discovered via detail view (not search) becomes searchable too.
    expect(movieDoc.titleSearchTerms).toEqual(expect.arrayContaining(["i", "in", "inception"]));

    const personDoc = store.get("people/6193") as { name: string; popularity: number };
    expect(personDoc).toEqual({
      name: "Leonardo DiCaprio",
      photo: null,
      knownForDepartment: "Acting",
      popularity: 9.7,
      // GET /people/search's index (people.service.ts) — same helper movies'
      // own titleSearchTerms uses, applied to the person's name instead.
      nameSearchTerms: expect.arrayContaining(["l", "le", "leonardo"]),
      lastFetched: expect.any(Date)
    });
  });

  it("502s when TMDB fetch fails", async () => {
    fetchMovieDetails.mockRejectedValueOnce(new Error("boom"));
    const app = createApp();
    const res = await request(app).get("/movies/9999");
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("TMDB_UPSTREAM_ERROR");
  });
});

describe("GET /movies/recent", () => {
  it("is unauthenticated — no token required", async () => {
    getRecentMovies.mockResolvedValueOnce([])
    const app = createApp();
    const res = await request(app).get("/movies/recent");
    expect(res.status).toBe(200);
  });

  it("returns TMDB's now-playing list, not routed to GET /movies/:movieId", async () => {
    getRecentMovies.mockResolvedValueOnce([{ movieId: "27205", title: "Inception", poster: null, year: 2010 }]);
    const app = createApp();
    const res = await request(app).get("/movies/recent");

    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([{ movieId: "27205", title: "Inception", poster: null, year: 2010 }]);
    expect(fetchMovieDetails).not.toHaveBeenCalled(); // would fire if "recent" fell through to :movieId
  });

  it("reads the discover/recentMovies cache instead of hitting TMDB, once refreshRecentMovies.ts has populated it", async () => {
    store.set("discover/recentMovies", {
      items: [{ movieId: "cached-1", title: "Cached Movie", poster: null, year: 2026 }],
      updatedAt: new Date()
    });
    const app = createApp();
    const res = await request(app).get("/movies/recent");

    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([{ movieId: "cached-1", title: "Cached Movie", poster: null, year: 2026 }]);
    expect(getRecentMovies).not.toHaveBeenCalled();
  });

  it("502s when TMDB fails", async () => {
    getRecentMovies.mockRejectedValueOnce(new Error("boom"));
    const app = createApp();
    const res = await request(app).get("/movies/recent");
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("TMDB_UPSTREAM_ERROR");
  });
});

// hld.md §18 (redesigned 2026-08-31 — see project notes): local index + live
// TMDB are now queried together on every search, merged and ranked as one
// pool through searchRanking.ts — never a cascade where TMDB only gets asked
// if the local index came up empty. The old "broader real-time Levenshitein
// scan over up to 2000 local docs" fallback tier is dropped (its job — catch
// what the indexed lookup's precomputed typo variants miss — is TMDB's job
// now, since TMDB always runs).
describe("GET /search/movies", () => {
  it("400s with no query", async () => {
    const app = createApp();
    const res = await request(app).get("/search/movies");
    expect(res.status).toBe(400);
  });

  it("queries the local index and TMDB together, merging both into one result set", async () => {
    store.set("movies/157336", { title: "Interstellar", poster: null, year: 2014, titleSearchTerms: buildSearchTerms("Interstellar") });
    searchMovies.mockResolvedValueOnce([{ movieId: "27205", title: "Inception", poster: null, year: 2010, voteCount: 500 }]);

    const app = createApp();
    const res = await request(app).get("/search/movies?q=interstellar%20inception");

    expect(res.status).toBe(200);
    expect(searchMovies).toHaveBeenCalledWith("interstellar inception");
    const titles = res.body.data.items.map((m: { title: string }) => m.title);
    expect(titles).toEqual(expect.arrayContaining(["Interstellar", "Inception"]));
  });

  it("matches via a precomputed single-typo variant from the local index — TMDB alone has no typo tolerance", async () => {
    store.set("movies/157336", { title: "Interstellar", poster: null, year: 2014, titleSearchTerms: buildSearchTerms("Interstellar") });
    searchMovies.mockResolvedValueOnce([]); // TMDB itself finds nothing for the misspelling — confirmed behavior, not a stub of convenience

    const app = createApp();
    const res = await request(app).get("/search/movies?q=intersteller"); // the exact motivating example

    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([{ movieId: "157336", title: "Interstellar", poster: null, year: 2014 }]);
  });

  it("prefers TMDB's fresher data over a stale local doc when the same movie comes back from both sides", async () => {
    store.set("movies/157336", { title: "Interstellar", poster: "/old-stale-poster.jpg", year: 2014, titleSearchTerms: buildSearchTerms("Interstellar") });
    searchMovies.mockResolvedValueOnce([{ movieId: "157336", title: "Interstellar", poster: "/fresh-poster.jpg", year: 2014, voteCount: 1000 }]);

    const app = createApp();
    const res = await request(app).get("/search/movies?q=interstellar");

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1); // deduped by movieId, not doubled
    expect(res.body.data.items[0].poster).toBe("/fresh-poster.jpg");
  });

  it("upserts TMDB's results into the local index for next time, even when the local index already had a match", async () => {
    store.set("movies/157336", { title: "Interstellar", poster: null, year: 2014, titleSearchTerms: buildSearchTerms("Interstellar") });
    searchMovies.mockResolvedValueOnce([{ movieId: "27205", title: "Inception", poster: null, year: 2010, voteCount: 500 }]);

    const app = createApp();
    await request(app).get("/search/movies?q=interstellar");

    const upserted = store.get("movies/27205") as { title: string; titleSearchTerms: string[] };
    expect(upserted.title).toBe("Inception");
    expect(upserted.titleSearchTerms).toEqual(expect.arrayContaining(["i", "in", "inception"]));
  });

  it("degrades to local-only results, without erroring, when TMDB fails but the local index still has a match", async () => {
    store.set("movies/157336", { title: "Interstellar", poster: null, year: 2014, titleSearchTerms: buildSearchTerms("Interstellar") });
    searchMovies.mockRejectedValueOnce(new Error("boom"));

    const app = createApp();
    const res = await request(app).get("/search/movies?q=interstellar");

    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([{ movieId: "157336", title: "Interstellar", poster: null, year: 2014 }]);
  });

  it("502s when TMDB fails and the local index has nothing either", async () => {
    searchMovies.mockRejectedValueOnce(new Error("boom"));
    const app = createApp();
    const res = await request(app).get("/search/movies?q=zzzznotarealtitle");
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("TMDB_UPSTREAM_ERROR");
  });

  it("ranks 'The Dark Knight' first for query 'dark knight' even when a weaker match is far more popular", async () => {
    store.set("movies/155", { title: "The Dark Knight", poster: null, year: 2008, voteCount: 100, titleSearchTerms: buildSearchTerms("The Dark Knight") });
    store.set("movies/49026", { title: "The Dark Knight Rises", poster: null, year: 2012, voteCount: 50, titleSearchTerms: buildSearchTerms("The Dark Knight Rises") });
    // Batman has no textual relation to "dark knight" beyond nothing at all here — given
    // a huge popularity edge, to prove it still can't out-rank an actual textual match.
    store.set("movies/268", { title: "Batman", poster: null, year: 1989, voteCount: 1_000_000, titleSearchTerms: buildSearchTerms("Batman") });
    searchMovies.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await request(app).get("/search/movies?q=dark%20knight");

    expect(res.status).toBe(200);
    const titles = res.body.data.items.map((m: { title: string }) => m.title);
    expect(titles[0]).toBe("The Dark Knight");
    expect(titles[1]).toBe("The Dark Knight Rises");
    expect(titles).not.toContain("Batman"); // no textual match at all -> excluded, popularity doesn't buy it a spot
  });

  it("excludes a TMDB result with no textual relevance to the query, even though it came back from a live source", async () => {
    searchMovies.mockResolvedValueOnce([{ movieId: "19995", title: "Avatar", poster: null, year: 2009, voteCount: 30_000 }]);
    const app = createApp();
    const res = await request(app).get("/search/movies?q=interstellar");

    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]); // no textual match -> dropped, not just deprioritized
  });
});

describe("GET /discover/movies", () => {
  it("400s when neither a known genre nor a known language is given", async () => {
    const app = createApp();
    const res = await request(app).get("/discover/movies");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MISSING_FILTER");
    expect(discoverMovies).not.toHaveBeenCalled();
  });

  it("400s on an unrecognized genre/language rather than silently returning unfiltered popular movies", async () => {
    const app = createApp();
    const res = await request(app).get("/discover/movies?genre=Bollywood&language=elvish");
    expect(res.status).toBe(400);
    expect(discoverMovies).not.toHaveBeenCalled();
  });

  it("passes a known language through to TMDB discover and returns its results as plain summaries", async () => {
    discoverMovies.mockResolvedValueOnce({
      items: [{ movieId: "496243", title: "Parasite", poster: "/p.jpg", year: 2019, genres: ["Thriller"], originalLanguage: "ko", voteAverage: 8.5 }],
      totalPages: 12
    });
    const app = createApp();
    const res = await request(app).get("/discover/movies?language=ko");

    expect(res.status).toBe(200);
    expect(discoverMovies).toHaveBeenCalledWith([], ["ko"], 1);
    expect(res.body.data).toMatchObject({
      page: 1,
      totalPages: 12,
      items: [{ movieId: "496243", title: "Parasite", poster: "/p.jpg", year: 2019 }]
    });
  });

  it("passes a known genre through and honors the page param", async () => {
    discoverMovies.mockResolvedValueOnce({ items: [], totalPages: 3 });
    const app = createApp();
    const res = await request(app).get("/discover/movies?genre=Horror&page=2");

    expect(res.status).toBe(200);
    expect(discoverMovies).toHaveBeenCalledWith(["Horror"], [], 2);
  });

  it("upserts discovered movies into the local index so a tapped card opens without a cold TMDB fetch", async () => {
    discoverMovies.mockResolvedValueOnce({
      items: [{ movieId: "496243", title: "Parasite", poster: "/p.jpg", year: 2019, genres: [], originalLanguage: "ko", voteAverage: 8.5 }],
      totalPages: 1
    });
    const app = createApp();
    await request(app).get("/discover/movies?language=ko");

    const upserted = store.get("movies/496243") as { title: string; titleSearchTerms: string[] };
    expect(upserted.title).toBe("Parasite");
    expect(upserted.titleSearchTerms).toEqual(expect.arrayContaining(["p", "pa", "parasite"]));
  });

  it("502s when TMDB discover fails", async () => {
    discoverMovies.mockRejectedValueOnce(new Error("boom"));
    const app = createApp();
    const res = await request(app).get("/discover/movies?genre=Horror");
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("TMDB_UPSTREAM_ERROR");
  });

  it("falls back to page 1 for a non-numeric page", async () => {
    discoverMovies.mockResolvedValueOnce({ items: [], totalPages: 1 });
    const app = createApp();
    await request(app).get("/discover/movies?genre=Horror&page=abc");
    expect(discoverMovies).toHaveBeenCalledWith(["Horror"], [], 1);
  });
});
