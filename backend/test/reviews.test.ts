import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

type DocData = Record<string, unknown>;
type Where = { field: string; op: string; value: unknown };
const store = new Map<string, DocData>();

function directChildren(path: string) {
  return [...store.entries()].filter(([key]) => {
    if (!key.startsWith(`${path}/`)) return false;
    return key.slice(path.length + 1).split("/").length === 1;
  });
}

function docRef(path: string) {
  return {
    id: path.split("/").pop()!,
    __path: path,
    get: async () => ({ exists: store.has(path), id: path.split("/").pop()!, data: () => store.get(path) }),
    set: async (v: DocData) => {
      store.set(path, v);
    },
    update: async (patch: DocData) => {
      const existing = store.get(path) ?? {};
      store.set(path, { ...existing, ...patch });
    },
    delete: async () => {
      store.delete(path);
    },
    collection: (sub: string) => collectionRef(`${path}/${sub}`)
  };
}

function matchWhere(data: DocData, w: Where): boolean {
  const val = data[w.field];
  if (w.op === "==") return val === w.value;
  return true;
}

function collectionRef(path: string) {
  function query(state: { wheres?: Where[]; orderField?: string; dir?: "asc" | "desc"; lim?: number; after?: DocData }) {
    return {
      where: (field: string, op: string, value: unknown) => query({ ...state, wheres: [...(state.wheres ?? []), { field, op, value }] }),
      orderBy: (field: string, dir: "asc" | "desc" = "asc") => query({ ...state, orderField: field, dir }),
      limit: (n: number) => query({ ...state, lim: n }),
      startAfter: (snap: { data: () => DocData }) => query({ ...state, after: snap.data() }),
      get: async () => {
        let entries = directChildren(path);
        for (const w of state.wheres ?? []) entries = entries.filter(([, data]) => matchWhere(data, w));
        if (state.orderField) {
          const field = state.orderField;
          entries = entries.sort((a, b) => {
            const av = (a[1][field] as Date)?.getTime?.() ?? 0;
            const bv = (b[1][field] as Date)?.getTime?.() ?? 0;
            return state.dir === "desc" ? bv - av : av - bv;
          });
          if (state.after) {
            const afterVal = (state.after[field] as Date).getTime();
            entries = entries.filter(([, data]) => {
              const v = (data[field] as Date).getTime();
              return state.dir === "desc" ? v < afterVal : v > afterVal;
            });
          }
        }
        if (state.lim) entries = entries.slice(0, state.lim);
        return { docs: entries.map(([key, data]) => ({ id: key.split("/").pop()!, data: () => data })) };
      }
    };
  }
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    ...query({})
  };
}

const db = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
      set: (ref: { __path: string }, v: DocData) => store.set(ref.__path, v),
      update: (ref: { __path: string }, patch: DocData) => {
        const existing = store.get(ref.__path) ?? {};
        store.set(ref.__path, { ...existing, ...patch });
      },
      delete: (ref: { __path: string }) => store.delete(ref.__path)
    };
    return fn(tx);
  }
};

let currentUid = "uid-1";
vi.mock("../src/lib/firebaseAdmin.js", () => ({
  auth: { verifyIdToken: vi.fn(async () => ({ uid: currentUid })) },
  db,
  requireDb: () => db,
  isFirebaseConfigured: () => true
}));

const { createApp } = await import("../src/app.js");

beforeEach(() => {
  store.clear();
  currentUid = "uid-1";
  store.set("movies/movie-1", { title: "Dune: Part Two", genres: ["Sci-Fi"], zatlanRating: { sum: 0, count: 0 } });
  store.set("users/uid-1", { displayName: "Arjun", status: "active" });
});

function authed(app: ReturnType<typeof createApp>, method: "put" | "delete" | "get", path: string) {
  return request(app)[method](path).set("Authorization", "Bearer good");
}

