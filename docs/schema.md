# ZATLAN — Concrete Firestore Schema

Translates [data-model.md](data-model.md)'s entities into exact Firestore collections, field types, IDs, composite indexes, and security rules. Where a field type or ID strategy required a judgment call not already made in the HLD/data-model docs, it's called out inline — flag anything you want changed.

**ID conventions used throughout:**
- Deterministic doc ID (no random ID) where the conceptual model requires structural uniqueness (§20/§22's "one per pair" guarantee) or where the ID *is* the natural foreign key (subcollections keyed by the related user's uid).
- Firestore auto-ID (`.doc()` with no arg) everywhere else — events, messages, reports, disputes, rooms.
- `movieId` is TMDB's own numeric ID, as a string, unprefixed — TMDB is the only movie-data source (§2), so there's no collision risk requiring a prefix.

---

## 1. Identity & Catalog

```
users/{uid}
  displayName: string
  username: string | null                // set during onboarding §13 step 3; null until then. Lowercase, reserved via usernames/{username} below
  email: string
  photoURL: string | null                // from the OAuth provider at signup (§13); user-uploaded avatar overrides it later
  createdAt: timestamp
  listVisible: boolean
  followRequiresApproval: boolean
  status: "active" | "restricted" | "suspended"
  statusExpiresAt: timestamp | null      // only set for temporary restrict/suspend
  notificationPrefs: { emailEnabled: boolean }
  themePreference: "dark" | "light" | "system"   // default "dark"
  accentTheme: "emerald" | "cyan" | "purple" | "pink" | "amber" | "red"   // default "emerald" — CTA + ZATLAN rating color; TMDB rating stays fixed neutral white
  favoriteGenres: array<string> | null   // optional onboarding step, §13
  preferredLanguages: array<string> | null   // optional onboarding step, §13 — ISO 639-1 codes (e.g. ["en","ta","ko"]), region/language of cinema watched, not dubbing
  onboardingComplete: boolean             // default false — set true once the onboarding wizard finishes or is skipped past its last step, §13. Distinct from any single step's optionality: a user can skip every optional step and still be "done" with onboarding
```

```
usernames/{username}                     // doc ID = the username itself, lowercase — deterministic, structural uniqueness (this doc's mere existence IS the reservation, same ID-strategy convention as §20/§22)
  uid: string                            // who holds it
```

```
authCodes/{email}                        // doc ID = email — deterministic, one active code per email (§13 Email+OTP branch)
  codeHash: string                       // sha256 of the 6-digit code; never store the raw code
  expiresAt: timestamp                   // short-lived, ~10 minutes
  attempts: number                       // failed-verify counter; locks out after a small cap to blunt brute-forcing a 6-digit space
  createdAt: timestamp
```

```
movies/{movieId}                         // doc ID = TMDB id, as string
  title: string
  year: number
  runtime: number | null
  genres: array<string>
  originalLanguage: string               // TMDB original_language, ISO 639-1 (e.g. "en", "ta", "ko") — onboarding §13's language-preference step and Home's watched-candidate filtering key off this
  synopsis: string | null
  poster: string | null                  // TMDB image path
  cast: array<{ personId: string, name: string, character: string, photo: string | null }>
  crew: array<{ personId: string, name: string, role: string, photo: string | null }>
  isAdult: boolean
  voteAverage: number                    // TMDB rating
  voteCount: number                      // TMDB vote count, shown alongside the rating for credibility
  trailerKey: string | null              // YouTube video id (official trailer, YouTube-hosted, preferred)
  zatlanRating: { sum: number, count: number }
  likeCount: number                      // maintained the same way as zatlanRating.count, no averaging needed
  streamingProviders: array<{ name: string, type: "subscription"|"rent"|"buy", logo: string }>
  streamingLastFetched: timestamp | null
  lastFetched: timestamp | null          // full-detail fetch marker, §2
  titleSearchTerms: array<string> | undefined  // §18 local search index — every title word's real prefixes
                                                // unioned with its precomputed single-typo variants (backend/src/lib/searchIndex.ts),
                                                // computed once at write time (detail ingestion, a search upsert, or a bulk-seed
                                                // script), not per search. Absent on any movie doc written before this existed —
                                                // GET /search/movies treats a missing field the same as an empty array
```

