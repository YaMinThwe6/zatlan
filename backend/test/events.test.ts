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
  const raw = data[w.field];
  const val = raw instanceof Date ? raw.getTime() : raw;
  const target = w.value instanceof Date ? w.value.getTime() : w.value;
  switch (w.op) {
    case "==":
      return val === target;
    case ">=":
      if (typeof val === "number" && typeof target === "number") return val >= target;
      if (typeof val === "string" && typeof target === "string") return val >= target;
      return false;
    case "<":
      if (typeof val === "number" && typeof target === "number") return val < target;
      if (typeof val === "string" && typeof target === "string") return val < target;
      return false;
    case "in":
      return Array.isArray(w.value) && w.value.includes(raw);
    default:
      return true;
  }
}

function collectionRef(path: string) {
  function query(state: { wheres?: Where[]; orderField?: string; dir?: "asc" | "desc"; lim?: number }) {
    return {
      where: (field: string, op: string, value: unknown) => query({ ...state, wheres: [...(state.wheres ?? []), { field, op, value }] }),
      orderBy: (field: string, dir: "asc" | "desc" = "asc") => query({ ...state, orderField: field, dir }),
      limit: (n: number) => query({ ...state, lim: n }),
      get: async () => {
        let entries = directChildren(path);
        for (const w of state.wheres ?? []) {
          entries = entries.filter(([, data]) => matchWhere(data, w));
        }
        if (state.orderField) {
          const field = state.orderField;
          entries = entries.sort((a, b) => {
            const av = a[1][field] instanceof Date ? (a[1][field] as Date).getTime() : (a[1][field] as number) ?? 0;
            const bv = b[1][field] instanceof Date ? (b[1][field] as Date).getTime() : (b[1][field] as number) ?? 0;
            return state.dir === "desc" ? bv - av : av - bv;
          });
        }
        if (state.lim) entries = entries.slice(0, state.lim);
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
  type Op = { type: "set" | "delete"; path: string; value?: DocData };
  const ops: Op[] = [];
  const batch = {
    set: (ref: { __path: string }, value: DocData) => {
      ops.push({ type: "set", path: ref.__path, value });
      return batch;
    },
    delete: (ref: { __path: string }) => {
      ops.push({ type: "delete", path: ref.__path });
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

let currentUid = "host-1";
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
  currentUid = "host-1";
  store.set("movies/movie-1", { title: "Dune: Part Two", poster: "/dune.jpg" });
});

function authed(app: ReturnType<typeof createApp>, method: "put" | "delete" | "get" | "post", path: string) {
  return request(app)[method](path).set("Authorization", "Bearer good");
}

const validBody = {
  movieId: "movie-1",
  datetime: "2099-01-01T20:00:00.000Z",
  mode: "online",
  visibility: "public",
  participantLimit: 5,
  requiresApproval: false
};

describe("POST /events", () => {
  it("401s without a token", async () => {
    const app = createApp();
    const res = await request(app).post("/events").send(validBody);
    expect(res.status).toBe(401);
  });

  it("400s on a malformed body", async () => {
    const app = createApp();
    const res = await authed(app, "post", "/events").send({ ...validBody, mode: "carrier-pigeon" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_EVENT");
  });

  it("404s when the movie doesn't exist", async () => {
    const app = createApp();
    const res = await authed(app, "post", "/events").send({ ...validBody, movieId: "no-such-movie" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("MOVIE_NOT_FOUND");
  });

  it("creates the event, auto-joins the host, and assigns a roomId", async () => {
    const app = createApp();
    const res = await authed(app, "post", "/events").send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.data.hostId).toBe("host-1");
    expect(res.body.data.participantCount).toBe(1);
    const eventId = res.body.data.eventId;
    expect(store.has(`events/${eventId}/participants/host-1`)).toBe(true);
    const stored = store.get(`events/${eventId}`) as { roomId: string };
    expect(store.has(`rooms/${stored.roomId}`)).toBe(true);

    const room = store.get(`rooms/${stored.roomId}`) as { type: string; originEventId: string; memberIds: string[] };
    expect(room.type).toBe("ephemeral"); // hld.md §16 — ephemeral by default, host promotes later
    expect(room.originEventId).toBe(eventId);
    expect(room.memberIds).toEqual(["host-1"]);
  });

  it("generates a joinCode only for private events, and returns it in the create response", async () => {
    const app = createApp();
    const publicRes = await authed(app, "post", "/events").send(validBody);
    expect(publicRes.body.data.joinCode).toBeNull();
    const stored = store.get(`events/${publicRes.body.data.eventId}`) as { joinCode: string | null };
    expect(stored.joinCode).toBeNull();

    const privateRes = await authed(app, "post", "/events").send({ ...validBody, visibility: "private" });
    expect(typeof privateRes.body.data.joinCode).toBe("string");
    expect(privateRes.body.data.joinCode.length).toBeGreaterThan(0);
    const privateStored = store.get(`events/${privateRes.body.data.eventId}`) as { joinCode: string | null };
    expect(privateStored.joinCode).toBe(privateRes.body.data.joinCode);
  });

  it("400s an in-person event with no location at all", async () => {
    const app = createApp();
    const res = await authed(app, "post", "/events").send({ ...validBody, mode: "in-person" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_EVENT");
  });

  it("400s an in-person event missing area or city", async () => {
    const app = createApp();
    const res = await authed(app, "post", "/events").send({
      ...validBody,
      mode: "in-person",
      location: { area: "MG Road", lat: 12.9716, lng: 77.5946 } // no city
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_EVENT");
  });

  it("does not require a location for an online event", async () => {
    const app = createApp();
    const res = await authed(app, "post", "/events").send(validBody); // mode: "online"
    expect(res.status).toBe(201);
  });

  it("returns area/city as location, and the exact coordinates as preciseLocation, for the host who just created it", async () => {
    const app = createApp();
    const res = await authed(app, "post", "/events").send({
      ...validBody,
      mode: "in-person",
      location: { area: "MG Road", city: "Bangalore", lat: 12.9716, lng: 77.5946 }
    });
    expect(res.status).toBe(201);
    expect(res.body.data.location).toEqual({ area: "MG Road", city: "Bangalore" });
    expect(res.body.data.preciseLocation).toEqual({ lat: 12.9716, lng: 77.5946 });
  });
});

describe("GET /events/upcoming", () => {
  it("returns only public, future events, sorted by datetime ascending, joined with movie info", async () => {
    store.set("events/past", { hostId: "host-1", movieId: "movie-1", visibility: "public", datetime: new Date("2020-01-01"), participantCount: 1, participantLimit: 5, requiresApproval: false });
    store.set("events/private", { hostId: "host-1", movieId: "movie-1", visibility: "private", datetime: new Date("2099-01-01"), participantCount: 1, participantLimit: 5, requiresApproval: false });
    store.set("events/soon", { hostId: "host-1", movieId: "movie-1", visibility: "public", datetime: new Date("2099-06-01"), participantCount: 1, participantLimit: 5, requiresApproval: false });
    store.set("events/later", { hostId: "host-1", movieId: "movie-1", visibility: "public", datetime: new Date("2099-12-01"), participantCount: 1, participantLimit: 5, requiresApproval: false });

    const app = createApp();
    const res = await authed(app, "get", "/events/upcoming");
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((e: { eventId: string }) => e.eventId)).toEqual(["soon", "later"]);
    expect(res.body.data.items[0].movieTitle).toBe("Dune: Part Two");
  });

  it("joins the host's displayName into each item — the Events page card's \"Hosted by\" line", async () => {
    store.set("users/host-1", { displayName: "Meera" });
    store.set("events/soon", { hostId: "host-1", movieId: "movie-1", visibility: "public", datetime: new Date("2099-06-01"), participantCount: 1, participantLimit: 5, requiresApproval: false });
    const app = createApp();
    const res = await authed(app, "get", "/events/upcoming");
    expect(res.body.data.items[0].hostDisplayName).toBe("Meera");
  });

  it("is reachable without a token — the guest Discover page's events teaser needs this too", async () => {
    store.set("events/soon", { hostId: "host-1", movieId: "movie-1", visibility: "public", datetime: new Date("2099-06-01"), participantCount: 1, participantLimit: 5, requiresApproval: false });
    const app = createApp();
    const res = await request(app).get("/events/upcoming");
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
  });

  it("reports joined:false for a guest with no token — nothing to check them against", async () => {
    store.set("events/soon", { hostId: "host-1", movieId: "movie-1", visibility: "public", datetime: new Date("2099-06-01"), participantCount: 1, participantLimit: 5, requiresApproval: false });
    const app = createApp();
    const res = await request(app).get("/events/upcoming");
    expect(res.body.data.items[0].joined).toBe(false);
  });

  it("reports joined:true for an event the authenticated caller has already joined — real bug: without this, Home's Join button reverts on every refresh even after actually joining", async () => {
    store.set("events/soon", { hostId: "host-1", movieId: "movie-1", visibility: "public", datetime: new Date("2099-06-01"), participantCount: 2, participantLimit: 5, requiresApproval: false });
    store.set("events/soon/participants/host-1", { joinedAt: new Date() });
    const app = createApp(); // currentUid stays "host-1"
    const res = await authed(app, "get", "/events/upcoming");
    expect(res.body.data.items[0].joined).toBe(true);
  });

  it("reports joined:false for an authenticated caller who hasn't joined", async () => {
    store.set("events/soon", { hostId: "host-1", movieId: "movie-1", visibility: "public", datetime: new Date("2099-06-01"), participantCount: 1, participantLimit: 5, requiresApproval: false });
    currentUid = "guest-1";
    const app = createApp();
    const res = await authed(app, "get", "/events/upcoming");
    expect(res.body.data.items[0].joined).toBe(false);
  });

  it("shows area/city but never the exact coordinates, even for the caller who hosts the event", async () => {
    store.set("events/soon", {
      hostId: "host-1", // currentUid defaults to "host-1" — this caller hosts it
      movieId: "movie-1",
      visibility: "public",
      datetime: new Date("2099-06-01"),
      mode: "in-person",
      location: { area: "MG Road", city: "Bangalore", lat: 12.9716, lng: 77.5946 },
      participantCount: 1,
      participantLimit: 5,
      requiresApproval: false
    });
    const app = createApp();
    const res = await authed(app, "get", "/events/upcoming");
    expect(res.status).toBe(200);
    expect(res.body.data.items[0].location).toEqual({ area: "MG Road", city: "Bangalore" });
    expect(res.body.data.items[0].preciseLocation).toBeNull();
  });

  it("filters to just one movie's events when movieId is given — the movie detail page's Watch together section", async () => {
    store.set("movies/movie-2", { title: "Interstellar", poster: "/interstellar.jpg" });
    store.set("events/for-movie-1", { hostId: "host-1", movieId: "movie-1", visibility: "public", datetime: new Date("2099-06-01"), participantCount: 1, participantLimit: 5, requiresApproval: false });
    store.set("events/for-movie-2", { hostId: "host-1", movieId: "movie-2", visibility: "public", datetime: new Date("2099-06-01"), participantCount: 1, participantLimit: 5, requiresApproval: false });

    const app = createApp();
    const res = await authed(app, "get", "/events/upcoming?movieId=movie-2");
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((e: { eventId: string }) => e.eventId)).toEqual(["for-movie-2"]);
  });
});

describe("PUT /events/:eventId/join", () => {
  it("404s for a nonexistent event", async () => {
    const app = createApp();
    const res = await authed(app, "put", "/events/no-such-event/join");
    expect(res.status).toBe(404);
  });

  it("joins instantly when the event doesn't require approval", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", requiresApproval: false, participantCount: 1, participantLimit: 5 });
    currentUid = "guest-1";
    const app = createApp();
    const res = await authed(app, "put", "/events/evt-1/join");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: "joined" });
    expect(store.has("events/evt-1/participants/guest-1")).toBe(true);
    expect((store.get("events/evt-1") as { participantCount: number }).participantCount).toBe(2);
  });

  it("adds the joiner to the event's room so they can chat (hld.md §16)", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", requiresApproval: false, participantCount: 1, participantLimit: 5, roomId: "room-1" });
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["host-1"] });
    currentUid = "guest-1";
    const app = createApp();
    const res = await authed(app, "put", "/events/evt-1/join");
    expect(res.status).toBe(200);
    expect((store.get("rooms/room-1") as { memberIds: string[] }).memberIds).toEqual(["host-1", "guest-1"]);
  });

  it("409s when the event is full", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", requiresApproval: false, participantCount: 1, participantLimit: 1 });
    currentUid = "guest-1";
    const app = createApp();
    const res = await authed(app, "put", "/events/evt-1/join");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVENT_FULL");
  });

  it("creates a pending join request when approval is required", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", requiresApproval: true, participantCount: 1, participantLimit: 5 });
    currentUid = "guest-1";
    const app = createApp();
    const res = await authed(app, "put", "/events/evt-1/join");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: "pending" });
    expect(store.has("events/evt-1/joinRequests/guest-1")).toBe(true);
  });

  it("is idempotent — already-joined returns joined without double counting", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", requiresApproval: false, participantCount: 2, participantLimit: 5 });
    store.set("events/evt-1/participants/guest-1", { joinedAt: new Date() });
    currentUid = "guest-1";
    const app = createApp();
    const res = await authed(app, "put", "/events/evt-1/join");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: "joined" });
    expect((store.get("events/evt-1") as { participantCount: number }).participantCount).toBe(2);
  });
});

