import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

type DocData = Record<string, unknown>;
const store = new Map<string, DocData>();

function makeDocRef(path: string) {
  return {
    id: path.split("/").pop()!,
    get: vi.fn(async () => ({ exists: store.has(path), id: path.split("/").pop()!, data: () => store.get(path) })),
    set: vi.fn(async (value: DocData) => {
      store.set(path, value);
    }),
    delete: vi.fn(async () => {
      store.delete(path);
    }),
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
  return {
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    get: async () => ({ docs: directChildren(path).map(([key, data]) => ({ id: key.split("/").pop()!, data: () => data })) })
  };
}

type BatchOp = { type: "set" | "delete"; path: string; value?: DocData };

function makeBatch() {
  const ops: BatchOp[] = [];
  const batch = {
    set: (ref: { id: string }, value: DocData) => {
      ops.push({ type: "set", path: (ref as unknown as { __path: string }).__path, value });
      return batch;
    },
    delete: (ref: { id: string }) => {
      ops.push({ type: "delete", path: (ref as unknown as { __path: string }).__path });
      return batch;
    },
    commit: async () => {
      for (const op of ops) {
        if (op.type === "set") store.set(op.path, op.value!);
        else store.delete(op.path);
      }
    }
  };
  return batch;
}

const db = {
  collection: (name: string) => ({
    ...makeCollectionRef(name),
    doc: (id: string) => ({ ...makeDocRef(`${name}/${id}`), __path: `${name}/${id}` })
  }),
  batch: () => makeBatch()
};

// __path needs to propagate through nested .collection().doc() calls too.
let autoId = 0;
function withPath(ref: ReturnType<typeof makeDocRef>, path: string) {
  return {
    ...ref,
    __path: path,
    collection: (sub: string) => {
      const colPath = `${path}/${sub}`;
      return {
        doc: (id: string) => withPath(makeDocRef(`${colPath}/${id}`), `${colPath}/${id}`),
        get: async () => ({ docs: directChildren(colPath).map(([key, data]) => ({ id: key.split("/").pop()!, data: () => data })) }),
        add: async (value: DocData) => {
          const id = `auto-${++autoId}`;
          store.set(`${colPath}/${id}`, value);
          return withPath(makeDocRef(`${colPath}/${id}`), `${colPath}/${id}`);
        }
      };
    }
  };
}

const dbWithPaths = {
  collection: (name: string) => ({
    doc: (id: string) => withPath(makeDocRef(`${name}/${id}`), `${name}/${id}`),
    get: async () => ({ docs: directChildren(name).map(([key, data]) => ({ id: key.split("/").pop()!, data: () => data })) })
  }),
  batch: () => makeBatch()
};

vi.mock("../src/lib/firebaseAdmin.js", () => ({
  auth: { verifyIdToken: vi.fn(async () => ({ uid: "uid-1" })) },
  db: dbWithPaths,
  requireDb: () => dbWithPaths,
  isFirebaseConfigured: () => true
}));

const { createApp } = await import("../src/app.js");

beforeEach(() => {
  store.clear();
});

function authed(app: ReturnType<typeof createApp>, method: "put" | "delete" | "get" | "post", path: string) {
  return request(app)[method](path).set("Authorization", "Bearer good");
}

describe("PUT /users/:uid/follow", () => {
  it("401s without a token", async () => {
    const app = createApp();
    const res = await request(app).put("/users/uid-2/follow");
    expect(res.status).toBe(401);
  });

  it("400s when following yourself", async () => {
    const app = createApp();
    const res = await authed(app, "put", "/users/uid-1/follow");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CANNOT_FOLLOW_SELF");
  });

  it("404s for a nonexistent user", async () => {
    const app = createApp();
    const res = await authed(app, "put", "/users/no-such-user/follow");
    expect(res.status).toBe(404);
  });

  it("follows instantly when the target doesn't require approval", async () => {
    store.set("users/uid-2", { followRequiresApproval: false });
    const app = createApp();
    const res = await authed(app, "put", "/users/uid-2/follow");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: "following" });
    expect(store.has("users/uid-1/following/uid-2")).toBe(true);
    expect(store.has("users/uid-2/followers/uid-1")).toBe(true);
  });

  it("creates a pending request when the target requires approval", async () => {
    store.set("users/uid-2", { followRequiresApproval: true });
    const app = createApp();
    const res = await authed(app, "put", "/users/uid-2/follow");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: "pending" });
    expect(store.has("users/uid-2/followRequests/uid-1")).toBe(true);
    expect(store.has("users/uid-1/following/uid-2")).toBe(false);
  });

  it("is idempotent — re-following an already-followed user is a no-op success", async () => {
    store.set("users/uid-2", { followRequiresApproval: false });
    store.set("users/uid-1/following/uid-2", { createdAt: new Date() });
    const app = createApp();
    const res = await authed(app, "put", "/users/uid-2/follow");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: "following" });

    const notifications = [...store.entries()].filter(([key]) => key.startsWith("users/uid-2/notifications/"));
    expect(notifications).toHaveLength(0); // already following — no repeat "new follower" spam
  });

  it("notifies the target of a new follower when following doesn't require approval", async () => {
    store.set("users/uid-2", { followRequiresApproval: false });
    const app = createApp();
    await authed(app, "put", "/users/uid-2/follow");

    const notifications = [...store.entries()].filter(([key]) => key.startsWith("users/uid-2/notifications/"));
    expect(notifications).toHaveLength(1);
    expect(notifications[0][1]).toMatchObject({ type: "newFollower", fromUserId: "uid-1", targetType: "user", targetId: "uid-1" });
  });
});