```
people/{personId}                        // doc ID = TMDB person id, as string — same on-demand ingestion pattern as movies (§2)
  name: string
  photo: string | null                   // TMDB profile_path
  knownForDepartment: string | null       // TMDB known_for_department, e.g. "Acting", "Directing"
  popularity: number                     // TMDB popularity — used to rank onboarding's celebrity suggestions
  lastFetched: timestamp
```
Upserted lazily whenever a movie carrying them in its cast/crew gets ingested (§2's ingestion path) — not a separate fetch trigger. A cheap `set({..., merge:true})` per credited person, same "create on first need" shape as everything else in §2/§13.

```
discover/recentMovies                    // single doc, not a collection of many — one shared cache
  items: array<{ movieId: string, title: string, poster: string | null, year: number | null }>
  updatedAt: timestamp
```
Backs `GET /movies/recent` (api-contracts.md §1, hld.md §18's implementation note) — TMDB's `now_playing` list, refreshed by `backend/scripts/refreshRecentMovies.ts` (run manually for now, same shortcut as §5b's `tasteMatches`) rather than fetched live on every request. The service falls back to a live TMDB call when this doc doesn't exist yet or Firestore isn't configured.

---

## 2. Direct User↔Movie relationships

```
users/{uid}/watchlist/{movieId}          // doc ID = movieId
  addedAt: timestamp
```

```
users/{uid}/watched/{movieId}            // doc ID = movieId
  watchedAt: timestamp | null
  visibility: "public" | "private"
```

```
users/{uid}/likes/{movieId}              // doc ID = movieId — existence = liked, no fields needed beyond createdAt
  createdAt: timestamp
```

```
movies/{movieId}/reviews/{authorId}      // doc ID = authorId — structural 1-per-pair (§20)
  rating: number
  reviewText: string | null
  isAnonymous: boolean
  modRemovalCount: number                // §22
  deleted: boolean                       // soft delete, §21
  createdAt: timestamp
  updatedAt: timestamp
```

```
users/{uid}/reviewBans/{movieId}         // doc ID = movieId — structural 1-active-per-pair (§22)
  bannedUntil: timestamp
```

---

## 3. Social graph

```
users/{uid}/following/{followedUid}      // doc ID = followedUid
  createdAt: timestamp

users/{uid}/followers/{followerUid}      // doc ID = followerUid — mirror, §5a
  createdAt: timestamp

users/{uid}/followRequests/{requesterUid}
  createdAt: timestamp

users/{uid}/blocked/{blockedUid}
  createdAt: timestamp

users/{uid}/muted/{mutedUid}
  createdAt: timestamp

users/{uid}/tasteMatches/{matchedUid}    // batch-written, §5b

activity/{activityId}                    // auto-ID, top-level (not a subcollection — same reasoning as
  uid: string                            // events/reports: needs an "in" query across many users' entries,
  type: "watched" | "watchlist_added"    // which a collection-group query can't express without a denormalized
  movieId: string                        // uid field anyway). Written by watchlist/watched PUT (userMovies.ts),
  createdAt: timestamp                   // skipped for a watched entry marked visibility:"private" (§5a's
                                          // per-entry override applies here too). Read by GET /home/activity
                                          // (api-contracts.md §7b), fanned out from the caller's own `following`
                                          // list — "rated"/"reviewed" types join once Reviews (§20) exists.

users/{uid}/followedCelebrities/{personId}   // doc ID = personId — following a person (§13's onboarding suggestion step, ahead of the full celebrity-page feature)
  followedAt: timestamp
  score: number
  computedAt: timestamp
```

---

## 4. Events, rooms, messages

```
events/{eventId}                         // auto-ID
  hostId: string
  movieId: string
  title: string | null
  datetime: timestamp
  mode: "online" | "in-person"
  location: { address: string, lat: number, lng: number } | null
  geohash: string | null                 // derived from location, §9
  visibility: "public" | "private"
  participantLimit: number
  requiresApproval: boolean
  joinCode: string | null                // only set when visibility = private
  invitedUserIds: array<string> | null
  roomId: string
  createdAt: timestamp
  deleted: boolean | undefined            // §21 soft-delete (host-only); absent/false on every
                                           // event until DELETE /events/:eventId is called on it

events/{eventId}/participants/{uid}
  joinedAt: timestamp

events/{eventId}/joinRequests/{uid}
  createdAt: timestamp
```

```
rooms/{roomId}                           // auto-ID, assigned to Event.roomId at event creation (§16)
  type: "ephemeral" | "persistent"
  originEventId: string
  memberIds: array<string>
  createdAt: timestamp

rooms/{roomId}/messages/{messageId}      // auto-ID
  authorId: string
  text: string
  createdAt: timestamp
  editedAt: timestamp | null
  deleted: boolean                       // soft delete, §21 — also the reported-message survival case, §16
```

**Non-Firestore, for completeness:** `presence/{eventId}/{uid}` in Realtime Database — `{ online: boolean, joinedAt: timestamp }`, per §15. Not part of the Firestore schema/indexes below.

---

## 5. Notifications & moderation

```
users/{uid}/notifications/{notificationId}   // auto-ID
  type: string                               // "followRequest" | "followApproved" | "eventJoinRequest" | "eventJoinApproved" | "moderationWarning"
  fromUserId: string | null                  // null for moderationWarning — there's no human "from", §17
  targetType: string | null
  targetId: string | null
  read: boolean
  createdAt: timestamp
```

```
reports/{reportId}                       // auto-ID
  reporterId: string
  targetType: "message" | "review" | "user" | "event"
  targetId: string                       // messageId / review's authorId / uid / eventId
  roomId: string | null                  // set when targetType is "message" — locates rooms/{roomId}/messages/{targetId}
  movieId: string | null                 // set when targetType is "review" — locates movies/{movieId}/reviews/{targetId}
  reason: string                         // reporter's free-text reason; no reporter-supplied category (Gemini determines it)
  status: "pending" | "actioned" | "dismissed" | "error"
  decision: {                            // null until Gemini resolves it (or forever, if Gemini isn't configured)
                                          // RAW Gemini output — accountAction here is what Gemini suggested,
                                          // before any confidence-based capping (see appliedAccountAction below)
    violates: boolean
    category: string
    contentAction: "none" | "remove"
    accountAction: "none" | "warn" | "restrict" | "suspend_temporary" | "suspend_permanent"
    suspensionDays: number | null
    confidence: number
    rationale: string
  } | null
  appliedAccountAction: string | null    // what actually got executed — equals decision.accountAction unless capped
  flaggedForReview: boolean              // true when confidence < 0.7; see hld.md §14 "capping low-confidence decisions"
  createdAt: timestamp
  resolvedAt: timestamp | null
```

**Implementation note (added once this was actually built):** `users/{uid}/moderationLog` and `moderationDisputes` from the original sketch were never built — there's no moderator role to write a log entry as, and no dispute flow without a human moderator's decision to dispute in the first place (same §14-role-system gap already flagged for reviews' dispute endpoint). `reports/{reportId}.decision` — the full Gemini output, including a `rationale` string — serves as the audit trail instead, in one place rather than scattered per-user logs. See [hld.md](hld.md) §14 and [api-contracts.md](api-contracts.md) §12.

**Implementation note (confidence-threshold capping):** `decision` always keeps Gemini's raw, uncapped suggestion. When `decision.confidence < 0.7` and `decision.accountAction` was a severe one (`restrict`/`suspend_temporary`/`suspend_permanent`), the account action actually applied is capped to `"warn"` — `appliedAccountAction` records that effective value, and `flaggedForReview` is set so the report is still findable for human monitoring even though no moderator queue/dashboard exists to push it to (query `flaggedForReview == true` directly, or check server logs). `contentAction` is never capped.

---

## 6. Composite indexes required

Firestore auto-indexes every single field; composite indexes are only needed where a query filters/sorts on more than one field at once, or combines an array-contains(-any) with anything else. Walking the actual queries traced in the HLD:

| Collection | Index | Powers |
|---|---|---|
| `movies` | `genres` (array-contains-any) + `voteAverage` (desc) | §6 content-based recommendations |
| `movies` | `originalLanguage` (asc, `in`) + `voteAverage` (desc) | §13 onboarding's Watched-step candidates, language-only branch |
| `events` | `geohash` (asc) — single-field, auto-indexed | §9 nearby-events range query. **Implementation note:** built as a single-field `geohash` range query, not the originally-planned `visibility`+`geohash` composite — a caller-specific private-event check (host, or in `invitedUserIds`) can't be expressed as one shared equality filter across all callers anyway, so visibility is filtered in-app on the range query's results instead, same simplification §5a already uses for its own following-list fan-out |
| `events` | `visibility` (asc) + `datetime` (asc) | `GET /events/upcoming` (api-contracts.md §8) — Home's "Upcoming watch events" |
| `events` | `movieId` (asc) + `visibility` (asc) + `datetime` (asc) | "Watch parties for this movie" — the movie detail screen's events entry point, replacing the old per-movie room concept (§16). Movie Detail itself now ships; this movie-scoped events section is still a later item, so the query itself isn't wired up yet |
| `activity` | `uid` (`in`) + `createdAt` (desc) | `GET /home/activity` (api-contracts.md §7b) — "Friends are watching", fanned out across the caller's `following` list |
| `reports` | `status` (asc) + `createdAt` (desc) | §14b moderator queue |
| `users/{uid}/notifications` | `read` (asc) + `createdAt` (desc) | §17 in-app feed, unread-first |
| `movies/{movieId}/reviews` | `deleted` (asc) + `createdAt` (desc) | `GET /movies/:movieId/reviews` (api-contracts.md §3) — public review list, newest first, excluding soft-deleted |

Everything else (`movies` sorted only by `voteAverage`, `rooms/{roomId}/messages` ordered by `createdAt`, `tasteMatches` ordered by `score`, all the point-reads by known doc ID) is a single-field query or a direct key lookup — Firestore's automatic indexing already covers those, nothing to declare.

---

## 7. Security Rules — shape, not full syntax

Per §10/§16's principle: **the backend uses the Admin SDK, which bypasses Security Rules entirely** — rules only govern direct client access. Given almost everything in this schema goes through the validated backend (§10), the rules file is mostly deny-by-default, with exactly two carve-outs for the two places §16/§17 established direct frontend reads:

```
match /databases/{database}/documents {

  match /rooms/{roomId} {
    allow read: if request.auth.uid in resource.data.memberIds;
    allow write: if false;                 // backend (Admin SDK) only

    match /messages/{messageId} {
      allow read: if request.auth.uid in get(/databases/$(database)/documents/rooms/$(roomId)).data.memberIds;
      allow write: if false;
    }
  }

  match /users/{uid}/notifications/{notificationId} {
    allow read: if request.auth.uid == uid;
    allow write: if false;
  }

  match /{document=**} {
    allow read, write: if false;           // everything else: backend only
  }
}
```

**Question for you:** should `movies` also get an open client-read rule? Nothing in the HLD currently has the frontend reading Firestore movie docs directly — the detail page (§2) and search (§18) both go through the backend/Vertex AI Search — so I've left it deny-by-default like everything else. Worth confirming that's still true before this becomes the actual rules file, since it's an easy thing to silently get wrong later if a frontend dev reaches for a "quick" direct read.

---

Next natural piece, if you want to keep going: **API contracts** (the backend endpoints themselves — request/response shapes for each flow) — the last stage in the original HLD → conceptual model → concrete schema → API contracts sequence.