describe("PUT /movies/:movieId/reviews/me", () => {
  it("401s without a token", async () => {
    const app = createApp();
    const res = await request(app).put("/movies/movie-1/reviews/me").send({ rating: 5, isAnonymous: false });
    expect(res.status).toBe(401);
  });

  it("404s when the movie doesn't exist", async () => {
    const app = createApp();
    const res = await authed(app, "put", "/movies/no-such-movie/reviews/me").send({ rating: 5, isAnonymous: false });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("MOVIE_NOT_FOUND");
  });

  it("403s when the caller's account is restricted", async () => {
    store.set("users/uid-1", { displayName: "Arjun", status: "restricted" });
    const app = createApp();
    const res = await authed(app, "put", "/movies/movie-1/reviews/me").send({ rating: 5, isAnonymous: false });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_RESTRICTED");
  });

  it("400s when rating is missing or out of range", async () => {
    const app = createApp();
    const missing = await authed(app, "put", "/movies/movie-1/reviews/me").send({ isAnonymous: false });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("INVALID_RATING");

    const tooHigh = await authed(app, "put", "/movies/movie-1/reviews/me").send({ rating: 6, isAnonymous: false });
    expect(tooHigh.status).toBe(400);

    const notInteger = await authed(app, "put", "/movies/movie-1/reviews/me").send({ rating: 3.5, isAnonymous: false });
    expect(notInteger.status).toBe(400);
  });

  it("400s when isAnonymous is missing or not boolean", async () => {
    const app = createApp();
    const res = await authed(app, "put", "/movies/movie-1/reviews/me").send({ rating: 5 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_BODY");
  });

  it("first-time submit creates the review and updates the movie's aggregate", async () => {
    const app = createApp();
    const res = await authed(app, "put", "/movies/movie-1/reviews/me").send({ rating: 4, isAnonymous: false });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ rating: 4, reviewText: null, isAnonymous: false });
    expect(res.body.data).not.toHaveProperty("authorId");

    const movie = store.get("movies/movie-1") as { zatlanRating: { sum: number; count: number } };
    expect(movie.zatlanRating).toEqual({ sum: 4, count: 1 });

    const review = store.get("movies/movie-1/reviews/uid-1") as { deleted: boolean; createdAt: unknown };
    expect(review.deleted).toBe(false);
    expect(review.createdAt).toBeInstanceOf(Date);
  });

  it("editing an existing review adjusts sum by the delta, count unchanged, createdAt preserved", async () => {
    const app = createApp();
    await authed(app, "put", "/movies/movie-1/reviews/me").send({ rating: 3, isAnonymous: false });
    const firstCreatedAt = (store.get("movies/movie-1/reviews/uid-1") as { createdAt: Date }).createdAt;

    const res = await authed(app, "put", "/movies/movie-1/reviews/me").send({ rating: 5, isAnonymous: false, reviewText: "Actually loved it" });
    expect(res.status).toBe(200);

    const movie = store.get("movies/movie-1") as { zatlanRating: { sum: number; count: number } };
    expect(movie.zatlanRating).toEqual({ sum: 5, count: 1 }); // 3 -> 5 is +2, sum was 3, now 5; count stays 1

    const review = store.get("movies/movie-1/reviews/uid-1") as { createdAt: Date; reviewText: string };
    expect(review.createdAt).toEqual(firstCreatedAt);
    expect(review.reviewText).toBe("Actually loved it");
  });

  it("resubmitting after a soft-delete counts as first-time again, not an edit", async () => {
    const app = createApp();
    await authed(app, "put", "/movies/movie-1/reviews/me").send({ rating: 4, isAnonymous: false });
    await authed(app, "delete", "/movies/movie-1/reviews/me");
    expect((store.get("movies/movie-1") as { zatlanRating: { sum: number; count: number } }).zatlanRating).toEqual({ sum: 0, count: 0 });

    const res = await authed(app, "put", "/movies/movie-1/reviews/me").send({ rating: 5, isAnonymous: false });
    expect(res.status).toBe(200);
    const movie = store.get("movies/movie-1") as { zatlanRating: { sum: number; count: number } };
    expect(movie.zatlanRating).toEqual({ sum: 5, count: 1 });
  });

  it("omitting reviewText stores null", async () => {
    const app = createApp();
    const res = await authed(app, "put", "/movies/movie-1/reviews/me").send({ rating: 5, isAnonymous: false });
    expect(res.body.data.reviewText).toBeNull();
  });
});

