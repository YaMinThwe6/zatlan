import type { Request, Response } from "express";
import { Responder } from "../utils/responder.js";
import * as notificationsService from "../services/notifications.service.js";

export async function getNotifications(req: Request, res: Response): Promise<void> {
  const result = await notificationsService.listNotifications(req.uid!, req.query.limit, req.query.unreadOnly === "true");
  Responder.success(res, result);
}

export async function patchNotification(req: Request, res: Response): Promise<void> {
  await notificationsService.markNotificationRead(req.uid!, req.params.notificationId, req.body?.read);
  Responder.noContent(res);
}

export async function postClearNotifications(req: Request, res: Response): Promise<void> {
  await notificationsService.clearAllNotifications(req.uid!);
  Responder.noContent(res);
}
