import type { NotificationType } from "@zatlan/shared-types";
import { db } from "./firebaseAdmin.js";

export type { NotificationType };

export async function writeNotification(
  uid: string,
  type: NotificationType,
  fromUserId: string | null,
  targetType: string | null = null,
  targetId: string | null = null
): Promise<void> {
  if (!db) return;
  await db.collection("users").doc(uid).collection("notifications").add({
    type,
    fromUserId,
    targetType,
    targetId,
    read: false,
    createdAt: new Date()
  });
}
