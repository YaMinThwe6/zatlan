import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

type DocData = Record<string, unknown>;
type Where = { field: string; op: string; value: unknown };
const store = new Map<string, DocData>();
let autoCounter = 0;

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
  function query(state: { wheres?: Where[]; orderField?: string; dir?: "asc" | "desc"; lim?: number }) {
    return {
      where: (field: string, op: string, value: unknown) => query({ ...state, wheres: [...(state.wheres ?? []), { field, op, value }] }),
      orderBy: (field: string, dir: "asc" | "desc" = "asc") => query({ ...state, orderField: field, dir }),
      limit: (n: number) => query({ ...state, lim: n }),
      get: async () => {
        let entries = directChildren(path);
        for (const w of state.wheres ?? []) entries = entries.filter(([, data]) => matchWhere(data, w));
        return { docs: entries.map(([key, data]) => ({ id: key.split("/").pop()!, data: () => data })) };
      }
    };
  }
  return {
    doc: (id?: string) => docRef(`${path}/${id ?? `auto-${++autoCounter}`}`),
    add: async (value: DocData) => {
      const ref = docRef(`${path}/auto-${++autoCounter}`);
      await ref.set(value);
      return ref;
    },
    ...query({})
  };
}

function makeBatch() {
  type Op = { type: "set" | "update" | "delete"; path: string; value?: DocData };
  const ops: Op[] = [];
  const batch = {
    set: (ref: { __path: string }, value: DocData) => {
      ops.push({ type: "set", path: ref.__path, value });
      return batch;
    },
    update: (ref: { __path: string }, value: DocData) => {
      ops.push({ type: "update", path: ref.__path, value });
      return batch;
    },
    delete: (ref: { __path: string }) => {
      ops.push({ type: "delete", path: ref.__path });
      return batch;
    },
    commit: async () => {
      for (const op of ops) {
        if (op.type === "set") store.set(op.path, op.value!);
        else if (op.type === "update") store.set(op.path, { ...(store.get(op.path) ?? {}), ...op.value! });
        else store.delete(op.path);
      }
    }
  };
  return batch;
}

const db = {
  collection: (name: string) => collectionRef(name),
  batch: () => makeBatch(),
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
  autoCounter = 0;
  currentUid = "uid-1";
  store.set("users/uid-1", { displayName: "Arjun", status: "active" });
  store.set("movies/movie-1", { title: "Dune: Part Two" });
});

function authed(app: ReturnType<typeof createApp>, method: "get" | "post" | "patch" | "delete", path: string) {
  return request(app)[method](path).set("Authorization", "Bearer good");
}

describe("GET /rooms/:roomId", () => {
  it("401s without a token", async () => {
    const app = createApp();
    const res = await request(app).get("/rooms/room-1");
    expect(res.status).toBe(401);
  });

  it("404s for a nonexistent room", async () => {
    const app = createApp();
    const res = await authed(app, "get", "/rooms/no-such-room");
    expect(res.status).toBe(404);
  });

  it("403s when the caller isn't a member of the room", async () => {
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["someone-else"] });
    const app = createApp();
    const res = await authed(app, "get", "/rooms/room-1");
    expect(res.status).toBe(403);
  });

  it("returns the event's title and every member's display name, for RoomChat's own header and message-author labels", async () => {
    store.set("users/uid-2", { displayName: "Rohan", status: "active" });
    store.set("events/evt-1", { hostId: "uid-1", movieId: "movie-1", title: "Rooftop watch" });
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["uid-1", "uid-2"] });
    const app = createApp();
    const res = await authed(app, "get", "/rooms/room-1");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      roomId: "room-1",
      eventTitle: "Rooftop watch",
      members: expect.arrayContaining([
        { uid: "uid-1", displayName: "Arjun" },
        { uid: "uid-2", displayName: "Rohan" }
      ])
    });
  });

  it("falls back to the movie's title when the event has no custom title", async () => {
    store.set("events/evt-1", { hostId: "uid-1", movieId: "movie-1", title: null });
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["uid-1"] });
    const app = createApp();
    const res = await authed(app, "get", "/rooms/room-1");
    expect(res.body.data.eventTitle).toBe("Dune: Part Two");
  });
});

