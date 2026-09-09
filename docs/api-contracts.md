# ZATLAN — API Contracts

Endpoint-level request/response shapes for every flow in [hld.md](hld.md), built on top of [data-model.md](data-model.md) and [schema.md](schema.md). Last stage of the HLD → conceptual model → concrete schema → API contracts sequence.

## Conventions (decided here, not elsewhere — flag if you want these different)

- **Style:** resource-oriented REST, `/api/v1` prefix implied throughout (omitted below for brevity).
- **Auth:** `Authorization: Bearer <Firebase ID token>` on every endpoint marked 🔒. Unmarked endpoints are public reads (§10 — auth only required for writes and user-specific reads).
- **`me`:** any path with `/users/me/...` resolves to the caller's own uid from the verified token — never a client-supplied ID, consistent with §10's "never trust the frontend" principle.
- **Errors:** a single envelope everywhere — `{ "error": { "code": string, "message": string } }` with a matching HTTP status (400 validation, 401 no/bad token, 403 authenticated but not permitted, 404 not found, 409 conflict). Not repeated per endpoint below.
- **Pagination:** cursor-based (`?cursor=<opaque>&limit=<n>`), matching Firestore's own `startAfter` model rather than offset-based paging — response includes `nextCursor: string | null`.
- **Timestamps:** ISO 8601 strings over the wire; stored as Firestore `timestamp` per schema.md.
- **Types:** every response shape documented below has a matching TypeScript interface in `packages/shared-types` (`@zatlan/shared-types`, a pnpm workspace package) — both `backend/src/routes/*.ts` and `frontend/src/lib/api.ts` import from it rather than declaring their own copies, so the two sides can't silently drift apart.

---

## 1. Movies (§2, §8)

```
GET /movies/:movieId
→ 200 { movieId, title, year, runtime, genres[], synopsis, poster, cast[], crew[],
        voteAverage, voteCount, trailerKey, zatlanRating: {sum, count}, likeCount,
        streamingProviders[], isAdult }
```
Triggers the cache → Firestore → TMDB fallback chain server-side (§2); streaming providers refresh on their own TTL (§8) but are returned as part of the same response, not a separate call.

