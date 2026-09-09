import type { Request, Response } from "express";
import { Responder } from "../utils/responder.js";
import * as roomsService from "../services/rooms.service.js";

export async function getRoom(req: Request, res: Response): Promise<void> {
  const result = await roomsService.getRoomDetail(req.uid!, req.params.roomId);
  Responder.success(res, result);
}

export async function postMessage(req: Request, res: Response): Promise<void> {
  const result = await roomsService.sendMessage(req.uid!, req.params.roomId, req.body?.text);
  Responder.success(res, result, "OK", 201);
}

export async function patchMessage(req: Request, res: Response): Promise<void> {
  await roomsService.editMessage(req.uid!, req.params.roomId, req.params.messageId, req.body?.text);
  Responder.success(res, {});
}

export async function deleteMessage(req: Request, res: Response): Promise<void> {
  await roomsService.deleteMessage(req.uid!, req.params.roomId, req.params.messageId);
  Responder.noContent(res);
}

export async function patchRoom(req: Request, res: Response): Promise<void> {
  await roomsService.promoteRoom(req.uid!, req.params.roomId);
  Responder.success(res, {});
}

export async function postRoomEvent(req: Request, res: Response): Promise<void> {
  const result = await roomsService.scheduleEventFromRoom(req.uid!, req.params.roomId, req.body ?? {});
  Responder.success(res, result, "OK", 201);
}