describe("POST /rooms/:roomId/messages", () => {
  it("401s without a token", async () => {
    const app = createApp();
    const res = await request(app).post("/rooms/room-1/messages").send({ text: "hi" });
    expect(res.status).toBe(401);
  });

  it("404s for a nonexistent room", async () => {
    const app = createApp();
    const res = await authed(app, "post", "/rooms/no-such-room/messages").send({ text: "hi" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ROOM_NOT_FOUND");
  });

  it("403s when the caller isn't a member of the room", async () => {
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["someone-else"] });
    const app = createApp();
    const res = await authed(app, "post", "/rooms/room-1/messages").send({ text: "hi" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("400s on empty or missing text", async () => {
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["uid-1"] });
    const app = createApp();
    const missing = await authed(app, "post", "/rooms/room-1/messages").send({});
    expect(missing.status).toBe(400);
    const blank = await authed(app, "post", "/rooms/room-1/messages").send({ text: "   " });
    expect(blank.status).toBe(400);
  });

  it("403s ACCOUNT_RESTRICTED-equivalent when the caller's account isn't active", async () => {
    store.set("users/uid-1", { displayName: "Arjun", status: "restricted" });
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["uid-1"] });
    const app = createApp();
    const res = await authed(app, "post", "/rooms/room-1/messages").send({ text: "hi" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_RESTRICTED");
  });

  it("writes the message and returns messageId + createdAt", async () => {
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["uid-1"] });
    const app = createApp();
    const res = await authed(app, "post", "/rooms/room-1/messages").send({ text: "Hey, starting soon!" });
    expect(res.status).toBe(201);
    expect(typeof res.body.data.messageId).toBe("string");
    expect(typeof res.body.data.createdAt).toBe("string");

    const stored = store.get(`rooms/room-1/messages/${res.body.data.messageId}`) as { authorId: string; text: string; deleted: boolean };
    expect(stored).toEqual(expect.objectContaining({ authorId: "uid-1", text: "Hey, starting soon!", deleted: false }));
  });

  it("notifies the other room members that the chat is live when it hasn't notified in the last 30 minutes", async () => {
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["uid-1", "uid-2", "uid-3"] });
    const app = createApp();
    const res = await authed(app, "post", "/rooms/room-1/messages").send({ text: "anyone around?" });
    expect(res.status).toBe(201);

    const uid2Notifications = [...store.entries()].filter(([key]) => key.startsWith("users/uid-2/notifications/"));
    const uid3Notifications = [...store.entries()].filter(([key]) => key.startsWith("users/uid-3/notifications/"));
    expect(uid2Notifications).toHaveLength(1);
    expect(uid2Notifications[0][1]).toMatchObject({ type: "chatActive", fromUserId: "uid-1", targetType: "room", targetId: "room-1" });
    expect(uid3Notifications).toHaveLength(1);

    // the sender doesn't notify themselves
    const uid1Notifications = [...store.entries()].filter(([key]) => key.startsWith("users/uid-1/notifications/"));
    expect(uid1Notifications).toHaveLength(0);
  });

  it("doesn't re-notify within 30 minutes of the room's last chat-active notification", async () => {
    store.set("rooms/room-1", {
      type: "ephemeral",
      originEventId: "evt-1",
      memberIds: ["uid-1", "uid-2"],
      lastChatNotifiedAt: new Date(Date.now() - 5 * 60 * 1000)
    });
    const app = createApp();
    const res = await authed(app, "post", "/rooms/room-1/messages").send({ text: "still here" });
    expect(res.status).toBe(201);

    const uid2Notifications = [...store.entries()].filter(([key]) => key.startsWith("users/uid-2/notifications/"));
    expect(uid2Notifications).toHaveLength(0);
  });

  it("notifies again once 30+ minutes have passed since the last chat-active notification", async () => {
    store.set("rooms/room-1", {
      type: "ephemeral",
      originEventId: "evt-1",
      memberIds: ["uid-1", "uid-2"],
      lastChatNotifiedAt: new Date(Date.now() - 31 * 60 * 1000)
    });
    const app = createApp();
    const res = await authed(app, "post", "/rooms/room-1/messages").send({ text: "back again" });
    expect(res.status).toBe(201);

    const uid2Notifications = [...store.entries()].filter(([key]) => key.startsWith("users/uid-2/notifications/"));
    expect(uid2Notifications).toHaveLength(1);
  });
});

describe("PATCH /rooms/:roomId/messages/:messageId", () => {
  it("author can edit their own message", async () => {
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["uid-1"] });
    store.set("rooms/room-1/messages/msg-1", { authorId: "uid-1", text: "oops typo", createdAt: new Date(), editedAt: null, deleted: false });
    const app = createApp();
    const res = await authed(app, "patch", "/rooms/room-1/messages/msg-1").send({ text: "fixed now" });
    expect(res.status).toBe(200);
    const stored = store.get("rooms/room-1/messages/msg-1") as { text: string; editedAt: Date | null };
    expect(stored.text).toBe("fixed now");
    expect(stored.editedAt).not.toBeNull();
  });

  it("403s when someone other than the author tries to edit", async () => {
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["uid-1", "uid-2"] });
    store.set("rooms/room-1/messages/msg-1", { authorId: "uid-2", text: "not yours", createdAt: new Date(), editedAt: null, deleted: false });
    const app = createApp();
    const res = await authed(app, "patch", "/rooms/room-1/messages/msg-1").send({ text: "hijacked" });
    expect(res.status).toBe(403);
  });

  it("404s for a nonexistent or already-deleted message", async () => {
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["uid-1"] });
    store.set("rooms/room-1/messages/msg-deleted", { authorId: "uid-1", text: "gone", createdAt: new Date(), editedAt: null, deleted: true });
    const app = createApp();
    const missing = await authed(app, "patch", "/rooms/room-1/messages/no-such").send({ text: "x" });
    expect(missing.status).toBe(404);
    const deleted = await authed(app, "patch", "/rooms/room-1/messages/msg-deleted").send({ text: "x" });
    expect(deleted.status).toBe(404);
  });
});

