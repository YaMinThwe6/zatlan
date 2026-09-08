import { z } from "zod";

const envSchema = z.object({
  PORT: z.string().default("6501"),
  TMDB_READ_ACCESS_TOKEN: z.string().min(1, "TMDB_READ_ACCESS_TOKEN is required"),
  TMDB_API_KEY: z.string().min(1).optional(),
  FIREBASE_PROJECT_ID: z.string().min(1).optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  // Shared secret for the scheduled-job-only POST /events/remind endpoint
  // (events.service.ts's sendEventReminders) — there's no signed-in user
  // behind a cron call, so requireAuth doesn't apply; a scheduler (e.g.
  // Cloud Scheduler) sends this in an X-Cron-Secret header instead.
  CRON_SECRET: z.string().min(1).optional()
});

export const env = envSchema.parse(process.env);

// GOOGLE_APPLICATION_CREDENTIALS (a service-account key file path) is only
// required for local dev. On Cloud Run, the service's own attached service
// account already provides Application Default Credentials with no key file
// needed — firebaseAdmin.ts falls back to that when only FIREBASE_PROJECT_ID
// is set, which is exactly why this doesn't require GOOGLE_APPLICATION_CREDENTIALS.
export const firebaseConfigured = Boolean(env.FIREBASE_PROJECT_ID);

export const smtpConfigured = Boolean(env.SMTP_USER && env.SMTP_PASS);

// PRD §30.8 — AI-assisted content moderation. Same graceful-degradation
// pattern as Firebase/SMTP above: reports still get created without a key,
// they just stay "pending" (no human queue exists to fall back to — see
// gemini.ts) rather than the request failing outright.
export const geminiConfigured = Boolean(env.GEMINI_API_KEY);
