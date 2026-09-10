# ZATLAN — High-Level Design (Working Notes)

Living document from the HLD walkthrough. Captures components, traced request flows, decisions made, and things still open. See [PRD.md](PRD.md) for product scope, [imdb-data-analysis.md](imdb-data-analysis.md) for the IMDb dataset analysis, and [backend-conventions.md](backend-conventions.md) / [frontend-conventions.md](frontend-conventions.md) for tooling/logging/folder-structure/response-envelope conventions (separate from *what* the app does, which lives here).

---

## 1. Components (boxes)

- **React frontend** (client) — never talks to TMDB or holds any credentials
- **Node.js backend** — the only thing that talks to Firestore/TMDB directly; never trusts the frontend (see §10)
- **Firestore** — users, following/followers, watchlists, watched history, ratings, reviews, events, chat, and the movie catalog itself (`movies` collection)
- **TMDB API** — external, movie enrichment (synopsis, poster, backdrop, cast/crew, TMDB rating)
- **Cache** — sits in front of Firestore's `movies` collection to avoid repeated reads/TMDB calls
- **Firebase Authentication** — frontend talks to it directly for sign-up/login (see §13); backend only ever verifies the resulting token, never handles credentials itself
- **BigQuery** — demoted to **analytics-only**, off the live request path (see §5b)
- **Gemini / Google AI Studio** — autonomous content moderation, §14/§30.8. Server-side only (`backend/src/lib/gemini.ts`), same "credentials stay backend-only" principle as TMDB — unlike Maps/Firebase Auth below, there's no reason for the frontend to ever call Gemini directly here.
- **Google Maps Platform** — not yet traced
- **Firebase Realtime Database** — used specifically for live presence ("who's watching now"), not general app data; see §15
- **Real-time layer for chat/event rooms** — Firestore listeners; see §16
- **Firebase Cloud Messaging (FCM)** — push notifications; see §17
- **Vertex AI Search (Media vertical)** — named as the primary search-index candidate in §18's original design, not built (cost/setup not worth it at prototype scale); the Firestore word-prefix + typo-variant index §18 named as its fallback is what's actually live — bulk-seeded from TMDB, separate from the per-movie detail cache in §2; see §18

---

## 2. Flow: Movie Details (view a specific, already-identified movie)

```
User → Frontend → Backend → Cache
                              ├── HIT → Return
                              └── MISS → Firestore(movies)
                                          ├── HIT → Return
                                          └── MISS → TMDB API (movie details + TMDB rating)
                                                       → write to Firestore(movies)
                                                       → populate cache
                                                       → Return
```

