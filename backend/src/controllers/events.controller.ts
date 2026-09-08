import type { Request, Response } from "express";
import { Responder } from "../utils/responder.js";
import * as eventsService from "../services/events.service.js";

export async function postEvent(req: Request, res: Response): Promise<void> {
  const result = await eventsService.createEvent(req.uid!, req.body ?? {});
  Responder.success(res, result, "OK", 201);
}

export async function getUpcomingEvents(req: Request, res: Response): Promise<void> {
  const result = await eventsService.listUpcomingEvents(req.query.limit, req.query.movieId, req.uid);
  Responder.success(res, result);
}

export async function getNearbyEvents(req: Request, res: Response): Promise<void> {
  const result = await eventsService.listNearbyEvents(req.uid!, req.query.lat, req.query.lng, req.query.radiusKm);
  Responder.success(res, result);
}

export async function getHostedEvents(req: Request, res: Response): Promise<void> {
  const result = await eventsService.listHostedEvents(req.uid!);
  Responder.success(res, result);
}

export async function getJoinedEvents(req: Request, res: Response): Promise<void> {
  const result = await eventsService.listJoinedEvents(req.uid!, req.query.when);
  Responder.success(res, result);
}

export async function getRequestedEvents(req: Request, res: Response): Promise<void> {
  const result = await eventsService.listRequestedEvents(req.uid!);
  Responder.success(res, result);
}

export async function putJoinEvent(req: Request, res: Response): Promise<void> {
  const result = await eventsService.joinEvent(req.uid!, req.params.eventId);
  Responder.success(res, result);
}

export async function deleteJoinEvent(req: Request, res: Response): Promise<void> {
  await eventsService.leaveEvent(req.uid!, req.params.eventId);
  Responder.noContent(res);
}

export async function getJoinRequests(req: Request, res: Response): Promise<void> {
  const result = await eventsService.listJoinRequests(req.uid!, req.params.eventId);
  Responder.success(res, result);
}

export async function postApproveJoinRequest(req: Request, res: Response): Promise<void> {
  await eventsService.approveJoinRequest(req.uid!, req.params.eventId, req.params.requesterUid);
  Responder.noContent(res);
}

export async function postDenyJoinRequest(req: Request, res: Response): Promise<void> {
  await eventsService.denyJoinRequest(req.uid!, req.params.eventId, req.params.requesterUid);
  Responder.noContent(res);
}

export async function getEvent(req: Request, res: Response): Promise<void> {
  const result = await eventsService.getEvent(req.params.eventId, req.uid!);
  Responder.success(res, result);
}

export async function deleteEvent(req: Request, res: Response): Promise<void> {
  await eventsService.deleteEvent(req.uid!, req.params.eventId);
  Responder.noContent(res);
}
