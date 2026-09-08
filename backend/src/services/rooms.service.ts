import { requireDb } from "../lib/firebaseAdmin.js";
import { AppError } from "../utils/AppError.js";
import { writeNotification } from "../lib/notify.js";
import { createEvent, type CreateEventInput } from "./events.service.js";

const MAX_MESSAGE_LENGTH = 2000;
const CHAT_ACTIVE_NOTIFY_WINDOW_MS = 30 * 60 * 1000;

function toMillis(value: FirebaseFirestore.Timestamp | Date | undefined): number {
  if (!value) return 0;
  return value instanceof Date ? value.getTime() : value.toDate().getTime();
}

function toIso(value: FirebaseFirestore.Timestamp | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

async function requireRoom(roomId: string) {
  const db = requireDb();
  const roomRef = db.collection("rooms").doc(roomId);
  const roomSnap = await roomRef.get();
  if (!roomSnap.exists) {
    throw new AppError("ROOM_NOT_FOUND", "No such room", 404);
  }
  return { db, roomRef, room: roomSnap.data()! };
}

function requireMember(uid: string, room: FirebaseFirestore.DocumentData): void {
  const memberIds = (room.memberIds as string[] | undefined) ?? [];
  if (!memberIds.includes(uid)) {
    throw new AppError("FORBIDDEN", "You're not a member of this room", 403);
  }
}

// POST /rooms/:roomId/messages — hld.md §16. Reads bypass this entirely (the
// frontend subscribes directly to Firestore via onSnapshot, governed by
// Security Rules keyed on rooms/{roomId}.memberIds) — this is the only
// message endpoint that needs to exist server-side.
export async function sendMessage(uid: string, roomId: string, rawText: unknown): Promise<{ messageId: string; createdAt: string | null }> {
  if (typeof rawText !== "string" || rawText.trim().length === 0) {
    throw new AppError("INVALID_MESSAGE", "text is required", 400);
  }
  const text = rawText.trim();
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new AppError("INVALID_MESSAGE", `text must be ${MAX_MESSAGE_LENGTH} characters or fewer`, 400);
  }

  const { db, roomRef, room } = await requireRoom(roomId);
  requireMember(uid, room);

  const userSnap = await db.collection("users").doc(uid).get();
  if (userSnap.data()?.status && userSnap.data()?.status !== "active") {
    throw new AppError("ACCOUNT_RESTRICTED", "Your account can't send messages right now", 403);
  }

  const messageRef = roomRef.collection("messages").doc();
  const now = new Date();
  await messageRef.set({ authorId: uid, text, createdAt: now, editedAt: null, deleted: false });

  // "This chat is live" rather than "you have a new message" — throttled per
  // room so an active conversation doesn't spam every member on every reply.
  const lastNotifiedMs = toMillis(room.lastChatNotifiedAt as FirebaseFirestore.Timestamp | Date | undefined);
  if (now.getTime() - lastNotifiedMs >= CHAT_ACTIVE_NOTIFY_WINDOW_MS) {
    await roomRef.update({ lastChatNotifiedAt: now });
    const memberIds = (room.memberIds as string[] | undefined) ?? [];
    await Promise.all(memberIds.filter((memberId) => memberId !== uid).map((memberId) => writeNotification(memberId, "chatActive", uid, "room", roomId)));
  }

  return { messageId: messageRef.id, createdAt: toIso(now) };
}

// PATCH /rooms/:roomId/messages/:messageId — author only, §21.
export async function editMessage(uid: string, roomId: string, messageId: string, rawText: unknown): Promise<void> {
  if (typeof rawText !== "string" || rawText.trim().length === 0) {
    throw new AppError("INVALID_MESSAGE", "text is required", 400);
  }
  const text = rawText.trim();
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new AppError("INVALID_MESSAGE", `text must be ${MAX_MESSAGE_LENGTH} characters or fewer`, 400);
  }

  const { roomRef } = await requireRoom(roomId);
  const messageRef = roomRef.collection("messages").doc(messageId);
  const messageSnap = await messageRef.get();
  if (!messageSnap.exists || messageSnap.data()?.deleted) {
    throw new AppError("MESSAGE_NOT_FOUND", "No such message", 404);
  }
  if (messageSnap.data()?.authorId !== uid) {
    throw new AppError("FORBIDDEN", "You can only edit your own messages", 403);
  }

  await messageRef.update({ text, editedAt: new Date() });
}

// DELETE /rooms/:roomId/messages/:messageId — soft delete (schema.md §4's
// `deleted` flag), same general policy as reviews (§21): the doc survives for
// moderator review, never hard-deleted. Author-only for now — "or moderator"
// per api-contracts.md §9 depends on §14's role system, which isn't built yet
// (no custom-claims/role checks exist anywhere in the backend), same gap
// already flagged for review disputes.
export async function deleteMessage(uid: string, roomId: string, messageId: string): Promise<void> {
  const { roomRef } = await requireRoom(roomId);
  const messageRef = roomRef.collection("messages").doc(messageId);
  const messageSnap = await messageRef.get();
  if (!messageSnap.exists || messageSnap.data()?.deleted) {
    throw new AppError("MESSAGE_NOT_FOUND", "No such message", 404);
  }
  if (messageSnap.data()?.authorId !== uid) {
    throw new AppError("FORBIDDEN", "You can only delete your own messages", 403);
  }

  await messageRef.update({ deleted: true });
}

// PATCH /rooms/:roomId — host only, one-way ephemeral -> persistent (hld.md
// §16). Host is resolved via the room's originEventId, since Room itself
// doesn't carry a hostId field (schema.md §4) — it can outlive that event,
// but "who may promote it" still traces back to who created it.
export async function promoteRoom(uid: string, roomId: string): Promise<void> {
  const { db, roomRef, room } = await requireRoom(roomId);
  if (room.type === "persistent") {
    return; // idempotent — matches every other "set this relationship/state" endpoint in this API
  }

  const eventSnap = await db.collection("events").doc(room.originEventId as string).get();
  if (!eventSnap.exists || eventSnap.data()?.hostId !== uid) {
    throw new AppError("FORBIDDEN", "Only the event host can make this room persistent", 403);
  }

  await roomRef.update({ type: "persistent" });
}

// POST /rooms/:roomId/events — hld.md §16's "a persistent room can spawn new
// events": links the new event back to the SAME room rather than creating a
// fresh one (the mechanism by which one room ends up tied to multiple events
// over time), and defaults invitedUserIds to the room's current members.
export async function scheduleEventFromRoom(uid: string, roomId: string, body: CreateEventInput) {
  const { room } = await requireRoom(roomId);
  requireMember(uid, room);
  if (room.type !== "persistent") {
    throw new AppError("ROOM_NOT_PERSISTENT", "Only a persistent room can spawn new events", 400);
  }

  const memberIds = (room.memberIds as string[] | undefined) ?? [];
  const invitedUserIds = Array.isArray(body.invitedUserIds) && body.invitedUserIds.length > 0 ? body.invitedUserIds : memberIds;

  return createEvent(uid, { ...body, invitedUserIds }, { existingRoomId: roomId });
}
