# ZATLAN — Conceptual Data Model (Working Notes)

Follows [hld.md](hld.md) (which flows exist and why) and precedes concrete schema/API contract design. This doc captures **entities, their key attributes, and relationships/cardinality** — deliberately still storage-agnostic in spirit, even though Firestore paths already leaked into the HLD (that's fine; this pass makes the *relationships* explicit rather than implicit in a path string).

---

## Draft entity list (extracted from hld.md, grouped into clusters)

**Identity**
- **User** — the account. Profile, privacy settings, moderation status, role (custom claim, not stored data).

**Catalog**
- **Movie** — the ZATLAN movie-catalog record (TMDB-sourced).

**Social graph**
- **Follow** — A follows B (one-directional).
- **FollowRequest** — pending version of the above, when B requires approval.
- **Block** — bidirectional severance.
- **Mute** — one-directional, view-only.

**Movie activity**
- **WatchlistEntry** — user intends to watch a movie.
- **WatchedEntry** — user watched a movie (has its own visibility override).
- **Review** — one per (user, movie); rating + optional text + anonymity flag.

**Events**
- **Event** — a watch party.
- **EventParticipant** — confirmed attendee.
- **EventJoinRequest** — pending version, when approval is required.

**Chat / rooms**
- **Room** — a chat room. One created per Event by default (ephemeral — deleted once everyone leaves, after a grace period); can be promoted by the host to `persistent`, at which point it can outlive its originating event and later be linked to additional events scheduled from it. Genuinely its own entity now, not folded into Event or Movie — see decision below.
- **Message** — a chat message, belongs to a Room.

**Notifications**
- **Notification** — per-user, per-event feed entry.

**Moderation**
- **Report** — user-filed complaint against some target.
- **ModerationLogEntry** — record of an action taken against a user.
- **ReviewBan** — scoped ban: one user, one movie, 30 days.
- **ModerationDispute** — appeal of a specific removal.

**Precomputed / batch**
- **TasteMatch** — precomputed "similar users" result per user (§5b).

**Not a Firestore entity — flagged separately**
- **Presence** — lives in Realtime Database, not Firestore; per-event, per-user, ephemeral.
- **Search index entry** — lives in Vertex AI Search, not Firestore; derived from Movie, not its own source of truth.

---

**Decision (revised) — `Room` is its own entity, owned by neither Movie nor Event 1:1.** Originally modeled as "no separate entity, just Movie + messages," then briefly "one room per Movie," then corrected again once you clarified the actual desired behavior: rooms are per-*event*, ephemeral by default (Google Meet-style — active while anyone's present, deleted after a grace period once everyone leaves), and promotable by the host to `persistent`, at which point they stop being tied to any single event and can be reused to schedule further events later. That reuse is exactly why `Room` can't just be an attribute of `Event`: a persistent room's relationship to events is **one-to-many over time**, not 1:1. Full lifecycle detail in [hld.md §16](hld.md#16-flow-event-chat-rooms).

- `Room { type: "ephemeral" | "persistent", originEventId, memberIds[], createdAt }`
- `Event.roomId` → the room that event's chat happens in (an event always has exactly one room; a room can belong to more than one event only in the persistent case, via "schedule a new event from this room")
- Reported messages are the one exception to ephemeral deletion — preserved (soft-deleted, §21) for moderator review even after the room itself is gone.

---

## 1. Core Entities: User & Movie

These are the two hub entities — almost everything else either belongs to one, references one, or connects the two.

### User

Key attributes, grounded in decisions already made across the HLD:

| Attribute | Source | Notes |
|---|---|---|
| `uid` | §13 (Firebase Auth) | Identity comes from Firebase Auth, not self-assigned |
| `displayName`, `email` | §13 | Set at onboarding |
| `username` | §13 | Set at onboarding step 3, `null` until then. Needs global uniqueness — Firestore has no native unique-constraint, so it's enforced structurally via a `usernames/{username}` reservation doc (schema.md), same deterministic-ID pattern used elsewhere for "one of these, structurally" guarantees |
| `photoURL` | §13 | From the OAuth provider (Google/Microsoft) at signup, `null` for the Email+OTP path until a user-uploaded avatar exists — see the profile-page mockups' avatar/upload need, not yet otherwise modeled here |
| `createdAt` | §13 | |
| `listVisible` | §13, §5a | List-level privacy default (watched-list visibility) |
| `followRequiresApproval` | §4, §13 | Default off |
| `status` | §14b | `active` \| `restricted` \| `suspended` (+ expiry if temporary) |
| `notificationPrefs.emailEnabled` | §17 | Per-user opt-out |
| `themePreference` | UI direction | `"dark"` \| `"light"` \| `"system"`, default `"dark"` — ZATLAN ships dark-mode-first; user can switch to light or follow the OS setting |
| `accentTheme` | UI direction | `"emerald"` \| `"cyan"` \| `"purple"` \| `"pink"` \| `"amber"` \| `"red"`, default `"emerald"` — the accent color used on the primary CTA, the ZATLAN rating, and a small set of other deliberately-chosen elements (never applied broadly). TMDB's rating stays a fixed neutral white regardless of the chosen accent, so the two ratings never collide |
| `favoriteGenres` | §13 | Resolved — yes, a stored attribute (not a relationship): optional onboarding step, feeds §6's cold-start recommendations |
| `preferredLanguages` | §13 | Optional onboarding step, added alongside `favoriteGenres` — ISO 639-1 codes for which regional/language cinema the user watches (e.g. Tamil, Korean, English), not a dubbing preference. Same shape and same consumer (recommendations, onboarding's Watched-step candidate filtering) as `favoriteGenres` |
| `onboardingComplete` | §13 | Default `false`. Distinct from any single onboarding step's own optionality — genres/languages/watched/celebrities can all be individually skipped, but the wizard as a whole still needs a durable "done" signal so a returning user isn't shown it again. Also doubles as the frontend's "should I launch onboarding at all" check, alongside the bootstrap call's one-time `isNewUser` flag (api-contracts.md §11) — the flag catches "just signed up," this field catches "signed up before but never finished" |
| role | §14b | **Not a stored attribute** — lives in Firebase custom claims, not Firestore, by design |

### Movie

| Attribute | Source | Notes |
|---|---|---|
| `movieId` | §2 | TMDB-sourced ID (or wraps `tmdb_id`?) |
| `title`, `year`, `runtime`, `genres[]` | §2, §6 | `genres` stored as a real array (TMDB gives this natively, unlike raw IMDb) |
| `synopsis`, `poster`, `cast/crew` | §2 | Full detail, fetched lazily on first view. Cast/crew entries carry `personId` (TMDB's person id) — a stable FK into the `Person` entity below, not just a display name |
| `originalLanguage` | §13 | TMDB's `original_language`, ISO 639-1 — the source of truth both onboarding's language-preference step and its Watched-step candidate filtering key off, rather than inventing a separate ZATLAN-owned language taxonomy |
| `voteAverage`, `voteCount` (TMDB rating) | §2 | Replaces "IMDb rating" entirely as of §2's correction; vote count shown alongside the rating for credibility |
| `trailerKey` | §2 | YouTube video id for the official trailer, from TMDB's `videos` endpoint; `null` if TMDB has none |
| `zatlanRating.sum`, `zatlanRating.count` | §20 | ZATLAN's own aggregate, maintained transactionally |
| `streamingProviders`, `streamingLastFetched` | §8 | Own refresh cycle, shorter TTL than the rest of the doc |
| `isAdult` | imdb-data-analysis.md §2, HLD §5a | Carried over from TMDB/IMDb; floated in §5a as a possible future default for auto-private watched entries |
| `lastFetched` (full-detail) | §2 | Cache/staleness marker for the general record |

**Decision — `Movie` stays one entity, not split.** No reader ever needs just one slice — the detail page (§2) wants catalog fields and full-detail fields together, and search (§18) never reads this record at all, it hits the separate Vertex AI Search index. Splitting would add a join with no corresponding benefit. Mixed-freshness fields (`lastFetched` vs. `streamingLastFetched`) live on the same doc, each with its own staleness check.

### Person

| Attribute | Source | Notes |
|---|---|---|
| `personId` | §13 (onboarding's celebrity-follow step) | TMDB's person id — same "TMDB is the ID source of truth" pattern as `Movie` |
| `name`, `photo`, `knownForDepartment`, `popularity` | §13 | From TMDB's credits payload — `popularity` ranks onboarding's celebrity suggestions |
| `lastFetched` | §2's pattern, reused | Staleness marker |

**Decision — `Person` is its own entity, not just inline cast/crew strings.** Added once onboarding needed to suggest *followable* celebrities: a name string on a movie's cast list isn't a stable, referenceable thing — following requires an ID that survives across every movie that person appears in. Same on-demand "create on first need" ingestion as `Movie` (§2), except the trigger is a `Movie` ingestion carrying that person in its credits, not a direct fetch of the person themselves — cast/crew people get upserted as a side effect of ingesting the movie they're credited on.

---

## 2. Direct User↔Movie relationships

Five entities, each connecting exactly one `User` to exactly one `Movie`, but with different cardinality/constraint shapes:

| Entity | Cardinality | Key attributes | Source |
|---|---|---|---|
| `WatchlistEntry` | User 1—N Movie (many, uncapped) | `addedAt` | §3 |
| `WatchedEntry` | User 1—N Movie (many, uncapped) | `watchedAt?`, `visibility: "public" \| "private"` (per-entry override) | §5a |
| `Review` | User 1—1 Movie (capped at one per pair, enforced structurally by keying the doc on `authorId`) | `rating`, `reviewText?`, `isAnonymous`, `modRemovalCount`, `createdAt`, `updatedAt`, `deleted` (soft-delete, §21) | §20, §22 |
| `ReviewBan` | User 1—1 Movie (at most one active ban per pair) | `bannedUntil` | §22 |
| `LikeEntry` | User 1—1 Movie (capped at one per pair — you either like a movie or you don't) | `createdAt` | PRD §5.1/§22 (P0 "Likes"), added once the movie-detail UI made the gap visible |

**Decision — `Review`, `ReviewBan`, and `LikeEntry` are keyed the same deterministic way** (`{userId}+{movieId}` as the doc path, not a random ID) — this is what makes "one review per user per movie," "at most one active ban per user per movie," and "like is a toggle, not a counter" *structural* guarantees rather than application-level checks (§20's reasoning, reused for §22 and now for likes). `WatchlistEntry`/`WatchedEntry` don't need this since they're not capped at one — a user can have many.

**`LikeEntry` mirrors `Review`'s aggregate pattern, simplified.** `Movie.likeCount` is maintained the same transactional way as `zatlanRating` (§20) — but since a like has no *value* to average, only existence, the transaction is just "does `users/{uid}/likes/{movieId}` already exist? If not, create it and `likeCount += 1`; on unlike, delete it and `likeCount -= 1`" — no delta computation needed, since there's nothing to edit, only toggle on/off.

**Worth naming explicitly:** `Review.modRemovalCount` means `Review` and `ReviewBan` aren't independent — a `Review`'s strike count is what *produces* a `ReviewBan` once it hits 3 (§22). That's a real relationship (one `Review`'s history can create one `ReviewBan`), not just two entities that happen to share a key shape.

---

## 3. Social graph: User↔User relationships

All four are self-referential (`User` to `User`), all many-to-many, but they differ in whether they're **mirrored** (stored on both sides for fast reverse lookup) and whether their *effect* is one-directional or bidirectional.

| Entity | Storage | Effect | Key attributes | Source |
|---|---|---|---|---|
| `Follow` | **Mirrored** — `users/{A}/following/{B}` + `users/{B}/followers/{A}`, written together | One-directional (A follows B ≠ B follows A) | `createdAt` | §4, §5a |
| `FollowRequest` | Single write — `users/{B}/followRequests/{A}` | Transient — resolves into a `Follow` (approved) or is deleted (denied) | `createdAt` | §4 |
| `Block` | Single write — `users/{A}/blocked/{B}` (not mirrored) | **Bidirectional** — severs interaction both ways, even though only A initiated it | `createdAt` | §19 |
| `Mute` | Single write — `users/{uid}/muted/{mutedUid}` (not mirrored) | One-directional only (muter's own view) | `createdAt` | §19 |

**Decision — why `Follow` is mirrored but `Block`/`Mute` aren't.** `Follow` needs both directions as real, frequently-shown UI surfaces — a profile shows both "following count" and "follower count," and both need fast reads. `Block` and `Mute` never need a reverse listing: nobody is ever shown "who has blocked/muted me" — surfacing that would itself leak information the feature exists specifically to hide. So a `Block` check at read time queries *both* single-direction docs (`did A block B` OR `did B block A`) rather than relying on a mirror — two cheap point-reads by known IDs, not a scan, so no mirror is needed for that either.

**Relationship between `Block` and `Follow`/`FollowRequest`:** §19 already establishes that blocking severs an existing `Follow` in both directions. Extending that: a `Block` should also delete any pending `FollowRequest` between the same pair — otherwise a stale pending request could persist for two users who can no longer interact at all. Flagging this as a natural extension of §19's existing decision rather than a new open question — correct me if you want it handled differently.

### FollowedCelebrity (User↔Person, not User↔User)

| Entity | Storage | Effect | Key attributes | Source |
|---|---|---|---|---|
| `FollowedCelebrity` | Single write — `users/{uid}/followedCelebrities/{personId}` (not mirrored) | One-directional — a `Person` doesn't "follow back" | `followedAt` | §13's onboarding celebrity-suggestion step |

**Decision — not mirrored, unlike `Follow`.** `Person` isn't a `User` — there's no reverse "who follows me" surface to serve on a celebrity's side (the eventual celebrity-page feature, still deferred, would read follower *counts* via a simple collection-count query, not a per-follower mirror). Simpler than `Follow`, not a variant of it.

---

## 4. Events

### Event

| Attribute | Source | Notes |
|---|---|---|
| `eventId` | §7 | |
| `hostId` | §7 | References `User` — many-to-one (a User can host many Events, an Event has exactly one host) |
| `movieId` | §7 | References `Movie` — many-to-one (a Movie can have many Events, an Event is about exactly one Movie) |
| `title?` | §7 | Optional custom label — **not** a copy of the movie's title (§10's "no duplicated derived fields" principle); blank shows the movie's own title |
| `datetime`, `mode` (online/in-person), `location?` | §7 | `location?` only present for in-person events |
| `geohash` | §9 | Derived from `location`, powers proximity queries |
| `visibility` (`public`/`private`), `participantLimit`, `requiresApproval` | §7 | |
| `joinCode?` | §7 | Auto-generated only for private events |
| `invitedUserIds?` | §7 | Optional direct-invite list, on top of the join code |
| `roomId` | §16 (revised) | References `Room` — see relationship below |

### EventParticipant

`events/{eventId}/participants/{uid}` — many-to-many between `User` and `Event`, confirmed attendee. Host is auto-added on creation (§7).

### EventJoinRequest

`events/{eventId}/joinRequests/{uid}` — same transient shape as `FollowRequest`: pending, resolves into an `EventParticipant` (approved) or is deleted (denied) by the host.

### Event ↔ Room (carrying forward §16's revised design)

- Every `Event` has exactly **one** `roomId`, assigned at creation time — either a freshly generated ID (the normal case; the `Room` doc itself is created lazily on first join, same as before), or an **existing** persistent room's ID, when the event was created via "schedule a new event from this room" (§16).
- A `Room` can therefore belong to more than one `Event` over time, but only in the persistent case — this is the one-to-many relationship that made `Room` need to be its own entity rather than an attribute of `Event`.
- **Decision — resolves §16's flagged open point:** `Room.memberIds` grows as the union of every `EventParticipant` across every `Event` ever linked to that room — nothing more granular for now (no standalone add/remove on a persistent room, independent of an event). Consistent with the "default assumption" already noted in §16.

---

## 5. Notifications and Moderation

### Notification

`users/{uid}/notifications/{id}` — many-to-one to `User` (the recipient).

| Attribute | Source | Notes |
|---|---|---|
| `type` | §17 | `followRequest` \| `eventJoinRequest` \| `eventJoinApproved` \| `moderationAction` \| … |
| `fromUserId?` | §17 | References `User` — who triggered it. **Question folded in here:** for a `moderationAction` notification, should `fromUserId` be the moderator's own uid, or omitted for moderation neutrality (the platform acted, not a specific person)? Defaulting to **omitted** for that type — matches how moderation is framed everywhere else in the HLD (role-based, not personal) — flag if you want the moderator identified instead.
| `targetType?`, `targetId?` | *(new, proposed)* | §17's HLD text only specified `{type, fromUserId}` loosely — adding a polymorphic target reference (same pattern as `Report` below) so a notification can deep-link to the actual event/request/review it's about, not just carry a type label. |
| `read`, `createdAt` | §17 | |

### Report

`reports/{reportId}` — many-to-one to `User` (`reporterId`).

| Attribute | Source | Notes |
|---|---|---|
| `reporterId` | §14a | References `User` |
| `targetType`, `targetId` | §14a | **Polymorphic reference** — `targetType` says which collection `targetId` points into (message, review, event, user, room). First place in the model where a field's meaning depends on a sibling field rather than pointing at one fixed entity type. |
| `category`, `reason`, `status` (`pending`/…), `createdAt` | §14a | |

### ModerationLogEntry

`users/{targetUid}/moderationLog/{id}` — many-to-one to `User` (the person acted against).

| Attribute | Source | Notes |
|---|---|---|
| `action` | §14b | `warning` \| `removeContent` \| `restrict` \| `suspend` |
| `moderatorId` | §14b | References `User` (the moderator) — a second, separate many-to-one |
| `reportId?` | *(proposed)* | Not explicit in §14a/§14b, but a natural link back to the `Report` that triggered this action, when there was one (not every action originates from a report) |
| `expiresAt?`, `createdAt` | §14b | Only present for temporary restrictions/suspensions |

### ModerationDispute

`moderationDisputes/{disputeId}` — appeal of one specific `Review` removal.

| Attribute | Source | Notes |
|---|---|---|
| `reviewRef`, `authorId`, `moderatorId` | §22 | References `Review`, `User` (disputer), `User` (original moderator) |
| `status` | §22 | `pending` \| `upheld` \| `overturned` |
| `resolvedByAdminId?`, `resolvedAt?` | *(proposed)* | §22 says "an admin reviews it" but didn't name fields for recording who/when — adding these so the resolution itself is attributable, same as the original action |

### TasteMatch

Precomputed by §5b's daily batch job. Proposing `users/{uid}/tasteMatches/{matchedUid} { score, computedAt }` — a subcollection, not a single array field on `User` — for the same reason `Follow` uses subcollections rather than an array (avoids document-size growth and write contention as the list grows).

**Question:** taste similarity is conceptually symmetric (if A is similar to B, B is similar to A by the same score) — should the batch job **write both directions** (mirrored, like `Follow`'s `following`/`followers`) so both users see the match without recomputing, or write it once per ordered pair and let each user's read only reflect their own side? Defaulting to **mirrored write**, since the score is the same value either way and mirroring costs one extra write per pair, not a second computation.

### Non-Firestore entities (for completeness, not modeled further here)

- **Presence** — `presence/{eventId}/{uid}` in Realtime Database. Same many-to-many shape as `EventParticipant`, but ephemeral/live-only rather than a durable roster — deliberately not merged with `EventParticipant` (§15's reasoning: different tool for a different real-time need).
- **Search index entry** — lives in Vertex AI Search. A denormalized, lag-tolerant copy of `Movie`'s lightweight fields (title, poster, year, genres), refreshed by §18's scheduled bulk job. Not a foreign-key relationship in the usual sense — more like a materialized view maintained outside Firestore entirely, with `Movie` as its source of truth.

---

That closes the full sweep of entities from the original draft list. Want to see the whole thing pulled together as one relationship summary/diagram next, or is there a specific entity/relationship above you want to revisit first?