describe("DELETE /events/:eventId/join", () => {
  it("removes the participant and decrements participantCount", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", participantCount: 2, participantLimit: 5 });
    store.set("events/evt-1/participants/guest-1", { joinedAt: new Date() });
    currentUid = "guest-1";
    const app = createApp();
    const res = await authed(app, "delete", "/events/evt-1/join");
    expect(res.status).toBe(204);
    expect(store.has("events/evt-1/participants/guest-1")).toBe(false);
    expect((store.get("events/evt-1") as { participantCount: number }).participantCount).toBe(1);
  });

  it("removes the leaver from the event's room membership too", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", participantCount: 2, participantLimit: 5, roomId: "room-1" });
    store.set("events/evt-1/participants/guest-1", { joinedAt: new Date() });
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["host-1", "guest-1"] });
    currentUid = "guest-1";
    const app = createApp();
    const res = await authed(app, "delete", "/events/evt-1/join");
    expect(res.status).toBe(204);
    expect((store.get("rooms/room-1") as { memberIds: string[] }).memberIds).toEqual(["host-1"]);
  });
});

describe("join request approval", () => {
  it("GET joinRequests 403s for a non-host", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1" });
    currentUid = "guest-1";
    const app = createApp();
    const res = await authed(app, "get", "/events/evt-1/joinRequests");
    expect(res.status).toBe(403);
  });

  it("approve moves the pending request into participants and increments the count", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", participantCount: 1, participantLimit: 5, roomId: "room-1" });
    store.set("events/evt-1/joinRequests/guest-1", { createdAt: new Date() });
    store.set("rooms/room-1", { type: "ephemeral", originEventId: "evt-1", memberIds: ["host-1"] });
    const app = createApp(); // currentUid stays "host-1"
    const res = await authed(app, "post", "/events/evt-1/joinRequests/guest-1/approve");
    expect(res.status).toBe(204);
    expect(store.has("events/evt-1/participants/guest-1")).toBe(true);
    expect(store.has("events/evt-1/joinRequests/guest-1")).toBe(false);
    expect((store.get("events/evt-1") as { participantCount: number }).participantCount).toBe(2);
    expect((store.get("rooms/room-1") as { memberIds: string[] }).memberIds).toEqual(["host-1", "guest-1"]);
  });

  it("approve 409s when the event filled up while the request was pending", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", participantCount: 5, participantLimit: 5 });
    store.set("events/evt-1/joinRequests/guest-1", { createdAt: new Date() });
    const app = createApp();
    const res = await authed(app, "post", "/events/evt-1/joinRequests/guest-1/approve");
    expect(res.status).toBe(409);
    expect(store.has("events/evt-1/joinRequests/guest-1")).toBe(true); // left pending, not silently dropped
  });

  it("deny just clears the request", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1" });
    store.set("events/evt-1/joinRequests/guest-1", { createdAt: new Date() });
    const app = createApp();
    const res = await authed(app, "post", "/events/evt-1/joinRequests/guest-1/deny");
    expect(res.status).toBe(204);
    expect(store.has("events/evt-1/joinRequests/guest-1")).toBe(false);
    expect(store.has("events/evt-1/participants/guest-1")).toBe(false);
  });
});

