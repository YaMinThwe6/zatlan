# ZATLAN — Backend & Monorepo Conventions

Written 2026-08-29, after the codebase had already grown past its initial scaffold — this document exists because that growth surfaced real gaps (no logging, no lint/format tooling, routes mixing HTTP handling with business logic) worth naming and fixing deliberately, rather than letting each new feature branch improvise its own answer. Partly informed by a reference project (`lms-server-course-core`) the user pointed at for backend structure — some of its conventions are adopted here, some are explicitly declined; each says why.

---

## 1. Tooling

**Lint + format: ESLint + Prettier, one config for the whole monorepo** (`eslint.config.js` and `.prettierrc.json` at the repo root, covering `backend/`, `frontend/`, and `packages/*`). Replaces frontend's earlier `oxlint` setup — a single, more configurable toolchain beats a different linter per package. Run via `pnpm lint` / `pnpm format` / `pnpm format:check` from the root, or `pnpm --filter <pkg> run lint` per package (each package's `lint` script points `--config` back at the root file).

- `backend/**` and `packages/*/src/**` keep their existing style (semicolons, double quotes) via a Prettier `overrides` block — the two packages were written in different styles from the start (backend: semicolons/double-quotes; frontend: no semicolons/single-quotes) and unifying them retroactively would be a large, purely-cosmetic diff with no functional value. New code should match whichever style its own package already uses.
- `react-hooks/set-state-in-effect` is downgraded to `warn` (not `off`, not `error`) — the rule flags several already-tested, idiomatic effect patterns already in the codebase (e.g. "if a dependency goes away, reset state and return early"), fixing all of them is a separate cleanup, but new code should still be nudged away from the pattern.
- `backend/src/lib/tmdb.ts` has `@typescript-eslint/no-explicit-any` turned off for that one file — it parses raw, dynamically-shaped TMDB JSON; modeling TMDB's entire API surface for a handful of parsing call sites isn't worth it. This is a deliberate, scoped exemption, not a blanket allowance.
- **Not yet done:** a repo-wide `pnpm format` pass. The tooling works (verified clean lint run, `prettier --check` runs without error) but running it across ~107 already-existing files would produce a large, unrelated formatting-only diff — left as an optional, separate cleanup commit for whenever it's wanted, not bundled into a feature branch.
- Enforced at commit time: `.husky/pre-commit` runs `pnpm lint && pnpm build && pnpm test` — a commit can't land with lint errors, a broken build, or a failing test.

**Logging: Winston** (`backend/src/lib/logger.ts`), replacing every `console.*` call across backend routes/lib/middleware. Environment-aware:
- `test` → silent (keeps `pnpm test` output readable; the logger still exists and is callable, it just doesn't emit)
- `development` → colorized, human-readable single line
- `production` → structured JSON (timestamp + level + message + metadata), suitable for a log aggregator

Every route's `catch` block logs through `logger.error(...)` instead of `console.error(...)`. No log-shipping destination is wired up yet (the reference project sketches an HTTP transport for production; ZATLAN doesn't have a log server to point it at) — that's a real gap, tracked here rather than silently deferred, and the transport can be swapped in `logger.ts` alone when one exists, without touching any call site.

**Security headers:** `helmet()` added to the Express app (`backend/src/app.ts`), matching the reference project. No downside, no API contract implication — just missing before.

---

## 2. Folder structure

**Status (2026-08-29): done**, on `feature/architecture-restructure`. All 12 resources now follow a layered split modeled on the reference project's `controllers/` + `services/` + `routes/`:
- `routes/*.route.ts` — thin: wires an HTTP method + path to a controller function via `asyncHandler` (see §3), nothing else.
- `controllers/*.controller.ts` — translates between HTTP (req/res) and the service layer's plain function calls; builds the response via `Responder` (§3), never catches errors itself.
- `services/*.service.ts` — the actual business logic and Firestore transactions, framework-agnostic (no `req`/`res`), independently testable without `supertest`; throws `AppError` for business-rule failures.

