import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  getTasteMatches,
  putFollowedCelebrity,
  deleteFollowedCelebrity,
  getFollowedCelebrities,
  getMovieWatchedBy,
  getPeopleSearch,
  getDiscoverPeople
} from "../controllers/people.controller.js";

export const peopleRouter = Router();

peopleRouter.get("/users/me/tasteMatches", requireAuth, asyncHandler(getTasteMatches));
peopleRouter.put("/users/me/followedCelebrities/:personId", requireAuth, asyncHandler(putFollowedCelebrity));
peopleRouter.delete("/users/me/followedCelebrities/:personId", requireAuth, asyncHandler(deleteFollowedCelebrity));
peopleRouter.get("/users/me/followedCelebrities", requireAuth, asyncHandler(getFollowedCelebrities));
peopleRouter.get("/movies/:movieId/watchedBy", requireAuth, asyncHandler(getMovieWatchedBy));
peopleRouter.get("/people/search", requireAuth, asyncHandler(getPeopleSearch));
// Public — the signed-out Discover page's "People you might vibe with"
// teaser needs this too, same reasoning as GET /events/upcoming.
peopleRouter.get("/discover/people", asyncHandler(getDiscoverPeople));
