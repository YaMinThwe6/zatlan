import { Router } from "express";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  postEvent,
  getUpcomingEvents,
  getNearbyEvents,
  getHostedEvents,
  putJoinEvent,
  deleteJoinEvent,
  getJoinRequests,
  postApproveJoinRequest,
  postDenyJoinRequest,
  getEvent,
  deleteEvent
} from "../controllers/events.controller.js";

export const eventsRouter = Router();

eventsRouter.post("/events", requireAuth, asyncHandler(postEvent));
// Public — guest Discover's event teaser needs this too (never returns
// precise location either way, see events.service.ts's listUpcomingEvents).
// optionalAuth (not requireAuth): stays reachable without a token, but picks
// up req.uid when one is given, so Home's signed-in call to this same
// endpoint gets each event's real `joined` status back.
eventsRouter.get("/events/upcoming", optionalAuth, asyncHandler(getUpcomingEvents));
eventsRouter.get("/events/nearby", requireAuth, asyncHandler(getNearbyEvents));
// Kept above the ":eventId" routes below for the same shadowing reason as
// "upcoming"/"nearby" — a literal path segment has to be registered before
// any param route that would otherwise swallow it as :eventId.
eventsRouter.get("/events/hosting", requireAuth, asyncHandler(getHostedEvents));
eventsRouter.put("/events/:eventId/join", requireAuth, asyncHandler(putJoinEvent));
eventsRouter.delete("/events/:eventId/join", requireAuth, asyncHandler(deleteJoinEvent));
eventsRouter.get("/events/:eventId/joinRequests", requireAuth, asyncHandler(getJoinRequests));
eventsRouter.post("/events/:eventId/joinRequests/:requesterUid/approve", requireAuth, asyncHandler(postApproveJoinRequest));
eventsRouter.post("/events/:eventId/joinRequests/:requesterUid/deny", requireAuth, asyncHandler(postDenyJoinRequest));
// Kept last among GET routes: a param route registered before "/events/upcoming"
// and "/events/nearby" would shadow them by matching "upcoming"/"nearby" as :eventId first.
eventsRouter.get("/events/:eventId", requireAuth, asyncHandler(getEvent));
eventsRouter.delete("/events/:eventId", requireAuth, asyncHandler(deleteEvent));
