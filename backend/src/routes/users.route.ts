import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getMe, checkUsernameAvailable, patchMe, getUserProfile, getUserReviews } from "../controllers/users.controller.js";

export const usersRouter = Router();

usersRouter.get("/users/me", requireAuth, asyncHandler(getMe));
// Authenticated — its only caller (onboarding's UsernameStep) is always
// post-login, and the check needs to know who's asking to correctly treat a
// caller's own already-saved username as available, not "taken".
usersRouter.get("/users/username-available", requireAuth, asyncHandler(checkUsernameAvailable));
usersRouter.patch("/users/me", requireAuth, asyncHandler(patchMe));
// Kept last: a param route registered before the static ones above would
// shadow "/users/me" and "/users/username-available" by matching "me"/
// "username-available" as :uid first.
usersRouter.get("/users/:uid", requireAuth, asyncHandler(getUserProfile));
usersRouter.get("/users/:uid/reviews", requireAuth, asyncHandler(getUserReviews));
