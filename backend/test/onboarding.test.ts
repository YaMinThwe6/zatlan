import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

type DocData = Record<string, unknown>;
const store = new Map<string, DocData>();
const batchOps: { path: string; data: DocData; opts?: { merge?: boolean } }[] = [];

function directChildren(path: string) {
  return [...store.entries()].filter(([key]) => {
    if (!key.startsWith(`${path}/`)) return false;
    return key.slice(path.length + 1).split("/").length === 1;
  });
}

function makeDocRef(path: string) {
  return {
    __path: path,
    get: vi.fn(async () => ({ exists: store.has(path), id: path.split("/").pop()!, data: () => store.get(path) })),
    set: vi.fn(async (value: DocData) => {
      store.set(path, value);
    }),
    collection: (sub: string) => makeCollectionRef(`${path}/${sub}`)
  };
}

// Merges onboarding's original where/orderBy/limit query chain (the local
// genre/language candidate query) with the doc()/batch() support
// getMovieDetail needs (movies.test.ts's own mock pattern) — the latter is
// new here since watched-candidates and celebrity-suggestions now fall
// through to getMovieDetail on any cursor-paginated (Discover-backed) page.
function makeCollectionRef(path: string) {
  function query(state: {
    whereField?: string;
    whereOp?: string;
    whereValues?: string[];
    orderField?: string;
    dir?: "asc" | "desc";
    lim?: number;
  }) {
    return {
      where: (field: string, op: string, values: string | string[]) =>
        query({ ...state, whereField: field, whereOp: op, whereValues: Array.isArray(values) ? values : [values] }),
      orderBy: (field: string, dir: "asc" | "desc" = "asc") => query({ ...state, orderField: field, dir }),
      limit: (n: number) => query({ ...state, lim: n }),
      get: async () => {
        let entries = directChildren(path);
        if (state.whereField && state.whereValues) {
          entries = entries.filter(([, data]) => {
            const value = data[state.whereField!];
            if (state.whereOp === "array-contains-any") {
              const arr = (value as string[] | undefined) ?? [];
              return arr.some((v) => state.whereValues!.includes(v));
            }
            if (state.whereOp === "in") {
              return state.whereValues!.includes(value as string);
            }
            return true;
          });
        }
        if (state.orderField) {
          const field = state.orderField;
          entries = entries.sort((a, b) => {
            const av = (a[1][field] as number) ?? 0;
            const bv = (b[1][field] as number) ?? 0;
            return state.dir === "desc" ? bv - av : av - bv;
          });
        }
        if (state.lim) entries = entries.slice(0, state.lim);
        return { docs: entries.map(([key, data]) => ({ id: key.split("/").pop()!, data: () => data })) };
      }
    };
  }
  return { doc: (id: string) => makeDocRef(`${path}/${id}`), ...query({}) };
}

const db = {
  collection: (name: string) => makeCollectionRef(name),
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
  auth: { verifyIdToken: vi.fn(async () => ({ uid: "uid-1" })) },
  db,
  requireDb: () => db,
  isFirebaseConfigured: () => true
}));

const discoverMovies = vi.fn();
const fetchMovieDetails = vi.fn();
vi.mock("../src/lib/tmdb.js", () => ({ discoverMovies, fetchMovieDetails, searchMovies: vi.fn(), getRecentMovies: vi.fn() }));

const { createApp } = await import("../src/app.js");

beforeEach(() => {
  store.clear();
  batchOps.length = 0;
  discoverMovies.mockReset();
  fetchMovieDetails.mockReset();
  store.set("movies/dune", { title: "Dune: Part Two", genres: ["Sci-Fi"], originalLanguage: "en", voteAverage: 8.4 });
  store.set("movies/interstellar", { title: "Interstellar", genres: ["Sci-Fi", "Drama"], originalLanguage: "en", voteAverage: 8.6 });
  store.set("movies/parasite", { title: "Parasite", genres: ["Thriller", "Drama"], originalLanguage: "ko", voteAverage: 8.5 });
  store.set("movies/oldboy", { title: "Oldboy", genres: ["Thriller"], originalLanguage: "ko", voteAverage: 8.1 });
  store.set("movies/notebook", { title: "The Notebook", genres: ["Romance"], originalLanguage: "en", voteAverage: 7.8 });
  // Highest voteAverage of all fixtures on purpose — if the not-yet-released
  // filter isn't applied, it sorts to the very top of every unfiltered query
  // below and breaks their expected ordering, not just the dedicated test.
  store.set("movies/upcoming", { title: "Future Blockbuster", genres: ["Sci-Fi"], originalLanguage: "en", voteAverage: 9.9, releaseDate: "2099-01-01" });
});

function req(app: ReturnType<typeof createApp>, qs = "") {
  return request(app).get(`/onboarding/watched-candidates${qs}`).set("Authorization", "Bearer good");
}