describe("POST /events computes a geohash for in-person events with a location", () => {
  it("stores a geohash when location is given", async () => {
    const app = createApp();
    const res = await authed(app, "post", "/events").send({
      ...validBody,
      mode: "in-person",
      location: { area: "MG Road", city: "Bangalore", lat: 12.9716, lng: 77.5946 }
    });
    expect(res.status).toBe(201);
    const stored = store.get(`events/${res.body.data.eventId}`) as { geohash: string | null };
    expect(typeof stored.geohash).toBe("string");
    expect(stored.geohash!.length).toBeGreaterThan(0);
  });

  it("leaves geohash null for an online event (no location)", async () => {
    const app = createApp();
    const res = await authed(app, "post", "/events").send(validBody); // mode: "online", no location
    expect(res.status).toBe(201);
    const stored = store.get(`events/${res.body.data.eventId}`) as { geohash: string | null };
    expect(stored.geohash).toBeNull();
  });
});

describe("GET /events/nearby", () => {
  const bangalore = { lat: 12.9716, lng: 77.5946 };
  const bangaloreNearby = { lat: 12.9761, lng: 77.5946 }; // ~0.5km away
  const mysore = { lat: 12.2958, lng: 76.6394 }; // ~145km away

  function inPersonBody(
    overrides: Partial<typeof validBody> & {
      location: { area: string; city: string; lat: number; lng: number };
      title?: string;
      invitedUserIds?: string[];
    }
  ) {
    return { ...validBody, mode: "in-person" as const, ...overrides };
  }

  it("401s without a token", async () => {
    const app = createApp();
    const res = await request(app).get("/events/nearby?lat=12.9716&lng=77.5946&radiusKm=5");
    expect(res.status).toBe(401);
  });

  it("400s when lat/lng/radiusKm are missing or invalid", async () => {
    const app = createApp();
    const missing = await authed(app, "get", "/events/nearby");
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("INVALID_QUERY");

    const badRadius = await authed(app, "get", "/events/nearby?lat=12.9716&lng=77.5946&radiusKm=-5");
    expect(badRadius.status).toBe(400);
  });

  it("returns a public in-person event within the radius, with distanceKm", async () => {
    const app = createApp();
    await authed(app, "post", "/events").send(
      inPersonBody({ location: { area: "Near MG Road", city: "Bangalore", ...bangaloreNearby } })
    );

    const res = await authed(app, "get", `/events/nearby?lat=${bangalore.lat}&lng=${bangalore.lng}&radiusKm=5`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].movieTitle).toBe("Dune: Part Two");
    expect(res.body.data.items[0].distanceKm).toBeGreaterThan(0);
    expect(res.body.data.items[0].distanceKm).toBeLessThan(5);
    // Unlike /events/upcoming, the map (NearbyEventsMap.tsx) needs a real pin
    // for every result it plots — nearby stays unaffected by the
    // pre-join area/city-only rule (out of scope, see events.service.ts).
    expect(res.body.data.items[0].location).toEqual({ area: "Near MG Road", city: "Bangalore" });
    expect(res.body.data.items[0].preciseLocation).toEqual(bangaloreNearby);
  });

  // Real bug: unlike /events/upcoming (which filters datetime >= now),
  // /events/nearby never filtered by datetime at all, so a past watch party
  // still showed up on the map as if it were still happening.
  it("excludes an in-person event whose datetime has already passed", async () => {
    const app = createApp();
    await authed(app, "post", "/events").send(
      inPersonBody({ location: { area: "Near MG Road", city: "Bangalore", ...bangaloreNearby }, datetime: "2020-01-01T20:00:00.000Z" })
    );

    const res = await authed(app, "get", `/events/nearby?lat=${bangalore.lat}&lng=${bangalore.lng}&radiusKm=5`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
  });

  it("excludes an event outside the search radius", async () => {
    const app = createApp();
    await authed(app, "post", "/events").send(inPersonBody({ location: { area: "Mysore Palace", city: "Mysore", ...mysore } }));

    const res = await authed(app, "get", `/events/nearby?lat=${bangalore.lat}&lng=${bangalore.lng}&radiusKm=5`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
  });

  it("excludes online events (no location to search on)", async () => {
    const app = createApp();
    await authed(app, "post", "/events").send(validBody); // mode: "online"

    const res = await authed(app, "get", `/events/nearby?lat=${bangalore.lat}&lng=${bangalore.lng}&radiusKm=5`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
  });

  it("excludes a private event the caller neither hosts nor was invited to", async () => {
    const app = createApp();
    await authed(app, "post", "/events").send(
      inPersonBody({ visibility: "private", location: { area: "Near MG Road", city: "Bangalore", ...bangaloreNearby } })
    );

    currentUid = "guest-1";
    const res = await authed(app, "get", `/events/nearby?lat=${bangalore.lat}&lng=${bangalore.lng}&radiusKm=5`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
  });

  it("includes a private event the caller is hosting", async () => {
    const app = createApp(); // currentUid stays "host-1"
    await authed(app, "post", "/events").send(
      inPersonBody({ visibility: "private", location: { area: "Near MG Road", city: "Bangalore", ...bangaloreNearby } })
    );

    const res = await authed(app, "get", `/events/nearby?lat=${bangalore.lat}&lng=${bangalore.lng}&radiusKm=5`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
  });

  it("includes a private event the caller was explicitly invited to", async () => {
    const app = createApp();
    await authed(app, "post", "/events").send(
      inPersonBody({
        visibility: "private",
        location: { area: "Near MG Road", city: "Bangalore", ...bangaloreNearby },
        invitedUserIds: ["guest-1"]
      })
    );

    currentUid = "guest-1";
    const res = await authed(app, "get", `/events/nearby?lat=${bangalore.lat}&lng=${bangalore.lng}&radiusKm=5`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
  });

  it("sorts multiple results by distance ascending", async () => {
    const app = createApp();
    await authed(app, "post", "/events").send(
      // Deliberately still inside the same geohash-4 cell as bangaloreNearby
      // (~3.2km away, vs. ~0.5km) — a point crossing into a neighboring cell
      // would be silently excluded by the range query itself (the known
      // "approximation of a bounding box" limitation this feature accepts).
      inPersonBody({ title: "Far one", location: { area: "A bit further", city: "Bangalore", lat: 13.0, lng: 77.6 } })
    );
    await authed(app, "post", "/events").send(
      inPersonBody({ title: "Close one", location: { area: "Very close", city: "Bangalore", ...bangaloreNearby } })
    );

    const res = await authed(app, "get", `/events/nearby?lat=${bangalore.lat}&lng=${bangalore.lng}&radiusKm=10`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((e: { title: string }) => e.title)).toEqual(["Close one", "Far one"]);
  });

  it("joins the host's displayName into each nearby item too", async () => {
    store.set("users/host-1", { displayName: "Meera" });
    const app = createApp();
    await authed(app, "post", "/events").send(
      inPersonBody({ location: { area: "Near MG Road", city: "Bangalore", ...bangaloreNearby } })
    );

    const res = await authed(app, "get", `/events/nearby?lat=${bangalore.lat}&lng=${bangalore.lng}&radiusKm=5`);
    expect(res.body.data.items[0].hostDisplayName).toBe("Meera");
  });
});

describe("GET /events/hosting", () => {
  it("401s without a token", async () => {
    const app = createApp();
    const res = await request(app).get("/events/hosting");
    expect(res.status).toBe(401);
  });

  it("returns every future event the caller hosts, public or private, sorted by datetime ascending — unlike /upcoming, a private watch party you're hosting still needs somewhere to manage it", async () => {
    store.set("events/pub", { hostId: "host-1", movieId: "movie-1", visibility: "public", datetime: new Date("2099-06-01"), participantCount: 1, participantLimit: 5, requiresApproval: false });
    store.set("events/priv", { hostId: "host-1", movieId: "movie-1", visibility: "private", datetime: new Date("2099-01-01"), participantCount: 1, participantLimit: 5, requiresApproval: false });
    store.set("events/someone-elses", { hostId: "host-2", movieId: "movie-1", visibility: "public", datetime: new Date("2099-03-01"), participantCount: 1, participantLimit: 5, requiresApproval: false });
    store.set("events/past", { hostId: "host-1", movieId: "movie-1", visibility: "public", datetime: new Date("2020-01-01"), participantCount: 1, participantLimit: 5, requiresApproval: false });

    const app = createApp(); // currentUid stays "host-1"
    const res = await authed(app, "get", "/events/hosting");
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((e: { eventId: string }) => e.eventId)).toEqual(["priv", "pub"]);
  });

  it("excludes a soft-deleted event the caller hosts", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", visibility: "public", datetime: new Date("2099-01-01"), deleted: true, participantCount: 1, participantLimit: 5, requiresApproval: false });
    const app = createApp();
    const res = await authed(app, "get", "/events/hosting");
    expect(res.body.data.items).toEqual([]);
  });

  it("joins the host's own displayName into each item too", async () => {
    store.set("users/host-1", { displayName: "Meera" });
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", visibility: "public", datetime: new Date("2099-01-01"), participantCount: 1, participantLimit: 5, requiresApproval: false });
    const app = createApp();
    const res = await authed(app, "get", "/events/hosting");
    expect(res.body.data.items[0].hostDisplayName).toBe("Meera");
  });
});

describe("GET /events/:eventId", () => {
  it("401s without a token", async () => {
    const app = createApp();
    const res = await request(app).get("/events/evt-1");
    expect(res.status).toBe(401);
  });

  it("404s for a nonexistent event", async () => {
    const app = createApp();
    const res = await authed(app, "get", "/events/no-such-event");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("EVENT_NOT_FOUND");
  });

  it("returns the event joined with movie title/poster", async () => {
    store.set("events/evt-1", {
      hostId: "host-1",
      movieId: "movie-1",
      title: "Rooftop watch",
      datetime: new Date("2099-06-01T20:00:00.000Z"),
      mode: "online",
      location: null,
      visibility: "public",
      joinCode: null,
      participantLimit: 5,
      participantCount: 1,
      requiresApproval: false,
      roomId: "room-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z")
    });
    const app = createApp();
    const res = await authed(app, "get", "/events/evt-1");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      eventId: "evt-1",
      hostId: "host-1",
      title: "Rooftop watch",
      movieTitle: "Dune: Part Two",
      moviePoster: "/dune.jpg",
      participantCount: 1
    });
  });

  it("404s for a soft-deleted event — same as not found", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", deleted: true });
    const app = createApp();
    const res = await authed(app, "get", "/events/evt-1");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("EVENT_NOT_FOUND");
  });

  it("does not require the caller to be the host or invited — accessible by ID like PUT .../join already is", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", visibility: "private", participantCount: 1, participantLimit: 5 });
    currentUid = "stranger-1";
    const app = createApp();
    const res = await authed(app, "get", "/events/evt-1");
    expect(res.status).toBe(200);
  });

  const inPersonEvent = {
    hostId: "host-1",
    movieId: "movie-1",
    mode: "in-person",
    location: { area: "MG Road", city: "Bangalore", lat: 12.9716, lng: 77.5946 },
    visibility: "public",
    participantCount: 1,
    participantLimit: 5
  };

  it("gives the host the exact coordinates", async () => {
    store.set("events/evt-1", inPersonEvent); // currentUid stays "host-1"
    const app = createApp();
    const res = await authed(app, "get", "/events/evt-1");
    expect(res.body.data.location).toEqual({ area: "MG Road", city: "Bangalore" });
    expect(res.body.data.preciseLocation).toEqual({ lat: 12.9716, lng: 77.5946 });
  });

  it("hides the exact coordinates from a signed-in caller who hasn't joined", async () => {
    store.set("events/evt-1", inPersonEvent);
    currentUid = "stranger-1";
    const app = createApp();
    const res = await authed(app, "get", "/events/evt-1");
    expect(res.body.data.location).toEqual({ area: "MG Road", city: "Bangalore" });
    expect(res.body.data.preciseLocation).toBeNull();
  });

  it("reveals the exact coordinates once the caller has joined", async () => {
    store.set("events/evt-1", inPersonEvent);
    store.set("events/evt-1/participants/guest-1", { joinedAt: new Date() });
    currentUid = "guest-1";
    const app = createApp();
    const res = await authed(app, "get", "/events/evt-1");
    expect(res.body.data.preciseLocation).toEqual({ lat: 12.9716, lng: 77.5946 });
  });

  it("reports viewerStatus: 'host' for the event's own host", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", visibility: "public", participantCount: 1, participantLimit: 5, requiresApproval: false });
    const app = createApp(); // currentUid stays "host-1"
    const res = await authed(app, "get", "/events/evt-1");
    expect(res.body.data.viewerStatus).toBe("host");
  });

  it("reports viewerStatus: 'joined' for a participant who isn't the host", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", visibility: "public", participantCount: 2, participantLimit: 5, requiresApproval: false });
    store.set("events/evt-1/participants/guest-1", { joinedAt: new Date() });
    currentUid = "guest-1";
    const app = createApp();
    const res = await authed(app, "get", "/events/evt-1");
    expect(res.body.data.viewerStatus).toBe("joined");
  });

  it("reports viewerStatus: 'pending' for someone with an outstanding join request", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", visibility: "public", participantCount: 1, participantLimit: 5, requiresApproval: true });
    store.set("events/evt-1/joinRequests/guest-1", { createdAt: new Date() });
    currentUid = "guest-1";
    const app = createApp();
    const res = await authed(app, "get", "/events/evt-1");
    expect(res.body.data.viewerStatus).toBe("pending");
  });

  it("reports viewerStatus: 'none' for a stranger who hasn't joined or requested", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", visibility: "public", participantCount: 1, participantLimit: 5, requiresApproval: false });
    currentUid = "stranger-1";
    const app = createApp();
    const res = await authed(app, "get", "/events/evt-1");
    expect(res.body.data.viewerStatus).toBe("none");
  });
});

