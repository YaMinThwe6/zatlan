import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getRoom, postMessage, patchMessage, deleteMessage, patchRoom, postRoomEvent } from "../controllers/rooms.controller.js";

export const roomsRouter = Router();

roomsRouter.get("/rooms/:roomId", requireAuth, asyncHandler(getRoom));
roomsRouter.post("/rooms/:roomId/messages", requireAuth, asyncHandler(postMessage));
roomsRouter.patch("/rooms/:roomId/messages/:messageId", requireAuth, asyncHandler(patchMessage));
roomsRouter.delete("/rooms/:roomId/messages/:messageId", requireAuth, asyncHandler(deleteMessage));
roomsRouter.patch("/rooms/:roomId", requireAuth, asyncHandler(patchRoom));
roomsRouter.post("/rooms/:roomId/events", requireAuth, asyncHandler(postRoomEvent));
