import type { NextFunction, Request, Response } from "express";
import type { DecodedIdToken } from "firebase-admin/auth";
import { auth } from "../lib/firebaseAdmin.js";
import { logger } from "../lib/logger.js";
import { Responder } from "../utils/responder.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      uid?: string;
      authClaims?: DecodedIdToken;
    }
  }
}

/**
 * Verifies the `Authorization: Bearer <Firebase ID token>` header (api-contracts.md §0)
 * and attaches `req.uid` / `req.authClaims` on success. 401s otherwise — never trusts
 * a client-supplied uid (hld.md §10).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!auth) {
    return Responder.error(res, "AUTH_NOT_CONFIGURED", "Firebase Auth is not configured on this server", 503);
  }

  const header = req.header("Authorization") ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return Responder.error(res, "UNAUTHENTICATED", "Missing or malformed Authorization header", 401);
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    req.uid = decoded.uid;
    req.authClaims = decoded;
    return next();
  } catch (err) {
    logger.error("[requireAuth] token verification failed", err);
    return Responder.error(res, "UNAUTHENTICATED", "Invalid or expired token", 401);
  }
}

/**
 * For routes that must stay reachable by a signed-out guest (GET /events/upcoming
 * — the Discover page's events teaser) but still want to know who's asking when
 * someone IS signed in (Home's own call to the same endpoint, to report each
 * event's `joined` status correctly). Unlike requireAuth, a missing or invalid
 * token never 401s here — it just proceeds without `req.uid`, same as a guest.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  if (!auth) return next();

  const header = req.header("Authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return next();

  try {
    const decoded = await auth.verifyIdToken(token);
    req.uid = decoded.uid;
    req.authClaims = decoded;
  } catch {
    // Invalid/expired token on an optional-auth route — proceed as a guest
    // rather than 401, since a token isn't required here in the first place.
  }
  next();
}