describe("GET /onboarding/watched-candidates", () => {
  it("401s without a token", async () => {
    const app = createApp();
    const res = await request(app).get("/onboarding/watched-candidates");
    expect(res.status).toBe(401);
  });

  it("with neither genres nor languages: trending fallback, sorted by voteAverage desc", async () => {
    const app = createApp();
    const res = await req(app);
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((m: { movieId: string }) => m.movieId)).toEqual([
      "interstellar",
      "parasite",
      "dune",
      "oldboy",
      "notebook"
    ]);
  });

  it("filters by genres only", async () => {
    const app = createApp();
    const res = await req(app, "?genres=Thriller");
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((m: { movieId: string }) => m.movieId)).toEqual(["parasite", "oldboy"]);
  });

  it("filters by languages only", async () => {
    const app = createApp();
    const res = await req(app, "?languages=ko");
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((m: { movieId: string }) => m.movieId)).toEqual(["parasite", "oldboy"]);
  });

  it("combines genres and languages (language query, genre filtered in-app)", async () => {
    const app = createApp();
    const res = await req(app, "?genres=Drama&languages=ko");
    expect(res.status).toBe(200);
    // Drama movies are interstellar(en) and parasite(ko) — only parasite matches both
    expect(res.body.data.items.map((m: { movieId: string }) => m.movieId)).toEqual(["parasite"]);
  });

  // Real reported bug: someone who picks a narrow language (e.g. only Tamil)
  // alongside a genre used to get nothing, even when the local index has a
  // real match — because the query filtered by genre FIRST (top CANDIDATE_LIMIT
  // by voteAverage), and the local index skews English (whatever's been
  // searched/opened most), so the one Tamil match never made it into that
  // top-voted slice for the language filter to even see. Querying by language
  // first instead guarantees the pool is language-correct before genre ever
  // narrows it further.
  it("finds a language match even when it would've been truncated out of a genre-first top-voted pool", async () => {
    for (let i = 0; i < 30; i++) {
      store.set(`movies/decoy${i}`, { title: `Decoy ${i}`, genres: ["Sci-Fi"], originalLanguage: "en", voteAverage: 9.0 });
    }
    store.set("movies/enthiran", { title: "Enthiran", genres: ["Sci-Fi"], originalLanguage: "ta", voteAverage: 7.0 });

    const app = createApp();
    const res = await req(app, "?genres=Sci-Fi&languages=ta");

    expect(res.body.data.items.map((m: { movieId: string }) => m.movieId)).toContain("enthiran");
  });

  it("excludes locally-cached movies whose releaseDate is still in the future, even though it has the top voteAverage", async () => {
    const app = createApp();
    const res = await req(app);
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((m: { movieId: string }) => m.movieId)).not.toContain("upcoming");
  });

  it("page 1 (no cursor) always offers a next page for scrolling further", async () => {
    const app = createApp();
    const res = await req(app);
    expect(res.body.data.nextCursor).toBe("2");
  });

  it("a cursor page answers straight from Discover's own fields — no per-item detail fetch blocking the response", async () => {
    discoverMovies.mockResolvedValueOnce({
      items: [
        { movieId: "603", title: "The Matrix", poster: "/matrix.jpg", year: 1999, genres: ["Science Fiction", "Action"], originalLanguage: "en", voteAverage: 8.2 }
      ],
      totalPages: 5
    });

    const app = createApp();
    const res = await req(app, "?genres=Action&cursor=2");

    expect(res.status).toBe(200);
    expect(discoverMovies).toHaveBeenCalledWith(["Action"], [], 2);
    expect(res.body.data.items).toEqual([
      { movieId: "603", title: "The Matrix", poster: "/matrix.jpg", year: 1999, genres: ["Science Fiction", "Action"], originalLanguage: "en", voteAverage: 8.2 }
    ]);
    expect(res.body.data.nextCursor).toBe("3");
  });

  it("still backfills full detail into the local index in the background, without blocking the response", async () => {
    discoverMovies.mockResolvedValueOnce({
      items: [{ movieId: "603", title: "The Matrix", poster: "/matrix.jpg", year: 1999, genres: ["Action"], originalLanguage: "en", voteAverage: 8.2 }],
      totalPages: 5
    });
    fetchMovieDetails.mockResolvedValueOnce({
      movieId: "603",
      title: "The Matrix",
      poster: "/matrix.jpg",
      year: 1999,
      originalLanguage: "en",
      genres: ["Science Fiction", "Action"],
      voteAverage: 8.2,
      cast: [],
      crew: [],
      credits: []
    });

    const app = createApp();
    await req(app, "?genres=Action&cursor=2");
    // The backfill is fire-and-forget — give its microtask chain a tick to land.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchMovieDetails).toHaveBeenCalledWith("603");
    expect((store.get("movies/603") as { genres?: string[] })?.genres).toEqual(["Science Fiction", "Action"]);
  });

  it("a cursor page returns nextCursor: null once TMDB's own totalPages is exhausted", async () => {
    discoverMovies.mockResolvedValueOnce({ items: [], totalPages: 5 });

    const app = createApp();
    const res = await req(app, "?cursor=5");

    expect(res.body.data.nextCursor).toBeNull();
  });

  it("passes cursor pages straight through from discoverMovies without re-filtering by language — discoverMovies now guarantees language-correctness itself (fans out per language internally)", async () => {
    discoverMovies.mockResolvedValueOnce({
      items: [{ movieId: "2", title: "Korean Movie", poster: null, year: 2020, genres: [], originalLanguage: "ko", voteAverage: 5 }],
      totalPages: 1
    });

    const app = createApp();
    const res = await req(app, "?languages=ko,ja&cursor=1");

    expect(discoverMovies).toHaveBeenCalledWith([], ["ko", "ja"], 1);
    expect(res.body.data.items.map((m: { movieId: string }) => m.movieId)).toEqual(["2"]);
  });
});