describe("DELETE /rooms/:roomId/messages/:messageId", () => {
  it("soft-deletes the author's own message", async () => {
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["uid-1"] });
    store.set("rooms/room-1/messages/msg-1", { authorId: "uid-1", text: "bye", createdAt: new Date(), editedAt: null, deleted: false });
    const app = createApp();
    const res = await authed(app, "delete", "/rooms/room-1/messages/msg-1");
    expect(res.status).toBe(204);
    const stored = store.get("rooms/room-1/messages/msg-1") as { deleted: boolean; text: string };
    expect(stored.deleted).toBe(true);
    expect(stored.text).toBe("bye"); // soft delete — content survives for moderator review, §21
  });

  it("403s when someone other than the author tries to delete", async () => {
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["uid-1", "uid-2"] });
    store.set("rooms/room-1/messages/msg-1", { authorId: "uid-2", text: "not yours", createdAt: new Date(), editedAt: null, deleted: false });
    const app = createApp();
    const res = await authed(app, "delete", "/rooms/room-1/messages/msg-1");
    expect(res.status).toBe(403);
  });
});

describe("PATCH /rooms/:roomId (promote to persistent)", () => {
  it("404s for a nonexistent room", async () => {
    const app = createApp();
    const res = await authed(app, "patch", "/rooms/no-such-room");
    expect(res.status).toBe(404);
  });

  it("host can promote their event's ephemeral room to persistent", async () => {
    store.set("events/evt-1", { hostId: "uid-1", movieId: "movie-1" });
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["uid-1"] });
    const app = createApp();
    const res = await authed(app, "patch", "/rooms/room-1");
    expect(res.status).toBe(200);
    expect((store.get("rooms/room-1") as { type: string }).type).toBe("persistent");
  });

  it("403s for a non-host", async () => {
    store.set("events/evt-1", { hostId: "someone-else", movieId: "movie-1" });
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["uid-1", "someone-else"] });
    const app = createApp();
    const res = await authed(app, "patch", "/rooms/room-1");
    expect(res.status).toBe(403);
  });

  it("is idempotent — promoting an already-persistent room is a no-op success", async () => {
    store.set("events/evt-1", { hostId: "someone-else", movieId: "movie-1" }); // not the host — would 403 if not already idempotent
    store.set("rooms/room-1", { type: "persistent", originEventId: "evt-1", memberIds: ["uid-1"] });
    const app = createApp();
    const res = await authed(app, "patch", "/rooms/room-1");
    expect(res.status).toBe(200);
  });
});

describe("POST /rooms/:roomId/events (schedule from a persistent room)", () => {
  const eventBody = {
    movieId: "movie-1",
    datetime: "2099-01-01T20:00:00.000Z",
    mode: "online",
    visibility: "private",
    participantLimit: 5,
    requiresApproval: false
  };

  it("400s when the room isn't persistent yet", async () => {
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["uid-1"] });
    const app = createApp();
    const res = await authed(app, "post", "/rooms/room-1/events").send(eventBody);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ROOM_NOT_PERSISTENT");
  });

  it("403s when the caller isn't a member", async () => {
    store.set("rooms/room-1", { type: "persistent", originEventId: "evt-1", memberIds: ["someone-else"] });
    const app = createApp();
    const res = await authed(app, "post", "/rooms/room-1/events").send(eventBody);
    expect(res.status).toBe(403);
  });

  it("creates a new event linked back to the same room, defaulting invitedUserIds to the room's members", async () => {
    store.set("rooms/room-1", { type: "persistent", originEventId: "evt-1", memberIds: ["uid-1", "uid-2", "uid-3"] });
    const app = createApp();
    const res = await authed(app, "post", "/rooms/room-1/events").send(eventBody);
    expect(res.status).toBe(201);
    expect(res.body.data.roomId).toBe("room-1");

    const storedEvent = store.get(`events/${res.body.data.eventId}`) as { invitedUserIds: string[]; roomId: string };
    expect(storedEvent.roomId).toBe("room-1");
    expect(storedEvent.invitedUserIds).toEqual(["uid-1", "uid-2", "uid-3"]);

    // the room itself is untouched (still persistent, no new/duplicate room doc created)
    const room = store.get("rooms/room-1") as { type: string; memberIds: string[] };
    expect(room.type).toBe("persistent");
    expect(room.memberIds).toEqual(["uid-1", "uid-2", "uid-3"]);
  });

  it("respects an explicit invitedUserIds override instead of defaulting to all members", async () => {
    store.set("rooms/room-1", { type: "persistent", originEventId: "evt-1", memberIds: ["uid-1", "uid-2", "uid-3"] });
    const app = createApp();
    const res = await authed(app, "post", "/rooms/room-1/events").send({ ...eventBody, invitedUserIds: ["uid-2"] });
    expect(res.status).toBe(201);
    const storedEvent = store.get(`events/${res.body.data.eventId}`) as { invitedUserIds: string[] };
    expect(storedEvent.invitedUserIds).toEqual(["uid-2"]);
  });
});