`lib/` still holds cross-cutting infrastructure (Firebase Admin SDK setup — now also exporting `requireDb()`/`requireFirebaseAuth()`, see §3 — TMDB client, mailer, OTP, notify, logger). `middleware/` holds Express middleware (`requireAuth`, plus the new `errorHandler.ts`). `data/` holds static datasets (curated movie quotes). `utils/` is new: `AppError.ts`, `responder.ts`, `asyncHandler.ts`.

One deliberate resource split during the migration: the old `routes/people.ts` bundled `/onboarding/celebrity-suggestions` alongside the taste-matches/followed-celebrities endpoints even though it lives under the `/onboarding` URL namespace. It now lives in `onboarding.service.ts`/`onboarding.controller.ts` alongside `/onboarding/watched-candidates`, for URL-namespace/resource consistency — `people.service.ts` keeps only the `/users/me/tasteMatches` and `/users/me/followedCelebrities` endpoints.

---

## 3. Response envelope

**Status (2026-08-29): done**, on `feature/architecture-restructure`. Every endpoint now responds through a single `Responder` (`backend/src/utils/responder.ts`):
- Success: `{ success: true, message: string, data: T, statusCode: number }` — via `Responder.success(res, data, message?, statusCode?)`.
- No-content (204): via `Responder.noContent(res)`.
- Error: `{ success: false, message: string, code: string, statusCode: number }` — via `Responder.error(res, code, message, statusCode)`, called from the single `globalErrorHandler` (`backend/src/middleware/errorHandler.ts`), never from individual routes/controllers.

**Deliberate deviation from the reference project:** the reference pattern's error shape only carries a free-text `error` string. ZATLAN keeps a machine-readable `code` field (e.g. `MOVIE_NOT_FOUND`, `INVALID_RATING`) alongside `message` — dropping it would have been a real regression against the ~140 existing tests and the frontend, both of which branch on these codes, not against free-text messages.

**Mechanics:**
- `AppError` (`backend/src/utils/AppError.ts`) — `new AppError(code, message, statusCode)`, thrown from any service for an expected/business-rule failure (not found, invalid input, forbidden, conflict, restricted account, etc.).
- `globalErrorHandler` — the *only* place that turns a thrown error into an HTTP response. An `AppError` maps directly via its own `code`/`message`/`statusCode`; anything else (a real bug, a Firestore outage) is logged via `logger.error` and mapped to a generic `500`/`"INTERNAL_ERROR"`/`"An unexpected error occurred."` — raw error messages are never leaked to the client.
- `asyncHandler` (`backend/src/utils/asyncHandler.ts`) — wraps every controller in every route registration. ZATLAN's backend runs **Express 4**, which does not auto-forward a rejected async handler's error to error middleware; without this wrapper a thrown `AppError` becomes an unhandled rejection instead of a response.
- `requireDb()` / `requireFirebaseAuth()` (`backend/src/lib/firebaseAdmin.ts`) — replace the old per-route `if (!db) return res.status(503).json(...)` boilerplate. A service calls `const db = requireDb();` and gets a non-null `Firestore`, or an `AppError("FIRESTORE_NOT_CONFIGURED"/"FIREBASE_NOT_CONFIGURED", ..., 503)` is thrown automatically.

**Simplification made along the way:** the old per-route generic `catch (err) { ... return res.status(502).json({error:{code:"FIRESTORE_ERROR",...}}) }` wrapper was dropped everywhere except where a test specifically depends on it (only `movies.test.ts`'s TMDB-upstream-failure case, which keeps its own explicit `AppError("TMDB_UPSTREAM_ERROR", ..., 502)`). Every other unexpected error now bubbles to `globalErrorHandler`'s generic 500 fallback — services no longer need defensive generic try/catch blocks.

`docs/api-contracts.md`'s Conventions section and per-endpoint response shapes still need updating to match this envelope — tracked as a follow-up doc pass, not blocking.

---

## 4. What this doesn't change

The [[feedback_feature_branch_workflow]] convention (one feature per branch, scenarios-then-tests-then-code, commit → merge → delete branch) and the [[feedback_no_ai_attribution_in_commits]] rule both still apply, including to the two migrations tracked above when their time comes.
