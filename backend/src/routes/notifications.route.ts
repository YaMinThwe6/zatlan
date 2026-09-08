import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getNotifications, patchNotification, postClearNotifications } from "../controllers/notifications.controller.js";

export const notificationsRouter = Router();

notificationsRouter.get("/users/me/notifications", requireAuth, asyncHandler(getNotifications));
// Kept above ":notificationId" for the same shadowing reason as elsewhere —
// harmless here since the methods differ (POST vs PATCH), but consistent
// with the rest of the codebase's convention regardless.
notificationsRouter.post("/users/me/notifications/clear", requireAuth, asyncHandler(postClearNotifications));
notificationsRouter.patch("/users/me/notifications/:notificationId", requireAuth, asyncHandler(patchNotification));
