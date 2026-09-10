import type { Response } from "express";

// Single response envelope for the whole API — docs/backend-conventions.md §3.
// Adapted from the reference project's {success,message,data,statusCode}
// shape with one addition: a machine-readable `code` on errors (the
// reference pattern only carries a free-text `error` string) — ZATLAN's routes
// already relied on codes like "MOVIE_NOT_FOUND"/"INVALID_RATING" for callers
// to branch on, dropping them would be a real regression, not a simplification.
export interface SuccessEnvelope<T> {
  success: true;
  message: string;
  data: T;
  statusCode: number;
}

export interface ErrorEnvelope {
  success: false;
  message: string;
  code: string;
  statusCode: number;
}

export const Responder = {
  success<T>(res: Response, data: T, message = "OK", statusCode = 200): Response<SuccessEnvelope<T>> {
    return res.status(statusCode).json({ success: true, message, data, statusCode });
  },

  noContent(res: Response): Response {
    return res.status(204).send();
  },

  error(res: Response, code: string, message: string, statusCode: number): Response<ErrorEnvelope> {
    return res.status(statusCode).json({ success: false, message, code, statusCode });
  }
};
