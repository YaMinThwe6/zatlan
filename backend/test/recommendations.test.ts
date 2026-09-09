import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

type DocData = Record<string, unknown>;
const store = new Map<string, DocData>();

function makeDocRef(path: string) {
  return {
    id: path.split("/").pop()!,
    get: vi.fn(async () => ({
      exists: store.has(path),
      id: path.split("/").pop()!,
      data: () => store.get(path)
    })),
    collection: (sub: string) => makeCollectionRef(`${path}/${sub}`)
  };
}

function directChildren(path: string) {
  return [...store.entries()].filter(([key]) => {
    if (!key.startsWith(`${path}/`)) return false;
    return key.slice(path.length + 1).split("/").length === 1;
  });
}

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
            if (state.whereOp === "in") {
              return state.whereValues!.includes(value as string);
            }
            const arr = (value as string[] | undefined) ?? [];
            return arr.some((v) => state.whereValues!.includes(v));
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

  return {
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    ...query({})
  };
}

const db = { collection: (name: string) => makeCollectionRef(name) };

vi.mock("../src/lib/firebaseAdmin.js", () => ({
  auth: { verifyIdToken: vi.fn(async () => ({ uid: "uid-1" })) },
  db,
  requireDb: () => db,
  isFirebaseConfigured: () => true
}));

const { createApp } = await import("../src/app.js");

beforeEach(() => {
  store.clear();
  store.set("movies/dune", { title: "Dune: Part Two", genres: ["Sci-Fi", "Adventure"], voteAverage: 8.4 });
  store.set("movies/interstellar", { title: "Interstellar", genres: ["Sci-Fi", "Drama"], voteAverage: 8.6 });
  store.set("movies/inception", { title: "Inception", genres: ["Sci-Fi", "Thriller"], voteAverage: 8.3 });
  store.set("movies/notebook", { title: "The Notebook", genres: ["Romance", "Drama"], voteAverage: 7.8 });
  store.set("movies/whiplash", { title: "Whiplash", genres: ["Drama", "Music"], voteAverage: 8.5 });
});

function req(app: ReturnType<typeof createApp>) {
  return request(app).get("/recommendations").set("Authorization", "Bearer good");
}

