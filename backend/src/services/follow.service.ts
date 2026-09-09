import type { FollowRequest } from "@zatlan/shared-types";
import { requireDb } from "../lib/firebaseAdmin.js";
import { writeNotification } from "../lib/notify.js";
import { AppError } from "../utils/AppError.js";

// PUT /users/:uid/follow — hld.md §4. Never trusts a frontend claim about which
// branch applies: always re-reads the target's CURRENT followRequiresApproval
// server-side. Idempotent in both branches (repeat clicks don't duplicate writes
// or spam notifications).
export async function followUser(callerUid: string, targetUid: string): Promise<{ status: "following" | "pending" }> {
  if (targetUid === callerUid) {
    throw new AppError("CANNOT_FOLLOW_SELF", "You can't follow yourself", 400);
  }

  const db = requireDb();
  const targetRef = db.collection("users").doc(targetUid);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new AppError("USER_NOT_FOUND", "No such user", 404);
  }

  const followingRef = db.collection("users").doc(callerUid).collection("following").doc(targetUid);
  const alreadyFollowing = (await followingRef.get()).exists;
  if (alreadyFollowing) {
    return { status: "following" };
  }

  if (!targetSnap.data()?.followRequiresApproval) {
    const followersRef = db.collection("users").doc(targetUid).collection("followers").doc(callerUid);
    await db.batch().set(followingRef, { createdAt: new Date() }).set(followersRef, { createdAt: new Date() }).commit();
    await writeNotification(targetUid, "newFollower", callerUid, "user", callerUid);
    return { status: "following" };
  }

  const requestRef = db.collection("users").doc(targetUid).collection("followRequests").doc(callerUid);
  const alreadyPending = (await requestRef.get()).exists;
  if (!alreadyPending) {
    await requestRef.set({ createdAt: new Date() });
    await writeNotification(targetUid, "followRequest", callerUid, "user", callerUid);
  }
  return { status: "pending" };
}

// DELETE /users/:uid/follow — unfollows if following, cancels a pending request
// otherwise. Idempotent either way (hld.md §4's "Unfollow" sub-flow).
export async function unfollowUser(callerUid: string, targetUid: string): Promise<void> {
  const db = requireDb();
  const followingRef = db.collection("users").doc(callerUid).collection("following").doc(targetUid);
  const followersRef = db.collection("users").doc(targetUid).collection("followers").doc(callerUid);
  const requestRef = db.collection("users").doc(targetUid).collection("followRequests").doc(callerUid);

  await db.batch().delete(followingRef).delete(followersRef).delete(requestRef).commit();
}

// GET /users/me/followRequests — pending requests FOR the caller to approve/deny.
export async function listFollowRequests(uid: string): Promise<{ items: FollowRequest[] }> {
  const db = requireDb();
  const snap = await db.collection("users").doc(uid).collection("followRequests").get();
  const items = await Promise.all(
    snap.docs.map(async (d) => {
      const userSnap = await db.collection("users").doc(d.id).get();
      return {
        uid: d.id,
        displayName: userSnap.data()?.displayName ?? "Unknown",
        photoURL: userSnap.data()?.photoURL ?? null
      };
    })
  );
  return { items };
}

export async function approveFollowRequest(meUid: string, requesterUid: string): Promise<void> {
  const db = requireDb();
  const requestRef = db.collection("users").doc(meUid).collection("followRequests").doc(requesterUid);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    throw new AppError("REQUEST_NOT_FOUND", "No such follow request", 404);
  }

  const followingRef = db.collection("users").doc(requesterUid).collection("following").doc(meUid);
  const followersRef = db.collection("users").doc(meUid).collection("followers").doc(requesterUid);
  await db.batch().set(followingRef, { createdAt: new Date() }).set(followersRef, { createdAt: new Date() }).delete(requestRef).commit();
  await writeNotification(requesterUid, "followApproved", meUid, "user", meUid);
}

export async function denyFollowRequest(meUid: string, requesterUid: string): Promise<void> {
  const db = requireDb();
  await db.collection("users").doc(meUid).collection("followRequests").doc(requesterUid).delete();
}
