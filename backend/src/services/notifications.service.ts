import type { NotificationItem } from "@binj/shared-types";
import { requireDb } from "../lib/firebaseAdmin.js";
import { AppError } from "../utils/AppError.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parseLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function toIso(value: FirebaseFirestore.Timestamp | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value.toDate().toISOString();
}

// GET /users/me/notifications — schema.md §5, §6 composite index (read asc + createdAt desc).
// Powers the bell badge and the notification center (hld.md §17's read/notification flow).
export async function listNotifications(uid: string, rawLimit: unknown, unreadOnly: boolean): Promise<{ items: NotificationItem[] }> {
  const db = requireDb();
  const limit = parseLimit(rawLimit);

  const col = db.collection("users").doc(uid).collection("notifications");
  let query: FirebaseFirestore.Query = col;
  if (unreadOnly) query = query.where("read", "==", false);
  query = query.orderBy("createdAt", "desc").limit(limit);

  const snap = await query.get();
  const items: NotificationItem[] = await Promise.all(
    snap.docs.map(async (d) => {
      const data = d.data();
      const fromUserId = (data.fromUserId as string | null) ?? null;
      // Every current notification type is "someone did something" — the
      // actor's name/photo is the one piece of context the notification
      // center always needs, joined in here so it doesn't need a second
      // round-trip per item. Skipped entirely when there's no fromUserId
      // (moderationWarning has no actor).
      const fromUserSnap = fromUserId ? await db.collection("users").doc(fromUserId).get() : null;
      return {
        id: d.id,
        type: data.type,
        fromUserId,
        fromUserDisplayName: (fromUserSnap?.data()?.displayName as string | undefined) ?? null,
        fromUserPhotoURL: (fromUserSnap?.data()?.photoURL as string | null | undefined) ?? null,
        targetType: (data.targetType as string | null) ?? null,
        targetId: (data.targetId as string | null) ?? null,
        read: data.read,
        createdAt: toIso(data.createdAt)
      };
    })
  );

  return { items };
}

export async function markNotificationRead(uid: string, notificationId: string, read: unknown): Promise<void> {
  if (read !== true) {
    throw new AppError("INVALID_BODY", "Only { read: true } is supported", 400);
  }

  const db = requireDb();
  const ref = db.collection("users").doc(uid).collection("notifications").doc(notificationId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new AppError("NOTIFICATION_NOT_FOUND", "No such notification", 404);
  }
  await ref.update({ read: true });
}
