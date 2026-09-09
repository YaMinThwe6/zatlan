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
    get: async () => ({ exists: store.has(path), id: path.split("/").pop()!, data: () => store.get(path) }),
    update: async (patch: DocData) => {
      const existing = store.get(path) ?? {};
      store.set(path, { ...existing, ...patch });
    }
  };
}

function matchWhere(data: DocData, w: Where): boolean {
  if (w.op === "==") return data[w.field] === w.value;
  return true;
}

function collectionRef(path: string) {
  function query(state: { wheres?: Where[]; orderField?: string; dir?: "asc" | "desc"; lim?: number }) {
    return {
      where: (field: string, op: string, value: unknown) => query({ ...state, wheres: [...(state.wheres ?? []), { field, op, value }] }),
      orderBy: (field: string, dir: "asc" | "desc" = "asc") => query({ ...state, orderField: field, dir }),
      limit: (n: number) => query({ ...state, lim: n }),
      get: async () => {
        let entries = directChildren(path);
        for (const w of state.wheres ?? []) entries = entries.filter(([, data]) => matchWhere(data, w));
        if (state.orderField) {
          const field = state.orderField;
          entries = entries.sort((a, b) => {
            const av = (a[1][field] as Date).getTime();
            const bv = (b[1][field] as Date).getTime();
            return state.dir === "desc" ? bv - av : av - bv;
          });
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

const db = { collection: (name: string) => ({ ...collectionRef(name), doc: (id: string) => ({ ...docRef(`${name}/${id}`), collection: (sub: string) => collectionRef(`${name}/${id}/${sub}`) }) }) };

vi.mock("../src/lib/firebaseAdmin.js", () => ({
  auth: { verifyIdToken: vi.fn(async () => ({ uid: "uid-1" })) },
  db,
  requireDb: () => db,
  isFirebaseConfigured: () => true
}));

const { createApp } = await import("../src/app.js");

beforeEach(() => {
  store.clear();
});

describe("GET /users/me/notifications", () => {
  it("401s without a token", async () => {
    const app = createApp();
    const res = await request(app).get("/users/me/notifications");
    expect(res.status).toBe(401);
  });

  it("returns notifications newest first", async () => {
    store.set("users/uid-1/notifications/n1", { type: "followRequest", fromUserId: "uid-2", read: false, createdAt: new Date("2026-01-01") });
    store.set("users/uid-1/notifications/n2", { type: "eventJoinApproved", fromUserId: "uid-3", read: true, createdAt: new Date("2026-01-02") });
    const app = createApp();
    const res = await request(app).get("/users/me/notifications").set("Authorization", "Bearer good");
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((n: { id: string }) => n.id)).toEqual(["n2", "n1"]);
  });

  it("joins in the sender's displayName/photoURL — the notification center needs a name, not just a bare fromUserId", async () => {
    store.set("users/uid-2", { displayName: "Rohan", photoURL: "/rohan.jpg" });
    store.set("users/uid-1/notifications/n1", { type: "followRequest", fromUserId: "uid-2", read: false, createdAt: new Date("2026-01-01") });
    const app = createApp();
    const res = await request(app).get("/users/me/notifications").set("Authorization", "Bearer good");
    expect(res.body.data.items[0]).toMatchObject({ fromUserDisplayName: "Rohan", fromUserPhotoURL: "/rohan.jpg" });
  });

  it("leaves fromUserDisplayName/fromUserPhotoURL null when a notification has no fromUserId", async () => {
    store.set("users/uid-1/notifications/n1", { type: "moderationWarning", fromUserId: null, read: false, createdAt: new Date("2026-01-01") });
    const app = createApp();
    const res = await request(app).get("/users/me/notifications").set("Authorization", "Bearer good");
    expect(res.body.data.items[0]).toMatchObject({ fromUserDisplayName: null, fromUserPhotoURL: null });
  });

  it("filters to unread only when unreadOnly=true", async () => {
    store.set("users/uid-1/notifications/n1", { type: "followRequest", fromUserId: "uid-2", read: false, createdAt: new Date("2026-01-01") });
    store.set("users/uid-1/notifications/n2", { type: "eventJoinApproved", fromUserId: "uid-3", read: true, createdAt: new Date("2026-01-02") });
    const app = createApp();
    const res = await request(app).get("/users/me/notifications?unreadOnly=true").set("Authorization", "Bearer good");
    expect(res.body.data.items.map((n: { id: string }) => n.id)).toEqual(["n1"]);
  });
});

describe("PATCH /users/me/notifications/:id", () => {
  it("marks a notification read", async () => {
    store.set("users/uid-1/notifications/n1", { type: "followRequest", fromUserId: "uid-2", read: false, createdAt: new Date() });
    const app = createApp();
    const res = await request(app).patch("/users/me/notifications/n1").set("Authorization", "Bearer good").send({ read: true });
    expect(res.status).toBe(204);
    expect((store.get("users/uid-1/notifications/n1") as { read: boolean }).read).toBe(true);
  });

  it("404s for a nonexistent notification", async () => {
    const app = createApp();
    const res = await request(app).patch("/users/me/notifications/no-such").set("Authorization", "Bearer good").send({ read: true });
    expect(res.status).toBe(404);
  });

  it("400s when the body isn't { read: true }", async () => {
    store.set("users/uid-1/notifications/n1", { type: "followRequest", read: false, createdAt: new Date() });
    const app = createApp();
    const res = await request(app).patch("/users/me/notifications/n1").set("Authorization", "Bearer good").send({ read: false });
    expect(res.status).toBe(400);
  });
});

describe("POST /users/me/notifications/clear", () => {
  it("401s without a token", async () => {
    const app = createApp();
    const res = await request(app).post("/users/me/notifications/clear");
    expect(res.status).toBe(401);
  });

  it("marks every one of the caller's unread notifications read", async () => {
    store.set("users/uid-1/notifications/n1", { type: "followRequest", read: false, createdAt: new Date("2026-01-01") });
    store.set("users/uid-1/notifications/n2", { type: "eventJoinApproved", read: false, createdAt: new Date("2026-01-02") });
    store.set("users/uid-1/notifications/n3", { type: "chatActive", read: true, createdAt: new Date("2026-01-03") });
    const app = createApp();
    const res = await request(app).post("/users/me/notifications/clear").set("Authorization", "Bearer good");
    expect(res.status).toBe(204);

    expect((store.get("users/uid-1/notifications/n1") as { read: boolean }).read).toBe(true);
    expect((store.get("users/uid-1/notifications/n2") as { read: boolean }).read).toBe(true);
    expect((store.get("users/uid-1/notifications/n3") as { read: boolean }).read).toBe(true);
  });

  it("only touches the caller's own notifications, not another user's", async () => {
    store.set("users/uid-1/notifications/n1", { type: "followRequest", read: false, createdAt: new Date() });
    store.set("users/uid-2/notifications/n2", { type: "followRequest", read: false, createdAt: new Date() });
    const app = createApp();
    await request(app).post("/users/me/notifications/clear").set("Authorization", "Bearer good");

    expect((store.get("users/uid-1/notifications/n1") as { read: boolean }).read).toBe(true);
    expect((store.get("users/uid-2/notifications/n2") as { read: boolean }).read).toBe(false);
  });

  it("is a no-op success when there's nothing to clear", async () => {
    const app = createApp();
    const res = await request(app).post("/users/me/notifications/clear").set("Authorization", "Bearer good");
    expect(res.status).toBe(204);
  });
});