**Decisions:**
- Movie catalog ("ZATLAN Movie DB") lives in Firestore, same database as everything else — no reason yet to split it out.
- Frontend never calls TMDB directly; credentials stay backend-only.
- **BigQuery/IMDb dropped from this flow.** The IMDb rating in BigQuery is stale (the public dataset isn't kept current), and TMDB's API doesn't expose IMDb's actual rating (only an `imdb_id` for cross-referencing) — so "refresh IMDb rating from BigQuery" was never actually going to produce a fresher number, just a differently-stale one. **TMDB's own rating (`vote_average`) replaces "IMDb rating" as the third-party rating shown in the product.** This also means §16.3 of the PRD ("IMDb: 8.7/10 vs ZATLAN: 4.6/5") needs relabeling to "TMDB rating vs ZATLAN rating" — noted, not yet applied to PRD.md.
- BigQuery is repurposed as an **analytics-only** system, fed by a separate (not yet designed) pipeline from Firestore — disconnected from this live flow.
- **This flow is specifically "fetch full details for a movie the user already selected"** — not the same thing as *finding* that movie in the first place. Originally conflated with search; corrected in §18, which now owns discovery. This flow triggers only once a specific movie is opened (from a search result, a recommendation, etc.), and is where the full TMDB detail fetch + IMDb-rating-at-ingestion-time actually happens.

---

## 3. Flow: Watchlist / Rate (write path)

```
User clicks "Add to Watchlist"
        ↓
Frontend → Backend
        ↓
Backend verifies Firebase Auth token (required for writes and user-specific reads; public search/browse does not require it)
        ↓
Backend verifies the movie actually exists in Firestore(movies) — never trusts a frontend-supplied ID
        ↓
Backend writes users/{uid}/watchlist/{movieId} to Firestore
        ↓
Return success → Frontend updates UI
```

**Decisions:**
- Auth is checked only where it's actually needed (writes, user-specific reads) — not on every request.
- **Cross-cutting principle:** the backend is a separate, untrusted-input system relative to the frontend. Every write, and every read that returns user-specific or gated data, is validated and re-checked server-side (referenced IDs, ownership, permissions) regardless of what the frontend sends. Applies beyond this one flow — ratings, event joins, follow requests, chat messages, etc.

---

## 4. Flow: Follow / Follow Requests

```
User B has a setting: followRequiresApproval (default: off — matches Instagram's default-open follow)

User A clicks "Follow" on B's profile
        ↓
Frontend → Backend
        ↓
Backend verifies Auth token (write path)
        ↓
Backend checks B's CURRENT followRequiresApproval setting server-side — never trusts a frontend claim about which branch applies
        ↓
Branch:
  - Not required → write users/{A}/following/{B} + users/{B}/followers/{A} directly
  - Required     → write users/{B}/followRequests/{A} (pending) → B reviews later
        ↓
Return status → Frontend
```

**Decision:** per-user setting, off by default. When on, a follow becomes a pending request until B approves or denies it.

B approving/denying reuses the exact same "pending request → owner approves → becomes real relationship" shape already used for event join requests (§7) — the third time this pattern has shown up (watchlist ownership check, event join approval, now follow approval), reinforcing that it's a genuinely reusable shape rather than one-off logic.

### Unfollow

```
User A unfollows User B
        ↓
Backend verifies Auth token
        ↓
Backend deletes users/{A}/following/{B} and users/{B}/followers/{A}
```

Simple mirror of Follow, no new decisions needed. §5a's "people who watched" query reads the *current* following list live, so it naturally stops including B the moment the relationship is deleted — no separate cleanup. Re-following later goes through the normal Follow flow again, including approval if B has that setting on.

**Implementation note (added once this was actually built):** modeled as `PUT`/`DELETE /users/:uid/follow`, not `POST` — matches the idempotent "set this relationship" shape every other write endpoint in this API already uses (watchlist, watched, followedCelebrities). Both branches are idempotent by construction: re-following someone already followed, or re-requesting an already-pending follow, is a no-op success rather than a duplicate write or a duplicate notification. Block/Mute (§19) aren't built yet — this covers Follow/Unfollow/approve/deny only, live in `backend/src/routes/follow.ts`.

---

## 5. Flow: Social Discovery

Split into two sub-features with different shapes.

### 5a. "People who watched this movie" (following-only, privacy-aware)

**Decision (confirmed with PM):** the follow model is **one-directional, Instagram-style** — following someone does not imply they follow you back. Modeled as `users/{uid}/following/{followedUid}` (and a mirrored `followers` subcollection for fast reverse lookups, e.g. follower counts). See §4 for how a follow relationship is created.

```
User views movie page
        ↓
Backend fetches the caller's `following` list (bounded — who this user follows, not all ZATLAN users)
        ↓
For each followed user:
    - check users/{uid}/watched/{movieId} exists
    - check the entry's own visibility isn't overridden to private (per-entry privacy)
    - check that user's list-level privacy setting allows their watched list to be visible at all
        ↓
Return: followed users who watched it AND both visibility checks pass
```

**Decision:** only people the *caller* follows are shown — never a global "everyone who watched this" list, and not people who follow the caller but aren't followed back (that would surface activity from people whose content the user never opted into seeing). A user's privacy setting can hide their watched-list visibility even from people who follow them.

**Decision — per-entry privacy override:** even when a user's watched list is public by default, individual entries can be marked private, hidden from everyone (including followers) and visible only to the owner. Modeled as `users/{uid}/watched/{movieId}.visibility: "public" | "private"`, checked in addition to the list-level toggle. Motivating case: a user watched something they don't want anyone to know about, even though their list is otherwise public. Possible future nicety (not required now): default this to private automatically for titles flagged `is_adult` in the movie catalog, reducing manual toggling.

**Why this shape, not a collection-group query or a reverse index on the movie:** both of those return everyone globally who watched the movie, which then has to be filtered down to "is this person someone I follow" — wasteful when a user follows a handful of people out of a much larger user base. Instead, the backend **fans out from the caller's own (bounded) `following` list** and checks each one directly. This scales with "how many people you follow," not "how many users ZATLAN has."

### 5b. "People with similar movie taste"

Fundamentally different from 5a — not a lookup, a cross-user comparison (your entire watch/rating history vs. everyone else's). Firestore is built for fast small lookups, not "compare everything against everything," so this needs a batch job, not a live query.

```
(scheduled — a cron job, once a day)
Firestore (watched-list + genres data)
        ↓  export/stream
BigQuery — compute taste-similarity scores between users
        ↓
Write "top N similar users" back into Firestore, per user
        ↓
(live) User opens app → Backend reads precomputed matches from Firestore → Return
```

**Decision:** runs as a daily cron job (not recomputed per request). This is also where BigQuery's "analytics-only" role from §2 actually gets used.

**Decision (confirmed with PM):** similarity is based on **overlap of watched movies + shared genres**.

**Implementation note (added once this was actually built):** the BigQuery hop is a scale optimization — at real ZATLAN scale (comparing many users pairwise) Firestore genuinely can't do that cheaply, which is why the design routes through BigQuery. But with a handful of test users during early development, that comparison is trivial directly against Firestore, and standing up actual Cloud Scheduler + a BigQuery export pipeline for zero practical benefit at this volume isn't worth the setup cost yet. `backend/scripts/computeTasteMatches.ts` implements the exact same algorithm (watched-movie overlap + shared genres) directly against Firestore, runnable on demand for now; the read side (`GET /users/me/tasteMatches` below) is unaffected either way since it only ever reads the precomputed `tasteMatches` subcollection, regardless of what wrote it. Swapping in the real cron + BigQuery pipeline once there's enough users to matter is an infrastructure change, not an algorithm or API change.

### 5c. Public profiles — where a person card in 5a/5b actually goes

**Implementation note (added once this was actually built, PRD §8):** both 5a's "people who watched this movie" and 5b's taste-match list rendered a name with no page to click through to — `GET /users/:uid` (api-contracts.md §11b) closes that loop: displayName/username/photoURL/favoriteGenres/preferredLanguages, follower/following counts, the caller's own `relationship` to that person (reusing §4's Follow subcollections, not a separate concept), and a privacy-filtered "recently watched" preview (same list-level + per-entry rule as 5a, capped to 12 rather than paginated — a profile section, not a full list view). Scoped deliberately small: no reviews-by-this-user aggregation (would need a new `authorId` field + composite index on the `reviews` collection group, since today a review's doc ID *is* the author's uid rather than an indexed field — real follow-up work, not required for Milestone 4's "discover people → view their profile → follow" loop), and no block/mute (PRD §8 decided the shape but it was never built — same category of gap as the §14 role system).

---

## 6. Flow: Recommendations (content-based)

Different shape from §5b again — that compared **users to users**; this compares **movies to movies** for one user at a time.

```
User opens Recommendations
        ↓
Frontend → Backend
        ↓
Backend verifies Auth token (user-specific read)
        ↓
Backend reads the user's highly-rated/watched movies from Firestore → derives preferred genres
        ↓
Has a preference signal?
  ├── YES → query Firestore(movies) for titles matching those genres (array-contains-any),
  │         excluding anything already watched/watchlisted, sorted by TMDB rating
  │
  └── NO (cold start — new user, no history yet) → fall back to trending/popular titles
        (sorted by TMDB rating/vote count), same exclusion rules
        ↓
Return top N → Frontend
```

**Decision:** start with **live, request-time computation** for the prototype — no new component, just a Firestore query plus backend filtering logic. Computed fresh each time (no caching yet; fine at prototype scale).

**Decision — cold start:** users with no watch/rating history get a trending/popular fallback rather than an empty screen. Not an edge case to handle later — every new user hits this branch on first use, so it's part of the flow from day one.

**Implementation note (added once this was actually built):** "highly-rated/watched movies" above assumed Reviews (§20) would exist by the time this shipped; they don't yet, so the genre-preference signal is derived from watched-history frequency alone for now, with the onboarding `favoriteGenres` (§13) used as a secondary signal only when there's no watch history at all — trending is the final fallback when neither exists. Once Reviews ships, folding rating weight into the genre-frequency count is the natural upgrade, not a redesign. Each returned item also carries a `matchScore` (0-100, Home's "% match" badge) — a heuristic (70% preferred-genre coverage, 30% the movie's own rating), `null` for the trending fallback since there's no preference to score against; see api-contracts.md §6.

**Implementation note — Home's greeting + activity feed (mockup-driven, not previously a numbered flow here):** the Home screen's quote hero (§13's "Watched → first Home greeting") and its "Friends are watching" section are real endpoints, `GET /home/greeting` and `GET /home/activity` — see api-contracts.md §7b for the request/response shapes and schema.md for the new `activity` collection. The greeting prefers a quote from a small curated set (`backend/src/data/movieQuotes.ts`, tagged by real TMDB movie id) when it matches something the caller watched, falling back to a random pick from the same set otherwise. The activity feed reuses §5a's exact fan-out shape (bounded by the caller's own `following` list, never global) reading a new top-level `activity` collection that `watchlist`/`watched` writes append to.

**Implementation note — "Because your friends watched these" (added 2026-09-04, also mockup-driven):** `GET /home/friends-recommendations` — HomeDesktop's right rail, under the §5b taste-matches section. A **social** sibling to this section's content-based recommendations above: same movie-summary shape, but ranked by how many people the caller follows have watched a title (`watchedByCount`) rather than genre overlap, and with no cold-start fallback — an empty `following` list returns no items, and the frontend hides the section rather than backfilling it with trending titles (fabricating a "friends" signal that isn't there would be worse than showing nothing, same call §5b already made for taste matches). See api-contracts.md §7b for the full shape and privacy note.

**Implementation note — "Similar taste picks for you" (added 2026-09-04, also mockup-driven):** `GET /movies/:movieId/similar` — movie detail's right rail (Desktop.dc.html). A **movie-to-movie** sibling to this section's flow above rather than a variant of it: same array-contains-any-on-genres query, just keyed off the movie being viewed instead of the caller's watch history, no `matchScore`, no auth. `frontend/src/features/movie/components/SimilarPicks.tsx`. See api-contracts.md §6 for the full shape.

**Noted for later (per your instruction):** switch to a **precomputed/batch approach**, same shape as §5b, once the algorithm needs to be more sophisticated — in particular, the `review_embedded` vectors surfaced in [docs/imdb-data-analysis.md](imdb-data-analysis.md) could enable real semantic "more like this" similarity, but that needs vector-similarity capability Firestore doesn't have natively, so it's a deliberate future upgrade, not part of the MVP.

**Carried over from the IMDb analysis:** unlike the raw IMDb data (where `genres` was a comma-separated string needing parsing), TMDB returns genres as a proper list — so Firestore movie records built from the on-demand TMDB ingestion (§2) store `genres` as a real array from the start, which is what makes the `array-contains-any` query above straightforward.

---

## 7. Flow: Events / Watch Parties

### Create Event

```
User fills "Create Event" (movie, optional custom title, date/time, online/in-person, location?, public/private, participant limit, approval required?)
        ↓
Frontend → Backend
        ↓
Backend verifies Firebase Auth token (write path)
        ↓
Backend verifies the movie exists in Firestore(movies) — same referential check as watchlist
        ↓
If visibility = private → backend auto-generates a joinCode
        ↓
Backend writes events/{eventId}
    { hostId, movieId, title?, datetime, mode, location?, visibility, participantLimit,
      requiresApproval, joinCode?, invitedUserIds? }
        ↓
Host auto-joins → write events/{eventId}/participants/{hostId}
        ↓
Return success → Frontend shows event page
```

**Decision — `movieId` vs `title`:** these are not the same field. `movieId` references the movie catalog record (source of truth for the movie's real name, poster, etc.); `title` is an *optional custom label* the host can set for the event itself (e.g. "Tamil Thriller Night"). If left blank, the frontend just displays the movie's own title — nothing gets duplicated/stored twice.

**Decision — private event discovery, two entry points into one join flow:** rather than picking one access model, private events support both, layered rather than exclusive:
- **Link/code (always-on for private events):** every private event gets an auto-generated `joinCode`; anyone with the link can look the event up and request to join.
- **Direct invite (optional, host-added on top):** host can additionally add specific `invitedUserIds`; those users see the event in their own "invited to" list without needing the link.

Both entry points feed into the exact same downstream Join Event logic below — supporting both isn't double the work, it's two ways to *reach* the same join flow.

### Join Event

```
User reaches the event (via link/code lookup, an "invited to" listing, or public browse)
        ↓
Frontend → Backend
        ↓
Backend verifies Auth token, verifies event exists, checks participant count < limit
        ↓
Branch on the event's own settings (never trust a frontend claim about which branch applies):
  - No approval required → write events/{eventId}/participants/{uid} directly
  - Approval required     → write events/{eventId}/joinRequests/{uid} (pending) → host reviews later
        ↓
Return status → Frontend
```

Host approving/denying a pending request reuses the same rule from §3: the backend must verify the caller is actually the event's `hostId` before letting them approve anyone — the "never trust the frontend, re-check ownership server-side" principle, applied again rather than reinvented.

**Implementation note (added once this was actually built):** `participantCount` is maintained as a counter field on the event doc (transactionally incremented/decremented alongside each `participants` write), the same pattern already used for `movies.likeCount` — avoids an N-doc read on every join/capacity check. Every event also gets a `rooms/{roomId}` doc created alongside it (schema.md §4) so §16's chat feature has something real to attach to later, even though the chat UI itself isn't built yet. `GET /events/nearby` (§9) is now implemented too — see the note under §9 below. `GET /events/:eventId` and `DELETE /events/:eventId` (§21, delete only — no edit yet) are now implemented too, see §21's own note. Still not yet implemented: joinCode-based lookup for private events (join currently needs the eventId directly), and PATCH (edit) — `backend/src/services/events.service.ts` covers create, get, delete, the public upcoming list, nearby search, and the full join/approve/deny cycle.

**Implementation note — a real "Create Event" form, added 2026-09-04:** the flow above had a real `POST /events` endpoint since early on, but no frontend form ever called it — every event in the system so far came from the seed/test data, not an actual user filling this in. `frontend/src/features/movie/components/WatchTogether.tsx` (movie detail's "Watch together" right rail, mockup-driven, no prior hld.md flow reference) is the first real one: date/time, optional custom title, online/in-person, public/private, participant limit, approval-required, and — for in-person — area/city text fields plus a "Share my location" button that captures `{ lat, lng }` via the browser's Geolocation API (same button-gated, no-auto-prompt pattern §9's own location note already established for NearbyEvents; submission is blocked with an inline error until location is actually captured, mirroring `createEvent`'s own server-side validation rather than trusting the client). The same component also lists upcoming events for just that movie (`GET /events/upcoming?movieId=`, api-contracts.md §8) with an ordinary Join button. Address geocoding (typing an address instead of sharing a device location) remains the open gap §9's note already tracks — unaffected by this.

---

## 8. Flow: Streaming Availability

```
User views "where to watch" on a movie page
        ↓
Frontend → Backend
        ↓
Backend checks Firestore(movies/{movieId}).streamingProviders + its own lastFetched timestamp
        ↓
Fresh enough (within a streaming-specific TTL, shorter than the rest of the movie doc)?
  ├── YES → return cached data
  └── NO  → TMDB /movie/{id}/watch/providers (filtered to region)
              → write refreshed streamingProviders + new lastFetched timestamp into Firestore(movies/{movieId})
              → return
```

**Decision — resolves the open item from PRD §28 ("streaming availability data source"):** TMDB's `watch/providers` endpoint, already available through the TMDB component from §2 — no new vendor, no new credentials.

**Decision — separate refresh cycle from the rest of the movie doc:** streaming catalogs rotate far more often than poster/synopsis/cast, so `streamingProviders` gets its own (shorter) staleness check rather than reusing §2's "fetch once, cache" pattern. Showing a platform a title left months ago is a more visible, more embarrassing failure than a slightly stale cast list.

**Decision — single hardcoded region for the prototype:** India, matching the PRD's own example (Netflix, Prime Video, JioHotstar, Airtel Xstream). Real region detection (user location/profile-based) deferred — noted for later, not needed for MVP.

---

## 9. Flow: Location-Based Discovery

```
User opens "Nearby Events"
        ↓
Frontend gets the user's current position (browser Geolocation API, permission-gated)
        ↓
Frontend → Backend: { lat, lng, radius, filters? }
        ↓
Backend runs a geohash-range query over Firestore(events)
        ↓
Filter to only PUBLIC events, or private events the caller was invited to / has the join code for
        ↓
Return matching events, sorted by distance
```

**Decision — Firestore has no native radius/proximity query.** Events get a geohash field (e.g. via a small library such as GeoFirestore); "nearby" queries run as geohash-prefix range queries, an approximation of a bounding box. A new technique, not a new component — still Firestore.

**Decision — nearby-search must compose with existing event visibility (§7), not bypass it.** A naive geo-radius query would leak a private event's existence and location to any nearby stranger. Nearby results are filtered to public events, or private events the caller can already see (invited, or holds the join code) — the same visibility rules as everywhere else, applied again rather than reinvented.

**Decision — Google Maps' API key is frontend-safe, unlike TMDB's.** Maps' JS API key is designed for client-side embedding, secured via domain/referrer restrictions in Google Cloud Console rather than secrecy — so the frontend calling Maps directly (event-address geocoding at creation time, rendering the map/pins) doesn't violate the "credentials stay backend-only" principle from §2; that principle was specifically about secret keys like TMDB's, not every third-party key.

**Decision — scoped to events only for now.** "Nearby people" is parked as a separate, harder feature (see §11) — it runs directly into the location-privacy requirement already in PRD §30.7 (no precise location shown to other users without explicit consent), which needs a much coarser design (city-level, not GPS-precise) than event-location discovery does.

**Implementation note (added once this was actually built):** `GET /events/nearby` — see api-contracts.md §8 for the exact request/response shape and the geohash-approximation caveat. One deliberate scope-narrowing versus the flow above: the frontend doesn't call Google Maps at all yet (no address geocoding at event-creation time, no map/pin rendering) — `POST /events`'s `location` field just takes a caller-supplied `{ address, lat, lng }` directly, and the browser's own Geolocation API supplies `{ lat, lng }` for the *search* side. Maps integration (geocoding a typed address into lat/lng, rendering pins) is still open, tracked here rather than silently dropped. Location permission is button-gated (`frontend/src/features/home/components/NearbyEvents.tsx`'s "Find events near me"), not requested automatically on every Home visit — consistent with PRD §30.7's no-location-without-consent principle.

**Implementation note (map rendering, added once this half of the gap above was closed):** `frontend/src/features/home/components/NearbyEventsMap.tsx` renders the caller's position and each nearby event's location as pins on an actual Google Map (`@vis.gl/react-google-maps`, the officially-maintained React wrapper for the Maps JS API), clicking a pin opens an InfoWindow with the event's title/distance and the same Join action the list below already offers. Graceful degradation matches the Gemini integration's shape exactly (`frontend/src/lib/maps.ts`'s `mapsConfigured`, mirroring `backend/src/lib/env.ts`'s `geminiConfigured`): with no `VITE_GOOGLE_MAPS_API_KEY` set, `NearbyEvents` renders only the existing text list, never attempting to mount the Maps SDK without a key. Events with `mode: "online"` (no `location`) get no pin, same as they'd have no address to show in the list either. **Still open:** address geocoding at event-creation time — `POST /events`'s `location` still takes a caller-supplied `{ address, lat, lng }` directly rather than the host typing an address and the frontend resolving it via Maps' Geocoding API. That's a separate, smaller gap than "no map at all" and isn't required for nearby-events *discovery*, which is what this note closes.

---

## 10. Cross-cutting principles (apply everywhere, not just one flow)

- Frontend never holds TMDB credentials or talks to TMDB/BigQuery directly.
- Backend treats every frontend request as untrusted: re-validates referenced IDs, ownership, and permissions server-side, always — including which settings/branches apply (e.g. a user's own `followRequiresApproval` value), never a frontend claim about them.
- Auth is checked on writes and user-specific reads; public browse/search does not require it.
- Comparing data *across* users (e.g. taste similarity, §5b) is a scheduled batch job feeding Firestore with precomputed results, not a live per-request computation. Comparing a single user's preferences *against the movie catalog* (content-based recommendations, §6) is cheap enough to compute live for now, with a batch/embedding-based upgrade path noted for later.
- Optional/derived display fields (e.g. an event's `title`) are not duplicated from their source of truth (e.g. the movie's own title) unless they're a genuine override — avoids stale copies.
- The "pending request → owner approves/denies → becomes real" shape is a reusable pattern, not one-off logic: watchlist ownership checks, event join approval, and follow-request approval (§4, §7) all use it.

---

## 11. Parked / TBD (not blocking current work)

- **Real Teleparty-style playback sync (play/pause/seek across streaming platforms) — Phase 2, explicitly out of scope for the Pachamama prototype.** Presence (§15) is the actual MVP scope; everything below is planning-only for a later phase.

  **Confirmed no official API/SDK path exists** for a third-party consumer app — Netflix/Prime/etc. partner SDKs are for certified hardware/device manufacturers embedding the platform on their own devices, not for apps like ZATLAN. Not a pricing-tier problem; structurally unavailable regardless of paid-platform status.

  **Confirmed mechanism (via direct observation of how Rave works):** an app-owned embedded browser engine — `WebView` on Android, `WebView2`/CEF on Windows, `WKWebView` on iOS — loads the streaming platform's *real* site, the user authenticates directly with the platform (confirmed via real Netflix OTP login), and the app injects synchronization logic into that same embedded player's DOM. This only works inside a native app; **ZATLAN's current React web app cannot do this** — a website can't embed and control another website's content the way an app-owned WebView can (cross-origin/iframe restrictions block it). This means Phase 2 isn't a feature addition, it's a second product: a native Android/Windows (and optionally iOS) app.

  **Real blockers, independent of container (WebView vs. WebView2/CEF):**
  - DRM provisioning per platform (Widevine on Android/Windows, FairPlay on iOS — notably harder/less documented) — can cap quality or block playback entirely if misconfigured.
  - Per-platform player reverse-engineering, maintained indefinitely — every platform is a separate, fragile, undocumented integration that can silently break on any UI update.
  - Adversarial, not static — platforms actively invest in detecting/blocking this pattern; not a build-once investment.
  - ToS violation, with real legal exposure (DRM-circumvention-adjacent, e.g. DMCA §1201-style anti-circumvention concerns depending on jurisdiction) — compounds if ZATLAN becomes a paid/commercial platform.
  - Doesn't fit the Sep 7 Pachamama submission regardless of the above — comparable in scope to building a second product.

  **Possible scope reduction if pursued later:** Android + Windows only, drop iOS — removes the hardest DRM case (FairPlay/WKWebView) without solving the rest.
- **Region detection for Streaming Availability (§8)** — beyond the hardcoded India default. Not yet designed.
- **"Nearby people" discovery (§9)** — parked as a separate, harder feature from nearby events. Needs a coarser, privacy-conscious location model (city-level, not GPS-precise) per PRD §30.7, rather than the event-location approach in §9.
- **"Movies none of us have watched" filter** — new feature idea, captured here so it isn't lost. Given a chosen set of people, find movies none of them have watched — solves the real "have you seen this already?" round-robin problem when a group is picking something to watch together. Architecturally this is the *same* building block as §5a (per-user `watched` subcollection + fan-out over a bounded set of people, now known to be a `following`-based set), just walked movies-first instead of people-first. Not yet designed in detail.
- **How data flows into BigQuery for analytics** (§2, §5b) — Firestore export vs. event streaming (e.g. Pub/Sub). Not yet designed.
- **Switch Recommendations (§6) to a precomputed/embedding-based approach** — noted for later, not needed for the prototype.
- **Gemini flows** — traced now: autonomous content moderation, §14/§30.8. (Google Maps is now traced for map rendering — nearby-events pins, §9's implementation note — but address geocoding at event-creation time is still open, same note.)
- **Event notifications** (e.g. host notified of a new join request) — surfaced in §7, not yet designed.
- **Passkey (WebAuthn) sign-in** — future addition alongside OAuth (§13). Firebase Auth has no native passkey provider yet; adding this later means either a third-party Firebase Extension or a custom WebAuthn ceremony + Admin SDK custom-token minting. Not designed in detail — revisit once core product is stable.
- **Anonymous reviews/ratings — decided.** Opt-in **per review/rating** (a per-submission user choice, not a global account-wide setting). When chosen: the author's display name is hidden **consistently on every surface where that specific review/rating renders** (movie page, search, even the poster's own profile reviews list) — not selectively shown in one place and revealed in another. The backend still stores the real `authorId` for moderation/repeat-offender detection (PRD §30's enforcement ladder still works). The rating still contributes normally to the movie's aggregate ZATLAN score — anonymity hides *who* posted it, not the rating itself. Scoped deliberately to **not** reach into §5a's "people who watched this movie" — that's governed by the separate watched-list privacy settings, since "I watched this" and "here's my anonymous opinion" are different disclosures; a user wanting both hidden uses both mechanisms (they're independent, composable). Not yet traced as its own flow — the "submit rating/review" flow itself (of which anonymity is now one property) is still a candidate for a future walkthrough session.

---

## 12. Open Questions for PM

None currently open. Resolved so far:

- ~~Connections model~~ → **one-directional, Instagram-style follow** (§5a).
- ~~Taste-similarity math~~ → **overlap of watched movies + shared genres** (§5b).

New questions get added here as they come up.

---

## 13. Flow: User Onboarding / Sign-up

*Numbered last because it was traced last in this conversation — but chronologically, this happens before every other flow above. Every "Backend verifies Firebase Auth token" step throughout this document assumes onboarding already happened.*

```
User signs up — Google OAuth, Microsoft OAuth, or Email + OTP (passwordless — no email/password option)
        ↓
Google/Microsoft branch:
  Frontend ↔ Firebase Authentication directly, not through our backend
        ↓
  Firebase Auth creates the identity, returns an ID token to the frontend
        ↓
Email + OTP branch (for users without a Google/Microsoft account):
  Frontend → Backend: { email } → backend generates a 6-digit code, stores
    { codeHash, expiresAt } keyed by email, sends it via the same "Trigger
    Email" pattern as §17's notification emails
        ↓
  User enters the code → Frontend → Backend verifies codeHash + not expired
        ↓
  Backend calls Admin SDK: creates/looks up the Firebase Auth user for that
    email, mints a custom token via createCustomToken(), returns it
        ↓
  Frontend signs in to Firebase Auth using the custom token → same ID token
    result as the OAuth branch, converging back into the flow below
        ↓
Frontend → Backend (first authenticated request, carrying the ID token)
        ↓
Backend verifies the token, checks: does users/{uid} already exist in Firestore?
  ├── YES → existing user, this is just a normal login — proceed
  └── NO  → first time → backend creates users/{uid}
              { displayName, username: null, email, createdAt, onboardingComplete: false,
                privacy defaults: listVisible=true, followRequiresApproval=false }
              → return isNewUser: true (false on every subsequent call)
        ↓
Frontend shows onboarding whenever isNewUser OR !onboardingComplete (catches both
"just signed up" and "signed up before, closed the app mid-wizard") — walks through:
    Username (checked live against GET /users/username-available; not optional,
      no Skip) → Favorite genres → Preferred languages → Movies watched (candidates
      filtered by the genres/languages just chosen) → Celebrities to follow
      (suggested from cast/crew of the movies just marked watched) → PATCH
      /users/me { onboardingComplete: true } → done
```

**Decision — passwordless, three sign-in paths: Google, Microsoft, Email+OTP; passkey still deferred.** ZATLAN never collects or stores a password. Google and Microsoft OAuth both use Firebase Auth's built-in providers (Microsoft via its OIDC/Azure AD provider) — zero extra backend work, same as the original Google-only decision. **Email + OTP is a genuine new integration, not a config toggle** — Firebase Auth's own passwordless option is "email link" (click a link in your inbox), not a typed numeric code, so a typed-OTP flow needs custom backend logic: generate the code, store a hash + expiry (not the raw code), email it via the existing Trigger-Email pattern (§17), verify server-side, then mint a Firebase custom token via the Admin SDK to hand the client a normal Firebase session. Still genuinely passwordless — no password is ever collected or stored, only a short-lived one-time code — so this doesn't reopen the passwordless decision, it just adds a third path to it. Apple Sign-In was considered and explicitly deferred in favor of Microsoft. Passkeys (WebAuthn) remain deferred — **Firebase Auth has no native passkey provider** as of mid-2026, so adding one means either a third-party Firebase Extension layering the WebAuthn ceremony on top, or a fully custom implementation (run the WebAuthn ceremony ourselves, verify it, mint a custom token the same way the OTP path does). Parked as P2 (§11).

**Decision — Firebase Auth is frontend-safe, same pattern as Google Maps (§9).** The frontend SDK talks to Firebase Auth directly for sign-up/login — handling the OAuth handshake — none of that touches our backend. The backend's only job is verifying the resulting ID token on every subsequent request, consistent with the existing "never trust the frontend" principle (§10): verification still happens server-side every time, credential *collection* just isn't our backend's responsibility.

**Decision — profile creation reuses the exact lazy-creation pattern from §2.** Rather than a separate Cloud Function triggered on Auth sign-up (a new component), the `users/{uid}` profile document gets created on the backend's first authenticated request after signup — same "create on first need" shape as movie ingestion in §2, just applied to users instead of movies. No new infrastructure needed.

**Decision — revised optional-onboarding sequence (2026-08-27), replacing an earlier draft that ended on a Watchlist step.** The Watchlist step is dropped entirely — watchlist stays a real feature (§3), just not something onboarding collects; a brand-new user with an empty watchlist isn't a problem worth an onboarding step to solve, unlike watch *history*, which §6's recommendations genuinely need. In its place: a **preferred-languages** step (which regional/language cinema the user watches — Tamil, Korean, English, etc. — not a dubbing preference; keyed to TMDB's `original_language` per movie, §2, so it needs no ZATLAN-owned language taxonomy) and a **celebrities-to-follow** step, both chained off the same signal as the existing genres/watched steps:
- **Genres → Languages → Watched:** the Watched step's candidate movie grid is filtered by the genres and languages just chosen (`GET /onboarding/watched-candidates`), rather than showing the same generic trending grid to everyone — someone who just said "Tamil, not really into Telugu" should see Tamil titles to mark as watched, not a wall of Hollywood blockbusters.
- **Watched → Celebrities to follow:** once the user has marked some real movies watched, their cast/crew become suggested celebrities to follow (`GET /onboarding/celebrity-suggestions`) — a lighter-weight "follow" relationship (schema.md's `followedCelebrities`) than the full celebrity-page feature (still deferred, not designed here), but the relationship itself is real and gives that later feature a running start.
- **Watched → first Home greeting:** the movies marked watched during onboarding also seed which quote gets picked for the very first Home greeting (§6's sibling feature, the movie-dialogue greeting) — a brand-new user's first Home visit is already personalized rather than a random pick from the full quote pool.

**Noted for later:** an optional "pick favorite genres" onboarding step directly improves §6's cold-start fallback — not required for MVP (trending fallback already covers zero-signal users), but cheap and worth doing if there's time, since it makes recommendations better from day one instead of only after enough activity accumulates.

---

## 14. Flow: Moderators / Enforcement

Introduces something genuinely new: every flow so far has been "an authenticated user acts on their *own* data" or "within visibility rules." This is the first flow that's **role-based** — a privileged user acting on *someone else's* content or account.

Splits into two parts.

### 14a. Reporting (any user, straightforward)

```
User clicks "Report" on a message/review/event/user/community/chat room
        ↓
Frontend → Backend
        ↓
Backend verifies Auth token (write path)
        ↓
Backend writes reports/{reportId}
    { reporterId, targetType, targetId, category, reason, status: "pending", createdAt }
        ↓
Return success → Frontend confirms
```

Nothing new architecturally — same write pattern as everything else in §3/§4/§7.

### 14b. Moderator review & enforcement (new: role-based authorization)

```
Moderator opens the report queue
        ↓
Backend verifies Auth token AND verifies the caller actually holds a moderator/admin role
     — a genuinely new kind of check: not "is this the caller's own data" (§3's pattern),
       but "does this account have elevated privileges at all"
        ↓
Backend returns pending reports (scoped to what this moderator is allowed to see)
        ↓
Moderator chooses an action: warning | remove content | temporary restriction | temporary/permanent suspension
        ↓
Backend re-verifies the role server-side before executing — never trusts a frontend claim of "I'm a moderator"
        ↓
Backend executes:
  - warning              → write to users/{targetUid}/moderationLog, notify user
  - remove content       → delete/flag the target content doc
  - restrict/suspend     → write users/{targetUid}.status = "restricted"|"suspended" (+ expiry if temporary)
        ↓
Return success
```

**Superseding decision (added once this was actually built, explicit product direction — not the original plan above):** §14b as sketched is **not built**. Instead of a human moderator role/queue, the AI-assisted moderation from PRD §30.8 executes **autonomously, in the same request as the report** — there is no moderator role, no queue, no human in the loop at all. `POST /reports` (§14a, still accurate) both creates the report AND immediately asks Gemini to classify + decide + apply the outcome, returning the decision to the *reporter* in the same response. This is a deliberate escalation beyond PRD §30.8's original "triage/flagging layer, human still decides" framing — the product decision here is full autonomy.

Practical consequences of this swap:
- No `users/{uid}/moderationLog` subcollection — `reports/{reportId}.decision` (the full Gemini output: category, actions taken, confidence, rationale) already serves as the audit trail, one place instead of scattered per-user logs.
- The reporter-supplied `category` from §14a's original report doc is dropped — Gemini determines the actual category itself from the content, a free-text `reason` from the reporter is enough context.
- Every action stays reversible/soft per this project's general policy: content removal is a soft `deleted:true` (never hard-deleted), restrictions/temporary suspensions get a real `statusExpiresAt` (only a permanent suspension, reserved for severe categories like grooming, leaves it `null`).
- When Gemini isn't configured (`GEMINI_API_KEY` unset), the report still gets created but stays `"pending"` forever — there's deliberately no human fallback queue to route it to instead.
- See `backend/src/lib/gemini.ts` for the exact prompt (faithful to PRD §30.2's prohibited-behavior list and §30.8's "legitimate movie discussion vs. real violation" distinction) and `backend/src/services/reports.service.ts` for the full decision-application logic. api-contracts.md §12 has the exact request/response shape.

**Follow-up decision — capping low-confidence decisions (raised by live-testing question "what happens when AI confidence is very low?"):** full autonomy with no human in the loop means a low-confidence Gemini call would otherwise execute with exactly as much force as a high-confidence one — including suspending an account on a guess. Below a `confidence` of 0.7, `accountAction` is capped down to `"warn"` (never `restrict`/`suspend_temporary`/`suspend_permanent`) before being applied; `contentAction` is intentionally left uncapped since removal is already reversible/low-stakes. Every such decision also gets `flaggedForReview: true` so it's still surfaceable to a human even though no moderator role exists to page. Given the explicit "AI moderators instead of humans" decision above, this is scoped honestly rather than half-building §14b back in: no new `/moderation/*`-style endpoint was added (that would expose every user's report reasons/rationale to any signed-in caller with no role system to gate it). "Flagged" today means: `reports/{reportId}.flaggedForReview` is queryable directly in the Firestore console, and the server emits a `logger.warn(...)` line, visible in Cloud Run/local logs. `reports/{reportId}.decision` keeps storing Gemini's raw, uncapped suggestion (audit trail); a separate `appliedAccountAction` field records what was actually executed after capping. See `capLowConfidenceDecision()` in `backend/src/services/reports.service.ts`; schema.md §5 has the field list.

**Decision — role lives in Firebase custom claims, not a Firestore field.** Firebase Auth supports attaching custom claims (like a role) directly to a user's ID token/JWT. The backend reads the role straight off the already-verified token — no extra Firestore lookup needed on every privileged check, unlike a `users/{uid}.role` field, which would cost a read every time.

**Decision — scope to platform-level moderation only for now, defer community-moderator delegation.** PRD §30 describes two tiers: platform-level enforcement (warnings, suspensions — clearly needs a global admin role) and *community moderators* scoped to a specific community/forum. The latter ties directly to the Forums/Communities feature, which the PRD already marks as P2/deferred (§22) — building a granular per-community moderator-delegation system now would be designing privilege scoping for a feature that isn't being built yet. Event hosts already have a lightweight, scoped form of moderation for their own event (approve/deny join requests, §7) — that already covers "who moderates a single watch event" without needing this broader role system. Full community-moderator delegation stays parked until Forums moves off P2.

### 14c. Assigning the moderator/admin role itself

```
Bootstrapping the very first admin(s)
        ↓
Manual, out-of-band — a one-off script or Firebase Console action, run directly by the ZATLAN team
        ↓
(not an in-app flow — cannot be, by construction: see decision below)

Promoting anyone after that
        ↓
Existing admin selects a user, chooses a role to grant
        ↓
Frontend → Backend
        ↓
Backend verifies Auth token AND verifies the CALLER already holds admin role (their own custom claim)
        ↓
Backend calls Firebase Admin SDK: setCustomUserClaims(targetUid, { role })
        ↓
Return success
```

**Decision — first admin is seeded manually; everyone after that is promoted in-app by an existing admin.** Custom claims can only be set via the Firebase Admin SDK, which requires privileged backend/GCP access — no user, including an admin acting through the app UI, can grant a role through a normal request without *something* already having that access first. This first-admin bootstrap problem is universal to any role-based system, so it's solved outside the app rather than designed around. Once at least one admin exists, promotion reuses the exact "backend re-verifies the caller's own privilege before executing" pattern from §14b — applied to granting roles instead of enforcement actions. No new mechanism needed.

---

## 15. Flow: Watch Party — Presence ("who's live")

Investigated first whether real Teleparty-style playback sync (play/pause/seek across everyone's own streaming platform) was achievable via official partnership, given ZATLAN may become a paid platform. **Resolved: not feasible, and not a money problem.** Netflix, Prime Video, and JioHotstar have no public API for third-party remote playback control — their partner SDKs exist for a different purpose (device manufacturers embedding the streaming app on hardware, not external apps controlling an existing session), DRM license terms actively restrict this kind of external control, and it works against their competitive incentives (none of them wants a cross-platform "watch party" layer sitting on top of their own experience). The strongest evidence: Teleparty, Scener, and Metastream — the actual companies doing this today — all rely on unofficial browser extensions rather than official APIs, at any funding level. If this is pursued later, the only proven path is the same one they use: **a browser extension, planned as its own separate future project**, not a phase of the current backend — noted in §11.

For now, scope is **presence only** — no playback control, no synchronization, just live "who's currently here."

```
User opens an event's chat room
        ↓
Frontend connects to Firebase Realtime Database directly — frontend-safe, same pattern as
        Firebase Auth (§13) and Google Maps (§9): the credential/connection itself isn't secret,
        the backend still owns anything privileged
        ↓
Frontend writes presence/{eventId}/{uid} = { online: true, joinedAt }
        ↓
RTDB's onDisconnect() hook auto-marks the user offline the instant their connection drops —
        network loss, tab closed, app killed — no backend polling or heartbeat needed
        ↓
Other participants subscribe to presence/{eventId} in real-time
        ↓
UI shows "X people watching now"
```

**Decision — Firebase Realtime Database, not Firestore, for presence.** Firestore has no built-in disconnect detection; RTDB's `onDisconnect()` is Firebase's own documented pattern specifically for this, even in apps (like ZATLAN) that use Firestore for everything else. Small, low-overhead addition to the same Firebase project — not a new vendor.

---

## 16. Flow: Event Chat Rooms

Resolves the "real-time layer for chat" question parked all the way back in §1/§11.

**Decision — Firestore listeners (`onSnapshot`), not a WebSocket layer.** Firestore has a built-in subscription feature: the frontend subscribes directly to a document/collection, and Firestore itself pushes updates to every subscribed client automatically whenever the data changes — no polling, no custom server, nothing new to build or operate. A WebSocket layer would mean ZATLAN's own backend holding a persistent connection per client and manually relaying messages — real infrastructure, in exchange for control ZATLAN doesn't need here. Chat is the textbook case Firestore listeners were built for, so no new component is needed — just a Firestore capability not yet used elsewhere in this HLD.

**Revised decision — one room per Event, not per Movie, and ephemeral by default.** Superseded the original "shared room per movie" design. Modeled as its own entity, `Room`, distinct from `Event` (not folded into it) because a room can outlive the event that created it (see persistence, below) and later become associated with more than one event — a genuine one-to-many over time, not a fixed 1:1.

```
rooms/{roomId} { type: "ephemeral" | "persistent", originEventId, memberIds[], createdAt }
rooms/{roomId}/messages/{messageId} { authorId, text, createdAt }
events/{eventId}.roomId → the room this event's chat happens in
```

**Lifecycle — ephemeral rooms (default), same shape as a Google Meet call's chat:**

```
Event starts, first participant joins
        ↓
Room becomes active (backend creates rooms/{roomId} lazily on first join —
        same "create on first need" pattern as movie ingestion §2, user profile §13)
        ↓
Participants chat while the room has anyone present (tracked via §15's presence, reused directly —
        no separate "is this room active" state needed)
        ↓
Presence for this room hits zero
        ↓
Grace-period timer starts (a few minutes) — avoids deleting a live conversation over a
        momentary mass-disconnect (network blip, everyone's video call drops for a second)
        ↓
Timer expires, presence still zero → room + its messages are deleted
        ↓
EXCEPT: any message that was reported (§14a) before deletion is preserved —
        soft-deleted per §21, kept specifically for moderator review, everything
        else in the room is gone. Otherwise a bad actor could say something
        abusive and just wait out the room closing to dodge any consequence.
```

**New mechanism — the grace-period timer needs something HLD hasn't used yet:** a delayed check, not an instant reaction. A Cloud Function reacts to presence (§15, RTDB) hitting zero for a room and schedules a Cloud Task (or equivalent delayed job) to re-check presence after the grace period and delete if still empty. Worth naming as new infrastructure, same way FCM (§17) and Vertex AI Search (§18) were flagged as new components when they first appeared.

**Decision — persistence toggle: host only, settable anytime (not just at event creation).** The host can flip a room from ephemeral to `persistent` at any point — before, during, or after the event — not a decision forced upfront. A persistent room never runs the deletion timer above; it becomes a standing group chat for its members, independent of any single event's lifecycle (Teams-style, per your framing).

**Decision — a persistent room can spawn new events.** From a persistent room, the host or any member can create a new Event (§7's Create Event flow, unchanged) with the room's current `memberIds` pre-filled as invitees. The new event links back to the *same* `roomId` rather than getting a fresh room — this is the mechanism by which one room ends up associated with multiple events over time.

```
Send a message
        ↓
Frontend → Backend
        ↓
Backend verifies Auth token, verifies the caller is a member of this room (event participant,
        or persistent-room member), verifies the caller's account isn't restricted/suspended
        (reuses §14b's moderation state)
        ↓
Backend writes rooms/{roomId}/messages/{messageId} { authorId, text, createdAt }
```

```
Receive messages (real-time)
        ↓
Frontend subscribes directly to Firestore: rooms/{roomId}/messages (onSnapshot)
        ↓
Firestore pushes new messages to every subscribed client automatically — no backend involved in delivery
```

**Decision — writes still go through the backend, but reads now bypass it entirely.** This is the first flow in this HLD where the frontend talks straight to Firestore for the read path, since that's the whole point of `onSnapshot`. That means the usual "backend re-validates every read" principle (§10) can't apply here — there's no backend in the read path. Enforcement instead lives in **Firestore Security Rules**, Firestore's own declarative access-control layer evaluated by Firestore itself, not backend code: reads restricted to the room's own `memberIds`, writes restricted to the backend's own service account only (forcing every write through the validated backend path above). New mechanism, worth naming — the first place authorization lives outside the backend.

**Not a coincidence:** messages use Firestore listeners, presence (§15) uses Realtime Database — two different real-time needs, two different Firebase tools, matching Firebase's own recommended split rather than forcing one tool to do both jobs.

Reporting a message or the room itself reuses §14a unchanged — no new design needed, beyond the "reported messages survive ephemeral deletion" carve-out above.

**Not yet decided — flagged, not blocking:** whether a persistent room's `memberIds` can be managed directly (add/remove someone from the standing chat without going through an event), independent of any event's participant list. Default assumption for now: membership only grows via "schedule a new event from this room," nothing more granular yet.

**Implementation note (added once this was actually built):** message send/edit/soft-delete, room promotion, and "schedule event from room" are real (`backend/src/services/rooms.service.ts`, api-contracts.md §9); the frontend subscribes via `onSnapshot` exactly as designed above (`frontend/src/features/chat/services/roomApi.ts`'s `subscribeToMessages`), governed by the `firestore.rules` already staged for this. "Member of this room" resolved to **`rooms/{roomId}.memberIds` as the single source of truth for both read (rules) and write (backend) access** — not the "event participant OR persistent-room member" phrasing in the flow above — because the Security Rules only check `memberIds`, so anything else would let a caller pass the backend's write check while failing the rules' read check. `events.service.ts`'s join/leave/approve paths now keep `memberIds` transactionally in sync with event participation so this holds. Two things explicitly **not** built: the grace-period deletion timer for ephemeral rooms (needs a Cloud Function + delayed job, real new infra this project doesn't have yet — rooms and their messages just accumulate for now, never auto-deleted) and moderator-delete (`DELETE .../messages/:messageId` is author-only; a `deleted:true` soft delete lands regardless, per §21, but "or moderator" depends on §14's role system, which isn't built).

---

## 17. Flow: Notifications

Cross-cutting — not a single trigger, but an addition to several existing flows.

```
Some event happens (e.g. B receives a follow request from A, per §4)
        ↓
Backend, as part of that SAME request, additionally writes:
    users/{B}/notifications/{id} { type, fromUserId, read: false, createdAt }
        ↓
Delivery — three independent channels, in parallel:
  - In-app feed: frontend subscribes to users/{uid}/notifications via Firestore onSnapshot
                 → same pattern as §16's chat listener, applied to notifications instead of
                    messages. No new mechanism.
  - Push: backend checks B's stored FCM device token(s), calls Firebase Cloud Messaging
                 → new component (FCM); device-token registration needs adding to
                    onboarding (§13) or settings
  - Email: only if users/{B}.notificationPrefs.emailEnabled != false
                 → e.g. via Firebase's "Trigger Email" extension (write to a mail-queue
                    collection, the extension sends it) — same "write to Firestore, let a
                    Firebase-native mechanism handle the side effect" style as movie
                    ingestion (§2)
```

**Decision — confirmed triggers (more to be added as they come up):** follow requests (§4), event join requests/approvals (§7), moderator actions taken against you (§14b).

**Decision — delivery channels:** push, in-app feed, and email, all three. Email has a per-user opt-out (`notificationPrefs.emailEnabled`); push/in-app could get the same treatment later if needed, not required now.

**Decision — in-app feed costs nothing new**, reusing §16's Firestore-listener pattern exactly. Push is the only genuinely new component (FCM).

---

## 18. Flow: Search (movie discovery)

Corrects a gap surfaced during design: §2's on-demand ingestion only pulls a movie into Firestore once someone already knows about it and opens its page — but if search only looked at what's already in Firestore, nothing new could ever be *found* in the first place. That's circular, and it means even popular, obvious titles could trigger a live TMDB call during search simply because nobody had searched for them yet — not acceptable, since search must never depend on TMDB live.

**Decision — search-index population is bulk/scheduled, fully decoupled from §2's per-user, per-movie detail ingestion.** A batch job (not triggered by any individual search) pulls a broad slice of TMDB's catalog and indexes it upfront and on a recurring schedule. Search then always hits ZATLAN's own pre-populated index — never TMDB, live, ever. §2 still exists, but now does only what it was always meant for: fetching the *full* detail record (synopsis, cast, streaming providers, IMDb rating at ingestion time) once a specific movie is actually opened — discoverability and full-detail-caching are two separate concerns, not one conflated flow.

```
User types a search query
        ↓
Frontend → Backend
        ↓
Backend queries the search index (typo-tolerant, fast)
        ↓
Return matching movies (title, poster, year — enough for a results list)
        ↓
User selects a result → triggers §2's detail-ingestion flow for that specific movie
```

**Decision — Vertex AI Search (Media vertical) as the primary search index**, not Algolia/Typesense/Meilisearch. None of those three are Google products (Algolia: independent SaaS company; Typesense/Meilisearch: independent open-source projects/companies) — running on GCP infrastructure via a marketplace listing isn't the same as being a Google product. Vertex AI Search is a genuine Google Cloud product built for exactly this (fast, typo-tolerant search over your own data), with a Media vertical specifically aimed at content-catalog search. Given ZATLAN's Google-first mandate ("Google product unless no equivalent exists"), this is the correct first candidate — a Google equivalent exists, so reaching for a non-Google search service isn't justified.

**Caveat, not yet verified:** exact current Vertex AI Search pricing (typically per query volume and/or data indexed; enterprise-tier search products have sometimes carried minimum commitments beyond simple pay-as-you-go) hasn't been confirmed. $300 in available GCP credit removes cost as a blocker for *testing* this, but should be treated as "enough to find out," not a guarantee it comfortably covers the whole prototype — worth checking the pricing calculator or provisioning a small test index before fully committing.

**Fallback if Vertex AI Search proves too costly/complex for the remaining timeline: Firestore word-prefix indexing.** Same bulk-seeding idea, stored directly in Firestore's `movies` collection instead of a dedicated search product — each title indexed as an array of word-level prefixes (e.g. "Avengers" → `["a","av","ave",...,"avengers"]`), queried via `array-contains`. Weaker typo tolerance than a real search engine, but genuinely free and needs zero new products — still fully Google-native since it's just Firestore.

**Implementation note (superseded — an earlier version of this note said search was still fully live; it now genuinely follows this section's own "batch-populate, serve from Firestore, never depend on TMDB live" design):** neither Vertex AI Search nor a real search product was built (that decision stands — a real dollar/setup cost for a hackathon-scale prototype wasn't worth it, see the PM discussion this was scoped from), but the Firestore fallback this section named *was*, and it's the live path today, not a fallback in name only:

- **Index-time, not query-time.** Every movie's `titleSearchTerms` field (`backend/src/lib/searchIndex.ts`) is computed once, whenever that movie is written to Firestore — on detail-view ingestion (§2), on a search result getting upserted (below), or by the bulk-seed scripts — never recomputed per search. It unions every title word's real prefixes with its single-typo variants (a missing letter, a wrong letter, or two adjacent letters swapped — insertions deliberately excluded, ~26x more variants per word for comparatively less real-world payoff), so one Firestore `array-contains-any` query catches both exact/prefix queries and common misspellings in one read.
- **Bulk seeding**, both scripts run manually for now (same shortcut as §5b's `computeTasteMatches.ts` — a real Cloud Scheduler job is the eventual upgrade once there's traffic to justify it): `scripts/seedSearchCatalog.ts` pulls TMDB's popular-movies list (paginated, ~500 titles by default) for broad day-one coverage; `scripts/refreshRecentMovies.ts` (§9/api-contracts.md §1's `GET /movies/recent`) does double duty — it also indexes each now-playing title so recent releases are searchable immediately, not just listed.
- **Three-tier fallback, cheapest first, each tier only runs if the one before found nothing:** (1) the indexed `titleSearchTerms` lookup; (2) a bounded real-time scan of the local catalog scored the same way (catches deeper typos the precomputed variants didn't cover — Damerau-Levenshtein, so an adjacent-letter swap counts as one edit, not two); (3) live TMDB, only when the local catalog has nothing close — and *that* result gets written back into Firestore (lightweight: title/poster/year/titleSearchTerms, not a full detail-ingestion), so the same query resolves locally next time instead of hitting TMDB again.
- **Relevance-first ranking** (`backend/src/lib/searchRanking.ts`) — every candidate gets classified into a match-type tier (exact > alias > prefix > token > single-typo > deeper-fuzzy) and scored within that tier from several signals (how much of the query matched, how much of the title the query accounts for, fuzzy closeness, a small popularity tie-break). The tiers are spaced far enough apart that no combination of the smaller signals can ever let a weaker tier outrank a stronger one — a fuzzy match can never beat an exact or prefix match, and popularity can never override a clearly stronger textual match, regardless of the size of the gap. Internal scores are never returned to the client, only the ranked order.
- **Two signals this is explicitly built to support but doesn't use yet:** alias/alternate-title matching (TMDB's `alternative_titles` isn't fetched anywhere — `rankCandidate`'s `aliases` input just stays empty for every real candidate today) and semantic/natural-language matching (no embedding infrastructure exists). Both are real gaps, not silently dropped — `searchRanking.ts` accepts them as inputs specifically so wiring either one in later doesn't mean a ranking rewrite.

See `backend/test/searchRanking.test.ts` for the worked examples this was built against (e.g. "dark knight" ranking *The Dark Knight* above a far more popular but textually unrelated *Batman*).

**Implementation note (redesigned 2026-08-31 — the three-tier cascade above is retired, tiers 1+3 merged instead of chained):** using search in practice surfaced two real gaps in the cascade design:

- **Completeness, not just quality.** "Local index found *something*" was the only signal deciding whether tier 3 (live TMDB) ever ran — not "local index found the *right* thing," and not "local index found *everything* relevant." A same-titled remake/reboot (e.g. *Dune* 1984 vs. 2021) that only had one version locally indexed could mask the other one forever: once a confident local match existed, the cascade never asked TMDB again for that query, so a sibling title TMDB knows about but the local catalog doesn't would never surface.
- **Tier 3 never actually got ranked.** The old tier 3 returned TMDB's raw results in TMDB's own order — it never ran through `rankCandidate` at all, only tiers 1/2 (the Firestore-backed tiers) did. The good ordering this produced in practice (e.g. *Dune* 2021 before 1984) was TMDB's own relevance, not this system's ranking — and once those results got upserted into the local index as lightweight docs (no `voteCount` yet, only present after a full detail-fetch), a *second* search for the same query would rank same-titled duplicates as an exact tie, falling back to Firestore's arbitrary document order — not popularity at all.

**Fix — merge, don't cascade.** The local index and live TMDB are now queried together on *every* search (`Promise.all`, not sequential), combined into one candidate pool, deduplicated by `movieId` (TMDB's fresher data wins when both sides return the same movie), and scored as one set through the same `rankCandidate` pass — so ranking is real for TMDB-sourced candidates too, not just locally-cached ones. TMDB's own search results now carry `voteCount` (`backend/src/lib/tmdb.ts`'s `TmdbSearchResult`) specifically so this shared ranking has a real popularity signal to tie-break with. A TMDB failure degrades to local-only results rather than failing the search outright, as long as the local index has something to offer.

**Tier 2 (the real-time Levenshtein scan over up to 2000 local docs, run only when tier 1 found nothing) is dropped, not replaced.** It existed to squeeze extra value from the local catalog before giving up and asking TMDB — now that TMDB is asked unconditionally, that job is redundant, and its cost would otherwise run on every search rather than only a rare all-local-misses case. `backend/src/lib/levenshtein.ts` and its own unit tests are untouched (still used by `searchRanking.ts`'s fuzzy-match tiers), just no longer exercised via a dedicated broad-scan tier.

See `backend/test/movies.test.ts`'s `GET /search/movies` describe block for the current behavior (merged results, dedup-prefers-TMDB, graceful TMDB-failure degradation, ranking dominance still enforced across the merged pool).

**Browse-by-facet (added alongside the Search page rebuild — `GET /discover/movies`, api-contracts.md §1):** text search answers "find the movie I'm thinking of"; it deliberately does *not* answer "show me every Korean film" — a query like `korean` or `horror` matches only titles containing that literal word. `GET /discover/movies?genre=&language=` fills that gap: it's TMDB's own `/discover/movie` (the same paginated endpoint onboarding's genre/language candidate paging already leans on, `tmdb.ts`'s `discoverMovies`) exposed as a public browse listing, popularity-ordered, no text ranking involved. The frontend (`MovieSearch.tsx` + `genreLanguageMatch.ts`) recognizes when a typed query *names* a genre or language and offers a "Browse Korean films" chip that switches the results area over to this listing; it's an explicit opt-in, not mixed into text-search results. Discovered movies are run through the same `upsertSearchable` lightweight-doc write as a live search's TMDB results, so opening one doesn't cold-fetch. The genre/language taxonomy is now a third hand-maintained copy (`frontend/src/lib/catalog.ts`, `backend/src/services/movies.service.ts`, `tmdb.ts`'s `GENRE_NAME_TO_ID`) — same "hardcoded, practically never changes" tradeoff §18's ranking notes already accept.

## 19. Flow: Block / Mute

Two related but different things:

- **Block:** severe, symmetric in effect. If A blocks B, *neither* can see or interact with the other — even though only A initiated it. Deliberately the opposite of follow (follow's effects are one-directional by design; block's effects are two-directional by design, even though the *action* is one person's choice).
- **Mute:** lighter, asymmetric. "Hide their content from my view" only — B is unaffected, doesn't know, can still see/interact with A normally.

```
User A blocks User B
        ↓
Backend writes users/{A}/blocked/{B}
        ↓
Backend also severs any existing follow relationship, both directions
        ↓
Return success
```

**Decision — block becomes a new cross-cutting check**, not a one-off flow — applied wherever visibility/interaction is already checked: §5a excludes blocked users in both directions; §16 filters a blocked user's messages from your own client view in shared event/room chats. Other surfaces (e.g. §7 events) apply the same general check without needing individual flow-by-flow redesign.

**Decision — mute uses the identical mechanism** (`users/{uid}/muted/{mutedUid}`) but only ever affects the muter's own view — no severance of any relationship, no bidirectional effect.

---

## 20. Flow: Submit / Edit / Delete a Rating & Review

**Decision — one review per movie per user, enforced structurally.** The review doc is keyed by the author's own ID, not a random review ID: `movies/{movieId}/reviews/{authorId}`, not `movies/{movieId}/reviews/{reviewId}`. A user physically can't have two documents at the same path, so this gets "one per movie" for free — and it means submit and edit collapse into the **same operation**: writing to that path either creates it (first time) or overwrites it (editing), no separate create-vs-update logic, no "find my existing review" query — the path is deterministic from the caller's own ID.

**Decision — the aggregate update needs a transaction, not a blind increment.** A first-time review should add to both `sum` and `count`; an edit should only adjust `sum` by the *difference* between old and new rating, leaving `count` unchanged. A naive "always add the new rating" would silently inflate the average every time someone edits their score. So the write reads the existing review first (if any), computes the correct delta, and writes both the review and the adjusted aggregate together, atomically.

```
Submit or edit a rating/review (same operation)
        ↓
Backend verifies Auth token, verifies the movie exists (§2), verifies the caller's account
        isn't restricted/suspended (§14b's moderation state)
        ↓
Firestore transaction:
    - read movies/{movieId}/reviews/{callerUid} (may or may not exist)
    - first time  → sum += rating, count += 1
    - editing     → sum += (newRating − oldRating), count unchanged
    - write movies/{movieId}/reviews/{callerUid} { rating, reviewText?, isAnonymous, updatedAt }
    - write adjusted sum/count to movies/{movieId}
```

```
Delete a rating/review
        ↓
Backend verifies caller owns movies/{movieId}/reviews/{callerUid} — trivial, the doc ID is
        the caller's own uid, no ownership lookup needed
        ↓
Firestore transaction: read existing rating → sum -= rating, count -= 1 → soft-delete (§21)
```

Anonymity (§11) is just one field on this same document, exactly as originally planned. The displayed ZATLAN average (§16.3 in the PRD) is always just `sum / count` — cheap to read regardless of review count.

**Implementation note (added once this was actually built):** submit/edit/delete/list are real (`backend/src/routes/reviews.ts`). Resubmitting after a soft-delete is treated as first-time again (count increments), not an edit — a deleted review contributed nothing to the aggregate, so bringing it back is a fresh contribution. Anonymous reviews are redacted server-side in the public list (`authorId`/`displayName: null`) rather than left to the client, tightening the original api-contracts.md §3 sketch which said "withheld client-side." §22's moderation strikes/bans and disputes are deferred — they depend on the moderator-role system (§14), which doesn't exist yet; the account-restriction check this flow calls for above (§14b's `status` field) is real and already enforced, since that field already existed from onboarding.

---

## 21. Flow: Edit / Delete — general pattern for other content

Applies to content that *doesn't* have §20's "one per movie per user" constraint — chat messages, events, and similar: reviews use the deterministic-ID trick above; everything else uses an ownership field checked against the caller.

```
User edits or deletes their own content (message, event, etc.)
        ↓
Backend verifies Auth token, verifies the caller is the content's own author — reuses the
        same ownership-check pattern as watchlist/event-host checks
        ↓
Edit:   update fields + set editedAt (so the UI can show "(edited)")
Delete: see decision below
```

**Decision — delete is author-initiated OR moderator-initiated, same mechanism, different authorization check.** §14b already defined "remove content" as a moderator enforcement action — rather than a second separate deletion path, moderator-delete and self-delete hit the same backend logic, gated by *either* "caller is the author" *or* "caller holds the moderator role" (§14's custom-claims check).

**Decision — soft delete, not hard delete, as the general policy — not just for reviews.** A `deleted: true` flag (content hidden from normal display/queries, doc stays in Firestore) rather than actually removing the document. Reasoning generalizes beyond reviews: per PRD §30's moderation/audit requirements, a repeat offender's removed content needs to still be reviewable after takedown — a hard delete would make that impossible. Applies uniformly to reviews (§20), messages (§16), and events (§7).

**Implementation note (events, added once this was actually built):** `DELETE /events/:eventId` follows this pattern with the "author OR moderator" decision above simplified to "author (host) only" — same reason room-message delete stayed author-only: §14's role system was never built (superseded by full-autonomy AI moderation, §14). Soft delete only; `GET /events/upcoming`, `GET /events/nearby`, `GET /events/:eventId`, and `PUT /events/:eventId/join` all now treat a deleted event as gone. `PATCH /events/:eventId` (edit) is still not built. See api-contracts.md §8 and `backend/src/services/events.service.ts`.

---

## 22. Flow: Review Moderation Strikes & Movie-Specific Ban

New enforcement mechanism, distinct from §14b's account-wide `restricted`/`suspended` — this one is scoped to **one user, one movie**, not the whole account.

**Rule:** a user may repost a review for a movie after a moderator removes it, up to 2 more times. If a moderator removes it a 3rd time for that same movie, the user is banned from posting a review for *that specific movie* for 30 days. Any removal counts toward the strike total, regardless of whether the resubmitted content differs from what was removed.

```
Moderator removes a review (§14b enforcement action, applied here)
        ↓
Backend verifies moderator role (§14)
        ↓
Firestore transaction:
    - soft-delete the review (§21) — deleted: true
    - increment movies/{movieId}/reviews/{authorId}.modRemovalCount
    - reverse the review's contribution to the movie's aggregate rating (§20) — a removed
      review shouldn't count toward the displayed ZATLAN average
        ↓
If modRemovalCount reaches 3 → write users/{authorId}/reviewBans/{movieId} = { bannedUntil: now + 30 days }
```

```
User submits/edits a review for a movie — §20's flow, gains one more check up front
        ↓
Backend checks users/{authorId}/reviewBans/{movieId}:
    - exists, bannedUntil > now  → reject, tell them when the ban lifts
    - exists, bannedUntil <= now → ban has lapsed: proceed, AND reset modRemovalCount to 0
      as part of this same write — a lazy, on-demand reset rather than a scheduled job,
      consistent with how "reset/refresh" is handled everywhere else in this HLD (movie
      ingestion in §2, presence in §15, etc.)
    - doesn't exist               → proceed normally
```

**Decision — dispute path, resolved by an admin, not any moderator.**

```
User disputes a removal of their own review
        ↓
Backend verifies caller is the review's own author
        ↓
Backend writes moderationDisputes/{disputeId} { reviewRef, authorId, moderatorId, status: pending }
        ↓
An ADMIN reviews it (not just any moderator)
        ↓
Uphold   → nothing changes, removal and strike stand
Overturn → un-soft-delete the review, decrement modRemovalCount, restore its contribution
           to the movie's aggregate rating, and reverse any ban that was issued because
           of this specific strike
```

Letting the same privilege tier that removed the content also review whether the removal was fair has an obvious conflict-of-interest problem — the reviewer needs to sit at a higher/separate level of authority than whoever took the original action.