describe("GET /recommendations", () => {
  it("401s without a token", async () => {
    const app = createApp();
    const res = await request(app).get("/recommendations");
    expect(res.status).toBe(401);
  });

  it("cold start (no watch history, no favoriteGenres): falls back to trending, sorted by voteAverage desc", async () => {
    store.set("users/uid-1", { favoriteGenres: null });
    const app = createApp();
    const res = await req(app);

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((m: { movieId: string }) => m.movieId)).toEqual([
      "interstellar",
      "whiplash",
      "dune",
      "inception",
      "notebook"
    ]);
  });

  it("uses favoriteGenres when there's no watch history yet", async () => {
    store.set("users/uid-1", { favoriteGenres: ["Romance"] });
    const app = createApp();
    const res = await req(app);

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((m: { movieId: string }) => m.movieId)).toEqual(["notebook"]);
  });

  it("derives preferred genres from watched-movie frequency when history exists", async () => {
    store.set("users/uid-1", { favoriteGenres: ["Romance"] }); // should be ignored — watch history takes priority
    store.set("users/uid-1/watched/inception", { watchedAt: new Date(), visibility: "public" });
    const app = createApp();
    const res = await req(app);

    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((m: { movieId: string }) => m.movieId);
    // Inception is Sci-Fi/Thriller — sci-fi titles should surface, romance should not
    expect(ids).toContain("dune");
    expect(ids).toContain("interstellar");
    expect(ids).not.toContain("notebook");
  });

  it("computes matchScore against the preference signal, null for the trending fallback", async () => {
    store.set("users/uid-1", { favoriteGenres: null });
    const trendingRes = await req(createApp());
    expect(trendingRes.body.data.items.every((m: { matchScore: unknown }) => m.matchScore === null)).toBe(true);

    store.set("users/uid-1", { favoriteGenres: ["Romance"] });
    const preferredRes = await req(createApp());
    const notebook = preferredRes.body.data.items.find((m: { movieId: string }) => m.movieId === "notebook");
    expect(notebook.matchScore).toBeGreaterThan(0);
    expect(notebook.matchScore).toBeLessThanOrEqual(100);
  });

  // Real reported bug: Home's "Top picks for you" showed the same
  // English-language bias onboarding's watched-candidates had — because this
  // never looked at preferredLanguages (saved during onboarding) at all,
  // only genres+voteAverage. The local index skews English, so a genre-first
  // top-CANDIDATE_POOL slice can bury a real match in a narrower language
  // someone actually picked.
  it("prioritizes preferredLanguages over genre when both are set — same local-index English-skew fix as onboarding's watched-candidates", async () => {
    for (let i = 0; i < 30; i++) {
      store.set(`movies/decoy${i}`, { title: `Decoy ${i}`, genres: ["Sci-Fi"], originalLanguage: "en", voteAverage: 9.0 });
    }
    store.set("movies/enthiran", { title: "Enthiran", genres: ["Sci-Fi"], originalLanguage: "ta", voteAverage: 7.0 });
    store.set("users/uid-1", { favoriteGenres: ["Sci-Fi"], preferredLanguages: ["ta"] });

    const app = createApp();
    const res = await req(app);

    expect(res.body.data.items.map((m: { movieId: string }) => m.movieId)).toEqual(["enthiran"]);
  });

  it("uses preferredLanguages alone when there's no genre signal at all", async () => {
    store.set("movies/ta-movie", { title: "Tamil Movie", genres: ["Drama"], originalLanguage: "ta", voteAverage: 6.0 });
    store.set("users/uid-1", { favoriteGenres: null, preferredLanguages: ["ta"] });

    const app = createApp();
    const res = await req(app);

    expect(res.body.data.items.map((m: { movieId: string }) => m.movieId)).toEqual(["ta-movie"]);
  });

  // Real reported bug: a movie could rank #1 in "Top picks for you" with a
  // mediocre matchScore (e.g. 40%) because the candidate pool is queried
  // ordered by voteAverage, and the final list was just that query's order
  // sliced to RESULT_LIMIT — matchScore was computed for the badge but never
  // fed back into ranking. A high-rated, barely-matching movie could outrank
  // a lower-rated, well-matching one.
  it("ranks by matchScore, not by the movie's own rating — a better genre match beats a higher-rated weaker match", async () => {
    store.set("movies/high-rating-weak-match", { title: "High Rating Weak Match", genres: ["Sci-Fi"], voteAverage: 9.5 }); // 1/2 genres -> ~64%
    store.set("movies/lower-rating-strong-match", {
      title: "Lower Rating Strong Match",
      genres: ["Sci-Fi", "Drama"],
      voteAverage: 7.0
    }); // 2/2 genres -> ~91%
    store.set("users/uid-1", { favoriteGenres: ["Sci-Fi", "Drama"] });

    const app = createApp();
    const res = await req(app);

    const ids = res.body.data.items.map((m: { movieId: string }) => m.movieId);
    const highRatingIndex = ids.indexOf("high-rating-weak-match");
    const strongMatchIndex = ids.indexOf("lower-rating-strong-match");
    expect(strongMatchIndex).toBeGreaterThanOrEqual(0);
    expect(highRatingIndex).toBeGreaterThanOrEqual(0);
    expect(strongMatchIndex).toBeLessThan(highRatingIndex); // the better match comes first despite the lower rating

    const byId = new Map(res.body.data.items.map((m: { movieId: string; matchScore: number }) => [m.movieId, m.matchScore]));
    expect(byId.get("lower-rating-strong-match")).toBeGreaterThan(byId.get("high-rating-weak-match") as number);
  });

  it("excludes movies already watched or watchlisted", async () => {
    store.set("users/uid-1", { favoriteGenres: null });
    store.set("users/uid-1/watched/interstellar", { watchedAt: new Date(), visibility: "public" });
    store.set("users/uid-1/watchlist/whiplash", { addedAt: new Date() });
    const app = createApp();
    const res = await req(app);

    const ids = res.body.data.items.map((m: { movieId: string }) => m.movieId);
    expect(ids).not.toContain("interstellar");
    expect(ids).not.toContain("whiplash");
  });
});

describe("GET /movies/:movieId/similar", () => {
  it("is reachable without a token — movie detail's right rail is public like the movie page itself", async () => {
    const res = await request(createApp()).get("/movies/dune/similar");
    expect(res.status).toBe(200);
  });

  it("404s for a nonexistent movie", async () => {
    const res = await request(createApp()).get("/movies/nope/similar");
    expect(res.status).toBe(404);
  });

  it("returns other movies sharing at least one genre, sorted by rating, excluding itself", async () => {
    const res = await request(createApp()).get("/movies/dune/similar"); // Sci-Fi, Adventure
    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((m: { movieId: string }) => m.movieId);
    expect(ids).not.toContain("dune");
    expect(ids).toEqual(["interstellar", "inception"]); // both Sci-Fi, sorted by voteAverage desc; notebook/whiplash share no genre with dune
  });

  it("returns an empty list for a movie with no genres on record", async () => {
    store.set("movies/no-genres", { title: "Mystery Movie", genres: [], voteAverage: 5 });
    const res = await request(createApp()).get("/movies/no-genres/similar");
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
  });
});