describe("DELETE /movies/:movieId/reviews/me", () => {
  it("401s without a token", async () => {
    const app = createApp();
    const res = await request(app).delete("/movies/movie-1/reviews/me");
    expect(res.status).toBe(401);
  });

  it("404s when the caller has no review for this movie", async () => {
    const app = createApp();
    const res = await authed(app, "delete", "/movies/movie-1/reviews/me");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("REVIEW_NOT_FOUND");
  });

  it("404s when the caller's review is already soft-deleted", async () => {
    const app = createApp();
    await authed(app, "put", "/movies/movie-1/reviews/me").send({ rating: 4, isAnonymous: false });
    await authed(app, "delete", "/movies/movie-1/reviews/me");
    const res = await authed(app, "delete", "/movies/movie-1/reviews/me");
    expect(res.status).toBe(404);
  });

  it("soft-deletes and reverses the aggregate contribution", async () => {
    const app = createApp();
    await authed(app, "put", "/movies/movie-1/reviews/me").send({ rating: 4, isAnonymous: false });
    const res = await authed(app, "delete", "/movies/movie-1/reviews/me");
    expect(res.status).toBe(204);

    const review = store.get("movies/movie-1/reviews/uid-1") as { deleted: boolean };
    expect(review.deleted).toBe(true);
    const movie = store.get("movies/movie-1") as { zatlanRating: { sum: number; count: number } };
    expect(movie.zatlanRating).toEqual({ sum: 0, count: 0 });
  });
});

describe("GET /movies/:movieId/reviews", () => {
  it("returns only non-deleted reviews, newest first", async () => {
    store.set("movies/movie-1/reviews/uid-2", {
      rating: 5, reviewText: "Great", isAnonymous: false, deleted: false,
      createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01")
    });
    store.set("movies/movie-1/reviews/uid-3", {
      rating: 2, reviewText: "Meh", isAnonymous: false, deleted: false,
      createdAt: new Date("2026-01-02"), updatedAt: new Date("2026-01-02")
    });
    store.set("movies/movie-1/reviews/uid-4", {
      rating: 1, reviewText: "Removed", isAnonymous: false, deleted: true,
      createdAt: new Date("2026-01-03"), updatedAt: new Date("2026-01-03")
    });
    store.set("users/uid-2", { displayName: "Meera" });
    store.set("users/uid-3", { displayName: "Rohan" });

    const app = createApp();
    const res = await request(app).get("/movies/movie-1/reviews");
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((r: { authorId: string }) => r.authorId)).toEqual(["uid-3", "uid-2"]);
  });

  it("redacts authorId and displayName server-side for anonymous reviews", async () => {
    store.set("movies/movie-1/reviews/uid-2", {
      rating: 5, reviewText: "Great", isAnonymous: true, deleted: false,
      createdAt: new Date(), updatedAt: new Date()
    });
    store.set("users/uid-2", { displayName: "Meera" });

    const app = createApp();
    const res = await request(app).get("/movies/movie-1/reviews");
    expect(res.body.data.items[0].authorId).toBeNull();
    expect(res.body.data.items[0].displayName).toBeNull();
  });

  it("includes real authorId and displayName for non-anonymous reviews", async () => {
    store.set("movies/movie-1/reviews/uid-2", {
      rating: 5, reviewText: "Great", isAnonymous: false, deleted: false,
      createdAt: new Date(), updatedAt: new Date()
    });
    store.set("users/uid-2", { displayName: "Meera" });

    const app = createApp();
    const res = await request(app).get("/movies/movie-1/reviews");
    expect(res.body.data.items[0]).toMatchObject({ authorId: "uid-2", displayName: "Meera" });
  });
});