describe("DELETE /users/:uid/follow", () => {
  it("removes the following/followers pair and any pending request", async () => {
    store.set("users/uid-1/following/uid-2", { createdAt: new Date() });
    store.set("users/uid-2/followers/uid-1", { createdAt: new Date() });
    const app = createApp();
    const res = await authed(app, "delete", "/users/uid-2/follow");
    expect(res.status).toBe(204);
    expect(store.has("users/uid-1/following/uid-2")).toBe(false);
    expect(store.has("users/uid-2/followers/uid-1")).toBe(false);
  });
});

describe("follow requests", () => {
  it("GET lists pending requests for the caller to review", async () => {
    store.set("users/uid-1/followRequests/uid-2", { createdAt: new Date() });
    store.set("users/uid-2", { displayName: "Rohan" });
    const app = createApp();
    const res = await authed(app, "get", "/users/me/followRequests");
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([{ uid: "uid-2", displayName: "Rohan", photoURL: null }]);
  });

  it("approve creates the following/followers pair and clears the request", async () => {
    store.set("users/uid-1/followRequests/uid-2", { createdAt: new Date() });
    const app = createApp();
    const res = await authed(app, "post", "/users/me/followRequests/uid-2/approve");
    expect(res.status).toBe(204);
    expect(store.has("users/uid-2/following/uid-1")).toBe(true);
    expect(store.has("users/uid-1/followers/uid-2")).toBe(true);
    expect(store.has("users/uid-1/followRequests/uid-2")).toBe(false);
  });

  it("approve 404s when there's no such pending request", async () => {
    const app = createApp();
    const res = await authed(app, "post", "/users/me/followRequests/uid-2/approve");
    expect(res.status).toBe(404);
  });

  it("deny just clears the request, no relationship created", async () => {
    store.set("users/uid-1/followRequests/uid-2", { createdAt: new Date() });
    const app = createApp();
    const res = await authed(app, "post", "/users/me/followRequests/uid-2/deny");
    expect(res.status).toBe(204);
    expect(store.has("users/uid-1/followRequests/uid-2")).toBe(false);
    expect(store.has("users/uid-2/following/uid-1")).toBe(false);
  });
});