**Implementation note (added once this was actually built):** `zatlanRating`/`likeCount` are normalized in the response to `{sum:0,count:0}`/`0` when absent from storage (a movie nobody's rated or liked yet has no reason to have those fields actually written) — the client never has to special-case "missing" vs. "zero". `isAdult` from the original sketch above isn't currently returned (it's fetched from TMDB and stored, just not surfaced in the response yet — no feature depends on it client-side).

```
GET /movies/recent   → 200 { items: [{ movieId, title, poster, year }] }
```
Powers the public Discover page's default "recently released" section — the browse-without-a-query view shown below the search bar. TMDB's `now_playing` list (theatrical releases currently in cinemas), region-scoped to the same hardcoded India region as §8's streaming availability. Unauthenticated, same as `GET /search/movies`. 502 `TMDB_UPSTREAM_ERROR` on failure, matching search's own error shape.

```
GET /discover/movies?genre=:name&language=:code&page=:n
→ 200 { items: [{ movieId, title, poster, year }], page, totalPages }
```
Browse-by-facet listing (added for the Search page's "Browse Korean films" / "Browse Horror movies" chip) — distinct from `GET /search/movies` in §7, which is text-relevance ranked; this is "every movie in this genre and/or original language, popularity-ordered." At least one of `genre` (a TMDB genre name, e.g. `Horror`) or `language` (ISO 639-1, e.g. `ko`) is required — 400 `MISSING_FILTER` if neither is a recognized value. `page` is 1-based and passed straight through to TMDB's own `/discover/movie` paging (`totalPages` bounds the frontend's "load more"; both capped at TMDB's page-500 limit). Unauthenticated, same as search. Every page's results are upserted into the local search index (`titleSearchTerms`) so a tapped card opens from Firestore rather than a cold TMDB fetch. 502 `TMDB_UPSTREAM_ERROR` on upstream failure.

**Implementation note (caching, added once this was actually built):** reads `discover/recentMovies` (schema.md §1) instead of hitting TMDB live on every request — refreshed periodically by `backend/scripts/refreshRecentMovies.ts` (`pnpm --filter zatlan-backend run refresh-recent-movies`), run manually for now rather than on a real Cloud Scheduler trigger, same shortcut hld.md §5b already uses for taste matches. Falls back to a live TMDB call when the cache doc doesn't exist yet (before the script has ever run) or Firestore isn't configured, so the endpoint still works either way. The same script also indexes each recent title for §7's search (`titleSearchTerms`), so a just-released movie is searchable immediately, not only listed here.

## 2. Watchlist & Watched (§3, §5a) 🔒

```
PUT    /users/me/watchlist/:movieId        → 204
DELETE /users/me/watchlist/:movieId        → 204
GET    /users/me/watchlist                 → 200 { items: [{ movieId, addedAt }], nextCursor }

PUT    /users/me/watched/:movieId          body: { watchedAt?, visibility? } → 204
DELETE /users/me/watched/:movieId          → 204
GET    /users/me/watched                   → 200 { items: [{ movieId, watchedAt, visibility }], nextCursor }
PATCH  /users/me/watched/:movieId          body: { visibility } → 204   // per-entry override, §5a

PUT    /users/me/likes/:movieId            → 204   // toggle on; movies.likeCount += 1 (idempotent — no-op if already liked)
DELETE /users/me/likes/:movieId            → 204   // toggle off; movies.likeCount -= 1
```
`PUT` (not `POST`) since the doc ID is deterministic (`movieId`) — writing is idempotent, matching schema.md's ID strategy.

## 3. Reviews & review bans (§20, §22)

```
GET  /movies/:movieId/reviews              query: { cursor?, limit? } → 200 { items: [{ authorId, displayName, rating,
                                                     reviewText, isAnonymous, createdAt, updatedAt }], nextCursor }
                                              // excludes deleted:true; authorId/displayName are null — SERVER-SIDE,
                                              // not client-side — when isAnonymous is true

PUT  /movies/:movieId/reviews/me  🔒        body: { rating (integer 1-5), reviewText?, isAnonymous } →
                                              200 { rating, reviewText, isAnonymous, createdAt, updatedAt }
                                              // submit or edit — same operation, §20. 400 INVALID_RATING /
                                              // INVALID_BODY on bad input, 404 if the movie doesn't exist,
                                              // 403 ACCOUNT_RESTRICTED if the caller's account isn't active
DELETE /movies/:movieId/reviews/me 🔒       → 204   // 404 REVIEW_NOT_FOUND if there's nothing to delete

GET  /users/me/movies/:movieId 🔒           → 200 { watchlisted, watched, liked, review: MyReview | null }
                                              // NOT in the original sketch above — added so Movie Detail's action
                                              // bar and "write vs. edit review" can render in one request instead
                                              // of four (backend/src/routes/userMovies.ts)

GET  /users/me/movies/status?ids=a,b,c 🔒   → 200 { items: { [movieId]: { watchlisted, watched, liked } } }
                                              // batch form of the above (no review payload) — one request for a
                                              // whole result set (search cards, the discover grid) instead of one
                                              // per card. ids deduped, capped at 60/request; an id with no
                                              // relationship is still present in the map, all-false.

POST /movies/:movieId/reviews/:authorId/dispute 🔒
                                              body: { reason } → 201 { disputeId, status: "pending" }
                                              // caller must be :authorId (§22) — not yet implemented, depends on
                                              // the moderator-role system (§14)
```

**Implementation note (added once this was actually built):** the 403 ReviewBan check from the original sketch, and the whole §22 strike/ban/dispute system, are deferred — they depend on the moderator-role system (§14), which doesn't exist yet. What's real: submit/edit/delete/list, the account-restricted check (§14b's `status` field, already real), and the anonymous-redaction fix noted above.

## 4. Follow / Block / Mute (§4, §19) 🔒

```
PUT    /users/:uid/follow                  → 200 { status: "following" | "pending" }
DELETE /users/:uid/follow                  → 204   // unfollows, or cancels a pending request

GET    /users/me/followRequests            → 200 { items: [{ uid, displayName, photoURL }] }
POST   /users/me/followRequests/:uid/approve → 204
POST   /users/me/followRequests/:uid/deny    → 204

POST   /users/:uid/block                   → 204   // also severs Follow/FollowRequest both directions, §19
DELETE /users/:uid/block                   → 204
POST   /users/:uid/mute                    → 204
DELETE /users/:uid/mute                    → 204
```

**Implementation note:** `Follow`/`Unfollow` are `PUT`/`DELETE`, not `POST` — consistent with every other "set this relationship" endpoint in this API (watchlist, watched, followedCelebrities), and idempotent by construction (repeat calls don't duplicate writes or notifications). `status: "pending"` replaces the originally-sketched `"requested"` to match the `followRequests` collection's own vocabulary. Block/Mute are not implemented yet (§19 is a separate, later flow) — Follow/Unfollow/approve/deny are real and live in `backend/src/routes/follow.ts`.

## 5. People & taste discovery (§5a, §5b) 🔒

```
GET /movies/:movieId/watchedBy             → 200 { items: [{ uid, displayName, watchedAt }], nextCursor }
                                              // scoped to callers's own `following` list, visibility-filtered (§5a)
GET /users/me/tasteMatches                 → 200 { items: [{ uid, displayName, score, relationship }] }
                                              // precomputed, §5b — read-only, no write endpoint (batch job owns this).
                                              // relationship: "following" | "pending" | "none" — joined in live against
                                              // §4's Follow collections so Home's "Connect" button can render the
                                              // right label/state without a second round-trip.

PUT    /users/me/followedCelebrities/:personId    → 204
DELETE /users/me/followedCelebrities/:personId    → 204
GET    /users/me/followedCelebrities              → 200 { items: [{ personId, name, photo }], nextCursor }

GET /onboarding/celebrity-suggestions      → 200 { items: [{ personId, name, photo, appearsIn: number }] }
                                              // §13's onboarding step — ranks cast/crew from the caller's already-saved
                                              // watched movies by frequency, then popularity; empty history → empty list,
                                              // no fallback (this step is skippable, unlike Watched's trending fallback)
```

**Implementation note (added once `watchedBy` was actually built):** `nextCursor` is always `null` — this endpoint fans out over the caller's own `following` list (capped at 30, a pragmatic safety bound on parallel reads, not a Firestore query-operator limit) rather than running a paginated Firestore query, so there's nothing to page through in the usual sense. Both privacy checks from §5a (`users.listVisible` list-level, `watched.visibility` per-entry) are enforced server-side; a followed user who watched the movie but fails either check is silently excluded, not surfaced with a placeholder. Live in `backend/src/services/people.service.ts` (`getMovieWatchedBy`) alongside `/users/me/tasteMatches` — grouped by feature (social discovery), not by URL prefix, same reasoning as Reviews (§3) living apart from Movies (§1) despite sharing a `/movies/:movieId/...` prefix.

## 6. Recommendations (§6) 🔒

```
GET /recommendations                       → 200 { items: [{ movieId, title, poster, year, genres, voteAverage,
                                                              matchScore: number | null }] }
                                              // content-based live query; cold-start users get trending fallback transparently
```

**Implementation note:** `matchScore` (0-100, "Top picks for you"'s % badge) is a heuristic, not a learned model — 70% weight on how much of the caller's preferred-genre set a candidate covers, 30% weight on its own TMDB rating. It's `null` for the trending/cold-start fallback, which has no preference to score against — the frontend shows the rating alone in that case, no "% match" badge.

```
GET /movies/:movieId/similar                → 200 { items: [{ movieId, title, poster, year, voteAverage }] }
                                              // movie-to-movie, not user-to-movie — no auth, no matchScore
```

**Implementation note (added once this was actually built, 2026-09-04):** "Similar taste picks for you" — movie detail's right rail (mockup-driven, no prior hld.md flow, same footing as §7b's Home additions). A sibling to `GET /recommendations` above, not a variant of it: same array-contains-any-on-genres query, just keyed off the movie being viewed rather than the caller's watch history, and with no `matchScore` since there's no user preference here to score against. Public, unauthenticated, same as `GET /movies/:movieId` itself. 404 `MOVIE_NOT_FOUND` for a nonexistent movie; `items: []` for a movie with no genres on record (nothing to match against — not treated as an error). Live in `backend/src/services/recommendations.service.ts` (`getSimilarMovies`), routed from `recommendations.route.ts` rather than `movies.route.ts` purely to avoid a concurrent-edit collision with that file during the session that built this (see git history around 2026-09-04) — grouped by feature either way, same reasoning §5's `watchedBy`/`tasteMatches` endpoints already use for living apart from their literal URL prefix.

## 7. Search (§18)

```
GET /search/movies?q=:query                → 200 { items: [{ movieId, title, poster, year }], nextCursor }
```

**Implementation note (added once this was actually built — the original sketch above assumed Vertex AI Search, which was never built; see hld.md §18's own implementation note for the full picture, redesigned 2026-08-31):** the local Firestore search index — a `titleSearchTerms` field, computed once per movie at write time, unioning real title-word prefixes with precomputed single-typo variants (`backend/src/lib/searchIndex.ts`) — and live TMDB are now queried **together on every search**, not as a cascade where TMDB is only a last resort. Results are merged into one pool, deduplicated by `movieId` (TMDB's fresher data wins over a stale local doc for the same movie), and ranked as one set: `backend/src/lib/searchRanking.ts` classifies every candidate into a match-type tier (exact > alias > prefix > token > single-typo > deeper-fuzzy) and scores within that tier — exact/prefix matches always outrank fuzzy ones, and popularity only ever breaks a tie between equally-relevant results, never overrides a stronger textual match. A TMDB failure degrades to local-only results rather than failing the whole request, as long as the local index has a match. TMDB results still get written back into the local index either way, so the same query resolves more from the local side over time. `nextCursor` is always `null` — pagination was never built for this endpoint, the merged ranked result set is capped at 20 in one response.

## 7b. Home 🔒

```
GET /home/greeting                         → 200 { quote, attribution, source: "watched" | "random" }
GET /home/activity                         → 200 { items: [{ activityId, uid, displayName, type, movieId,
                                                              movieTitle, moviePoster, createdAt }] }
GET /home/friends-recommendations           → 200 { items: [{ movieId, title, poster, year, genres,
                                                              voteAverage, watchedByCount }] }
```

**Implementation note (mockup-driven, no prior hld.md flow):** `/home/greeting` is hld.md §6/§13's movie-dialogue greeting — a small curated quote set (`backend/src/data/movieQuotes.ts`, tagged by real TMDB movie id) prefers a match against the caller's watched list (`source: "watched"`) and falls back to a random pick otherwise (`source: "random"`), which is exactly the "first Home visit is already personalized" behavior §13 called for. `/home/activity` is "Friends are watching" — same fan-out shape as §5a (bounded by the caller's own `following` list, never a global feed), reading a new top-level `activity/{activityId}` collection (schema.md) that `watchlist`/`watched` writes append to (skipped for a `watched` entry marked `visibility: "private"`, respecting §5a's per-entry override). Types are currently `"watched"` and `"watchlist_added"` — `"rated"`/`"reviewed"` join once Reviews (§20) exists.

**Implementation note (added once `/home/friends-recommendations` was actually built, 2026-09-04):** "Because your friends watched these" — HomeDesktop's right rail, under `PeopleYouMightVibeWith`. Unlike §6's Recommendations, this has **no trending/cold-start fallback**: a caller who follows no one gets `items: []`, full stop, and the frontend hides the section entirely rather than showing a generic feed — it only makes sense once there's an actual social signal, the same "gate, don't fabricate" choice §5b's taste matches made. Ranking source is followed people's complete `watched` history (not the `activity` log above, which is capped to the most recent entries and built for a feed, not a ranking corpus) — `watchedByCount` is how many of the caller's followed people watched a title, movies the caller has already watched or watchlisted excluded. Respects §5a's per-entry `visibility: "private"` override exactly like `/home/activity` does, even though nothing here is attributed to a name. Live in `backend/src/services/home.service.ts` (`getFriendsRecommendations`).

## 8. Events (§7, §9) 🔒 unless noted

```
POST   /events                             body: { movieId, title?, datetime, mode: "online"|"in-person", location?,
                                                     visibility: "public"|"private", participantLimit, requiresApproval,
                                                     invitedUserIds? }
                                              → 201 { eventId, ...event fields, joinCode? (private only) }
                                              // host auto-joins; a rooms/{roomId} doc is created alongside so §16's
                                              // chat has something real to attach to later, even though the chat
                                              // UI itself isn't built yet
GET    /events/upcoming                    query: { limit?, movieId? } → 200 { items: [{ ...event fields, movieTitle, moviePoster }] }
                                              // public + future only, sorted by datetime asc — powers Home's
                                              // "Upcoming watch events"; movieId narrows to one movie's events —
                                              // movie detail's "Watch together" right rail (added 2026-09-04).
                                              // Not yet personalized — invited/joined-only browsing is still planned

PUT    /events/:eventId/join               → 200 { status: "joined" | "pending" }
                                              // branches on the event's own requiresApproval, re-checked server-side;
                                              // 409 EVENT_FULL if participantCount is already at participantLimit.
                                              // joinCode-based lookup for private events isn't wired up yet — join
                                              // currently needs the eventId directly
DELETE /events/:eventId/join               → 204   // leaves the event, or cancels a pending request
GET    /events/:eventId/joinRequests       → 200 { items: [{ uid, displayName }] }        // host only
POST   /events/:eventId/joinRequests/:uid/approve → 204   // host only, re-checks capacity, 409 EVENT_FULL if it filled up while pending
POST   /events/:eventId/joinRequests/:uid/deny    → 204   // host only

GET    /events/:eventId                    → 200 { ...event fields, movieTitle, moviePoster }
                                              // §21. Same UpcomingEvent shape as /upcoming and /nearby's items. No
                                              // visibility-based access check — like PUT .../join, a private event is
                                              // reachable by anyone who has the ID (protected by not being *listed*
                                              // to them, not by blocking direct access). 404 EVENT_NOT_FOUND for a
                                              // nonexistent OR soft-deleted event — indistinguishable from outside.
GET    /events/nearby                      query: { lat, lng, radiusKm } → 200 { items: [{ ...event fields, movieTitle, moviePoster, distanceKm }] }
                                              // §9. radiusKm capped at 200. 400 INVALID_QUERY on missing/out-of-range
                                              // lat/lng/radiusKm. Composes with §7's visibility rules rather than
                                              // bypassing them: results are public events, or private events the
                                              // caller is hosting or was explicitly invited to (join-code-only access
                                              // isn't surfaced here — that event is still reachable directly by ID,
                                              // just not via location search). Sorted by distanceKm ascending.
PATCH  /events/:eventId                    body: { title?, datetime?, participantLimit?, ... } → 200   // §21, not yet implemented
DELETE /events/:eventId                    → 204   // §21. Host only (403 FORBIDDEN otherwise); 404 EVENT_NOT_FOUND
                                              // for a nonexistent or already-deleted event (idempotent delete isn't
                                              // supported — a second delete 404s rather than silently succeeding,
                                              // since there's no host-visible difference between "gone" and "already
                                              // gone" worth hiding). Soft delete only (deleted: true) — same §21
                                              // policy as reviews/messages; excluded from /upcoming, /nearby, and
                                              // GET /events/:eventId, and PUT .../join now 404s for it too. Existing
                                              // participants aren't notified of the cancellation (see hld.md §11's
                                              // still-open "event notifications" gap).
```

**Implementation note (added once `/events/nearby` was actually built):** Firestore has no native radius query, so this runs a geohash-prefix range query (`backend/src/lib/geohash.ts`, no external dependency — a self-contained ~30-line encoder) at a precision chosen from `radiusKm`, then post-filters the candidates to an actual haversine distance and sorts by it. This is a known approximation, not an exact-recall search: an event whose geohash cell happens to fall just across a boundary from the query point's own cell can be missed even if it's genuinely within range — accepted per hld.md §9's own framing ("an approximation of a bounding box"), not treated as a bug. `POST /events` computes and stores the geohash at creation time for any in-person event with a resolved `location`; online events (and in-person events without one yet) simply aren't location-discoverable.

## 9. Rooms & messages (§16) 🔒

```
POST   /rooms/:roomId/messages             body: { text } → 201 { messageId, createdAt }
                                              // reads bypass this API entirely — frontend subscribes directly to
                                              // Firestore via onSnapshot per §16, governed by Security Rules, not a GET here
PATCH  /rooms/:roomId/messages/:messageId  body: { text } → 200   // author only, §21
DELETE /rooms/:roomId/messages/:messageId  → 204                  // author or moderator, §21

PATCH  /rooms/:roomId                      body: { type: "persistent" } → 200   // host only, §16 — one-way ephemeral→persistent
POST   /rooms/:roomId/events               body: { movieId, datetime, mode, visibility, participantLimit,
                                                     requiresApproval, title?, location?, invitedUserIds? } → 201 { eventId, ...event fields }
                                              // schedule a new event from a persistent room; invitedUserIds defaults
                                              // to the room's current memberIds (§16). 400 ROOM_NOT_PERSISTENT if the
                                              // room hasn't been promoted yet; links back to the SAME roomId, no new room
```

**Implementation note (added once this was actually built):** "member of this room" is resolved purely against `rooms/{roomId}.memberIds` — both for the backend's write-path checks above and for `firestore.rules`' read-path checks on the frontend's direct `onSnapshot` subscription — since Security Rules can only see `memberIds`, not the caller's event-participant status. `events.service.ts`'s join/leave/approve paths keep `memberIds` in sync with event participation so a joined participant can actually chat, not just show up in the participant list. `DELETE .../messages/:messageId` is author-only for now, not "or moderator" — §14's role system isn't built yet, same gap already flagged for review disputes (§3). The ephemeral-room grace-period deletion timer from hld.md §16 isn't built (needs a Cloud Function + delayed job) — rooms and messages persist indefinitely rather than auto-cleaning up once everyone leaves.

## 10. Notifications (§17) 🔒

```
GET   /users/me/notifications              query: { unreadOnly?, limit? } → 200 { items: [{ id, type, fromUserId,
                                                       targetType, targetId, read, createdAt }] }
                                              // powers Home's bell badge; a full notification-center UI and cursor
                                              // pagination are still planned — this is the read surface only
PATCH /users/me/notifications/:id          body: { read: true } → 204
PATCH /users/me                            body: { notificationPrefs: { emailEnabled } } → 200   // not yet implemented
POST  /users/me/deviceTokens                body: { token } → 204   // FCM device-token registration, not yet implemented
```

**Implementation note:** `type` is currently written by exactly two flows — Follow (`followRequest`, `followApproved`) and Events (`eventJoinRequest`, `eventJoinApproved`) — via the shared `backend/src/lib/notify.ts` helper. `moderationAction` and the rest of §17's full type list land when their owning flows do.

## 11. Profile & onboarding (§13)

```
POST  /auth/email/start                    body: { email } → 204   // unauthenticated — no token exists yet
POST  /auth/email/verify                   body: { email, code } → 200 { customToken }   // unauthenticated
```
Both unauthenticated by necessity (§13's Email+OTP branch) — `start` generates a 6-digit code, hashes it, stores `authCodes/{email}` (schema.md), and emails it. `verify` checks the hash + expiry + attempt count, then calls the Admin SDK to create-or-look-up the Firebase Auth user for that email and mints a custom token via `createCustomToken()`. The frontend calls `signInWithCustomToken()` with the result, converging into the same ID-token state as the OAuth branch — from that point on, every other endpoint below is identical regardless of which of the three sign-in paths was used.

**Decision — direct SMTP instead of the Firebase "Trigger Email" extension named in hld.md §17.** The extension requires the Blaze (pay-as-you-go) plan and a console install step; sending directly via `nodemailer` against Gmail SMTP achieves the exact same outcome (backend generates a code, emails it) with no billing-plan dependency and no extra console round-trip — worth doing given the tight implementation timeline. `hld.md`'s notification emails (§17) can still move to the extension later; this doesn't reopen that decision, it just doesn't block the OTP path on it now.

🔒
```
GET   /users/me                            → 200 { uid, displayName, username, email, photoURL, listVisible,
                                                     followRequiresApproval, status, favoriteGenres, preferredLanguages,
                                                     onboardingComplete, notificationPrefs, themePreference, accentTheme,
                                                     isNewUser }
PATCH /users/me                            body: { displayName?, username?, listVisible?, followRequiresApproval?,
                                                     favoriteGenres?, preferredLanguages?, onboardingComplete?,
                                                     themePreference?, accentTheme? } → 200
                                              // setting username: 409 USERNAME_TAKEN if the usernames/{username}
                                              // reservation belongs to someone else; releases the caller's old
                                              // reservation (if any) and creates the new one, same request

GET   /users/username-available            query: { username } → 200 { available: boolean }
                                              // real-time check for onboarding step 3's UI, unauthenticated (no
                                              // account exists to attach a reservation to yet, for the OAuth
                                              // branches this still runs before the wizard's PATCH)

GET   /onboarding/watched-candidates       query: { genres?, languages? } → 200 { items: [movie summary...] }
                                              // §13's Watched step — filtered by the genres/languages just chosen in
                                              // the prior steps when present, trending fallback otherwise (same
                                              // cold-start shape as §6, no watched/watchlist exclusion — the point
                                              // here is surfacing candidates *to* mark watched, not hiding them)
```
No `POST /users` — profile creation is the lazy, on-first-authenticated-request pattern from §13, not a distinct signup call. `GET /users/me` on a brand-new token is what triggers it server-side — `isNewUser` is `true` only on that exact bootstrap call (hld.md §13's flow diagram calls this out explicitly: "return 'new user' flag"), `false` on every call after. The frontend's actual "should I show onboarding" check is `isNewUser || !onboardingComplete` — the flag alone doesn't catch a user who signed up, got partway through the wizard, and closed the app.

### 11b. Public profile (§8, §9) 🔒

```
GET /users/:uid   → 200 { uid, displayName, username, photoURL, favoriteGenres, preferredLanguages,
                            followerCount, followingCount, relationship: "self"|"following"|"pending"|"none",
                            watchedListVisible, watched: [{ movieId, title, poster, watchedAt }] }
```

The public-facing counterpart to `GET /users/me` — added once "People Discovery" (§9's watchedBy/tasteMatches) had somewhere to actually link a person's card *to*. 404 `USER_NOT_FOUND` for a nonexistent uid. `relationship` is computed against the caller's own follow subcollections (same read as §4's Follow flow), never trusted from the client. `watched` applies the exact same two-part privacy filter as `GET /movies/:movieId/watchedBy` (§5, hld.md §5a) — list-level `listVisible` and per-entry `visibility`, both server-side — capped to the 12 most recent public entries as a profile preview, not a paginated list; `watchedListVisible` tells the frontend whether the empty array means "nothing public" or "list is hidden." This filter applies even when a caller requests their own uid — the unfiltered self view is what `GET /users/me/watched` is for.

## 12. Reporting & moderation (§14a, §30.8) 🔒

```
POST /reports   body: { targetType: "message"|"review"|"user"|"event", targetId, reason,
                         roomId?,    // required when targetType is "message" — locates rooms/{roomId}/messages/{targetId}
                         movieId? }  // required when targetType is "review" — locates movies/{movieId}/reviews/{targetId}
              → 201 { reportId, status: "pending"|"actioned"|"dismissed"|"error",
                       decision: { violates, category, contentAction: "none"|"remove",
                                    accountAction: "none"|"warn"|"restrict"|"suspend_temporary"|"suspend_permanent",
                                    suspensionDays, confidence, rationale, flaggedForReview, resolvedAt } | null }
```

**Implementation note (added once this was actually built — supersedes the original §14b/§14c-based sketch this section used to have):** there is no moderator/admin role, no report queue, and no `/moderation/*` or `/admin/*` endpoints — §14b (human moderator review) and §14c (role assignment) were never built. Instead, `POST /reports` does everything in one request: it creates the report AND immediately asks Gemini to classify and decide (PRD §30.8), then applies that decision synchronously — soft-deleting the content and/or updating the target's account `status`/`statusExpiresAt` — before responding. The decision comes back to the *reporter* in the same response, for transparency. This is a deliberate product decision to make the AI moderator fully autonomous rather than PRD §30.8's original "triage layer, human still decides" framing.

**Confidence-threshold capping (added after live testing raised "what happens when AI confidence is very low?"):** when `decision.confidence < 0.7` and Gemini suggested a severe `accountAction` (`restrict`, `suspend_temporary`, or `suspend_permanent`), the applied `accountAction` is capped down to `"warn"` (and `suspensionDays` forced to `null`) before it's applied — a low-confidence call can never itself suspend or restrict an account. `contentAction` is deliberately never capped, since a soft-delete is already reversible and lower-stakes than an account penalty. Every decision below the threshold — capped or not — gets `flaggedForReview: true` in the response. There is still no moderator queue/dashboard to route flags to (per the "AI moderators, not humans" product decision): today "flagging" means the report doc stores `flaggedForReview` and `appliedAccountAction` (see `docs/schema.md` §5), and the server logs a `logger.warn(...)` — both inspectable via the Firestore console or Cloud Run logs, not a new endpoint. `reports/{reportId}.decision` always stores Gemini's raw, uncapped suggestion for audit purposes; `appliedAccountAction` records what was actually executed. See `backend/src/services/reports.service.ts`'s `capLowConfidenceDecision()`.

400 `INVALID_REPORT` for a bad/missing `targetType`/`targetId`/`reason` (or a missing `roomId`/`movieId` for the two target types that need one to be located). 404 `TARGET_NOT_FOUND` if the reported message/review/user/event doesn't exist. When `GEMINI_API_KEY` isn't configured, the report is still created but `status` stays `"pending"` and `decision` is `null` forever — there's no human fallback queue to route it to. If Gemini itself errors, `status` is `"error"`, `decision` is `null`, nothing gets actioned — fails safe rather than guessing. See `backend/src/lib/gemini.ts` for the exact prompt/decision schema and `backend/src/services/reports.service.ts` for how each action is applied.

## 13. Not REST endpoints — direct client connections

Two flows deliberately bypass this API entirely (§10's "backend validates every request" principle doesn't apply where there's no backend in the path):

- **Presence** (§15) — frontend writes straight to Realtime Database (`presence/{eventId}/{uid}`), no backend endpoint.
- **Room message reads, notification feed reads** (§16, §17) — frontend subscribes directly to Firestore via `onSnapshot`, governed by Security Rules (schema.md §7), not this API. The `GET` endpoints above exist only as a non-realtime fallback/initial-load path.
- **Firebase Auth** (§13) — sign-up/login talks to Firebase Authentication directly, never this API.
- **Google Maps** (§9) — geocoding/rendering calls Maps directly from the frontend.

---

That's the full contract sweep — every flow in hld.md now has either an endpoint or an explicit "no endpoint, direct connection" note. Worth a pass to confirm nothing's missing, or ready to move toward actual scaffolding (Milestone 2) next?