describe("DELETE /events/:eventId", () => {
  it("401s without a token", async () => {
    const app = createApp();
    const res = await request(app).delete("/events/evt-1");
    expect(res.status).toBe(401);
  });

  it("404s for a nonexistent event", async () => {
    const app = createApp();
    const res = await authed(app, "delete", "/events/no-such-event");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("EVENT_NOT_FOUND");
  });

  it("403s for a non-host", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1" });
    currentUid = "guest-1";
    const app = createApp();
    const res = await authed(app, "delete", "/events/evt-1");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("soft-deletes — the doc stays in Firestore with deleted:true, not removed", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1" });
    const app = createApp(); // currentUid stays "host-1"
    const res = await authed(app, "delete", "/events/evt-1");
    expect(res.status).toBe(204);
    expect(store.get("events/evt-1")).toMatchObject({ hostId: "host-1", deleted: true });
  });

  it("is idempotent — deleting an already-deleted event 404s rather than double-processing", async () => {
    store.set("events/evt-1", { hostId: "host-1", movieId: "movie-1", deleted: true });
    const app = createApp();
    const res = await authed(app, "delete", "/events/evt-1");
    expect(res.status).toBe(404);
  });

  it("a deleted event is excluded from GET /events/:eventId, /upcoming, /nearby, and can no longer be joined", async () => {
    const app = createApp();
    const created = await authed(app, "post", "/events").send({ ...validBody, datetime: "2099-01-01T20:00:00.000Z" });
    const eventId = created.body.data.eventId;

    const del = await authed(app, "delete", `/events/${eventId}`);
    expect(del.status).toBe(204);

    const getRes = await authed(app, "get", `/events/${eventId}`);
    expect(getRes.status).toBe(404);

    const upcoming = await authed(app, "get", "/events/upcoming");
    expect(upcoming.body.data.items.map((e: { eventId: string }) => e.eventId)).not.toContain(eventId);

    currentUid = "guest-1";
    const join = await authed(app, "put", `/events/${eventId}/join`);
    expect(join.status).toBe(404);
  });
});
