# ZATLAN — Product Requirements Document

**Project:** ZATLAN  
**Program:** Pachamama 2026  
**Status:** Prototype / Build Phase  
**Document Status:** Updated — HLD walkthrough decisions incorporated (streaming availability, follow/social model, recommendations, watch-party scope, movie rooms, location discovery, search, notifications, block/mute); AI-assisted content moderation and future monetization added. See [docs/hld.md](hld.md) for the full technical design and flow-level detail behind these decisions.  
**Last Updated:** 2026-08-26

---

# 1. Product Overview

ZATLAN is a social movie platform designed to help people discover movies, connect with people who share their movie interests, and turn watching a movie into a shared social experience.

The core idea behind ZATLAN is:

> **"I want to watch this movie. Who else wants to watch it with me?"**

ZATLAN combines:
- Movie discovery
- Movie metadata
- Personal movie activity
- Recommendations
- Social discovery
- Watch parties
- Location-based discovery
- Movie discussion rooms
- Communities

The long-term goal is to connect the **movie graph** with the **social graph**.

---

# 2. Problem Statement

Movie discovery platforms are good at helping users find information about movies, ratings, reviews, and recommendations.

However, deciding what to watch is often only part of the problem.

People may also want to:
- Find others who have watched the same movie
- Find people with similar movie tastes
- Find someone to watch a movie with
- Organize online or in-person watch parties
- Discuss movies before, during, and after watching
- Discover movie-related events nearby

ZATLAN aims to bring these activities together into a single social movie experience.

---

# 3. Product Vision

ZATLAN aims to evolve movie watching from an individual activity into a social experience.

The core experience is:

```text
Discover a movie
      ↓
Discover people
      ↓
Decide to watch
      ↓
Create / join a watch event
      ↓
Watch together
      ↓
Discuss afterwards
```

---

# 4. Target Users

The initial target users are people who:
- Regularly watch movies or TV series
- Enjoy discussing movies
- Want personalized movie recommendations
- Want to discover people with similar movie interests
- Are interested in online or in-person watch parties
- Want to discover movie-related activities and communities

Exact target age range and demographic segmentation are currently **TBD**.

---

# 5. Core Features

## 5.1 Movie Discovery

Users should be able to:
- Search for movies and series
- View movie information
- View ratings
- Like movies
- Read and write reviews
- Browse by genre
- Browse by language
- Browse by region
- Maintain a watched list
- Maintain a watchlist
- Receive recommendations

### Expected user flow

```text
Search
  ↓
Movie results
  ↓
Movie details
  ↓
Watch / Watchlist / Rate / Review
```

---

# 6. Movie Information

Movie detail pages should provide rich information such as:
- Title
- Synopsis / overview
- Poster
- Backdrop
- Genres
- Languages
- Region
- Release information
- Rating
- Cast
- Crew
- Other available metadata

TMDB is the confirmed source for this rich, user-facing information (synopsis, poster, backdrop, genres, cast, crew, release info). IMDb/BigQuery is not used for posters or synopsis — see §16.

**Decision — trailer playback redirects to YouTube, no embedded player.** TMDB's `videos` endpoint returns a YouTube video id (`trailerKey`) for the official trailer; the play button opens `youtube.com/watch?v={trailerKey}` in a new tab (web) / the system browser or YouTube app if installed (mobile), rather than an embedded in-app player. Simpler, no video-player component to build or maintain, and YouTube's own links already resolve into its native app automatically where installed — no custom deep-link handling needed on ZATLAN's side. The user stays on ZATLAN underneath (new tab/external app), so returning to the movie page after watching is a simple back/switch, not a lost place in the flow.

---

# 7. Streaming Availability

ZATLAN should help users identify where a movie is available to watch.

Example:

```text
Where can I watch?

Netflix
Prime Video
JioHotstar
Airtel Xstream
...
```

**Decision:** sourced from TMDB's `watch/providers` endpoint — already-available data through the TMDB integration, no separate vendor. Refreshed on its own (shorter) cycle from the rest of a movie's cached data, since streaming catalogs rotate far more often than posters/synopsis/cast — showing a platform a title already left is a more visible failure than slightly stale metadata.

**Decision — single hardcoded region for the prototype:** India, matching the example above. Real region detection (user location/profile-based) is a future enhancement, not required for MVP.

A future concept is:

> One ZATLAN login that provides access across multiple streaming services.

This is considered a **future integration** and is not part of the core prototype.

---

# 8. User Profiles

Users should have profiles containing movie-related information such as:
- Watched movies
- Watchlist
- Ratings
- Reviews
- Favourite movies
- Movie preferences
- Favourite genres/languages
- Social connections
- Events
- Communities

Users should also have privacy/security preferences.

**Decision — privacy model, resolved:**
- Watched-list visibility is a per-user toggle (default: visible), layered with a **per-entry override** — an individual title can be marked private even when the rest of the list is public (e.g. a user doesn't want one specific watch known, without hiding their whole history).
- Following someone can require the target user's approval (a per-user setting, default: off — open follow, Instagram-style) before it becomes an active relationship.
- Users can **block** another user (severs any existing follow relationship both directions; neither can see or interact with the other afterward) or **mute** one (lighter — hides their content from the muter's view only, no effect on the muted user).

**Decision — account creation:** handled by Firebase Authentication directly (frontend talks to it, not the backend); a ZATLAN profile document is created automatically on first login after sign-up, with the privacy defaults above. Onboarding may optionally ask for a few favorite genres to bootstrap recommendations, but this isn't required — new users without any signal get a trending/popular fallback instead.

**Decision — passwordless, three sign-in paths.** ZATLAN never collects or stores a password. Sign-in is: **Google OAuth, Microsoft OAuth** (both native Firebase Authentication providers, zero extra backend work), and **Email + OTP** for users without either account — a typed one-time code sent to their email, verified server-side, never a password. The OTP path is a real new integration (Firebase's own passwordless option is a click-through email link, not a typed code — see [docs/hld.md](hld.md) §13 for the custom generate/hash/verify/custom-token flow it needs), not just a config change. Apple Sign-In was considered and deferred in favor of Microsoft. Passkey (WebAuthn) sign-in remains deferred — Firebase Authentication has no native passkey provider as of mid-2026, so adding it means a real new integration (a third-party Firebase Extension or a custom WebAuthn implementation).

**Decision — accent theme is user-selectable, locked down.** ZATLAN's UI uses a glowing accent color (dark base, one color carrying the CTA/rating/highlight moments) rather than a flat/muted palette — it should feel energetic, not corporate. **Six accent options ship at launch, chosen and finalized by the user: emerald (default), cyan, purple, pink, amber, red** — a per-user setting (`accentTheme`), same shape as `themePreference` above. Pink was deliberately lightened (`#FF7AC2`, not a deeper rose) after review found it too close to red at a glance — the two need to stay visually distinct as separate theme choices. **TMDB's rating is always a fixed neutral white/gray**, never themed — only the ZATLAN rating *number*, the primary CTA, and a handful of other explicitly-chosen elements (the "Watch Together" action, Write a review / Create a watch party / Join buttons, the Home nav highlight) carry the selected accent, so theming stays deliberate rather than spreading to every colored pixel on screen. **One deliberate exception: every star icon (ZATLAN's rating star, review-card stars) is a fixed gold (`#FFC107`), not themed** — ratings get the universal "gold star" convention users already recognize from every other rating surface (App Store, Play Store, Amazon, etc.), while the number next to it still carries ZATLAN's chosen brand color. This was an explicit call weighed against the earlier decision to avoid IMDb's specific brand color (`#F5C518`) — a small gold star icon is a near-universal UI convention that predates and outlives any one app's branding, unlike making gold ZATLAN's actual primary/dominant color the way it is IMDb's. See the design canvas referenced from this project for the full exploration history (flat colors, magenta, chartreuse, cyan-as-primary) and why each was rejected before landing here.

---

# 9. People Discovery

One of ZATLAN's important social features is discovering people based on shared movie interests.

For a movie, users should be able to see:

> **People who watched this movie**

ZATLAN should eventually support discovery such as:

> "People with similar movie tastes who watched this movie."

Example:

```text
Interstellar

People who watched this:

User A
87% taste match

User B
82% taste match

User C
79% taste match
```

**Decision — follow model:** one-directional, Instagram-style (following someone doesn't require or imply they follow back). "People who watched this movie" is scoped to **who the caller follows**, never a global list — surfacing activity from people who follow the caller but aren't followed back would show content the user never opted into seeing. Still governed by the per-user and per-entry privacy settings in §8.

**Decision — taste-matching algorithm:** overlap of watched movies + shared genres, computed as a scheduled batch job (not live per-request), since comparing one user's activity against every other user's isn't something to recompute on every page view. Results are precomputed and served fast on read.

---

# 10. Recommendations

ZATLAN should provide personalized movie recommendations.

Potential recommendation signals include:

### Movie/content signals
- Genre
- Language
- Region
- Director
- Cast
- Movie characteristics
- Ratings
- Similar movies

### User behaviour signals
- Watched movies
- Watchlist
- Likes
- Ratings
- Reviews
- Event participation
- Other user interactions

**Decision:** the initial (P0) system is content-based — genre overlap with the user's watched/highly-rated movies, computed live on request, with a trending/popular fallback for users with no history yet (every new user hits this on first use, so it's part of the design, not an edge case). Distinct from the user-to-user taste-matching in §9, which is a separate, precomputed signal.

**Noted for later:** a precomputed, embedding-based approach (using semantic similarity rather than genre overlap) is a planned upgrade path, not required for the prototype.

---

# 11. Events & Watch Parties

Users should be able to create and join movie watch events.

Events may support:
- Public events
- Private events
- Online events
- In-person events
- Scheduled events
- Recurring events
- Participant limits
- Approval requirements

Example:

```text
Tamil Thriller Night

Saturday · 8:00 PM

6 / 10 participants

Chennai

In-person
```

**Decision — private event access, resolved:** every private event gets an auto-generated join link/code (always on); the host can additionally invite specific users directly, as an optional layer on top rather than a competing mode. An event's custom title (if the host sets one) is independent of the movie's own title — not a duplicate field, an optional override for display.

---

# 12. Watch Together

**Decision — MVP scope is presence only:** live "X people watching now" for an event's movie room, via Firebase Realtime Database (`onDisconnect()`-based, so presence updates instantly when someone's connection drops — no polling). No playback control, no synchronization.

**Decision — full Teleparty-style playback sync (play/pause/seek across streaming platforms) is explicitly Phase 2, out of scope for the Pachamama submission**, investigated and documented, not just deferred by default:
- **No official API/SDK path exists** for a third-party consumer app on any of Netflix, Prime Video, or JioHotstar — their partner programs are for certified hardware/device manufacturers, a different relationship than ZATLAN would have. Not a pricing-tier problem; structurally unavailable regardless of paid-platform status.
- **Confirmed mechanism, if pursued later:** an app-owned embedded browser (WebView/WebView2/CEF) loads the platform's real site, the user authenticates directly with the platform (confirmed technique — real OTP login), and injected code synchronizes the embedded player. This only works inside a **native app** — ZATLAN's web frontend cannot do this (cross-origin/embedding restrictions block a website from controlling another website's content) — meaning Phase 2 is a second product (native Android/Windows, optionally iOS), not a backend feature addition.
- **Real blockers:** per-platform DRM provisioning (Widevine/FairPlay), per-platform player reverse-engineering maintained indefinitely and fragile to platform UI changes, active adversarial detection by the platforms, and real legal/ToS exposure (DRM-circumvention-adjacent) that compounds if ZATLAN becomes a paid/commercial platform.

Full analysis and the confirmed mechanism are in [docs/hld.md](hld.md) §11 and §15.

---

# 13. Persistent Movie Rooms

Every movie may have a persistent discussion room.

The room can be used:

### Before the movie
- Find participants
- Discuss plans
- Decide when to watch

### During the movie
- Chat
- Reactions
- Discussion

### After the movie
- Discuss the movie
- Share opinions
- Debate the ending
- Continue the conversation

The important concept is:

> **The room does not disappear when the movie ends.**

**Decision — one persistent room per movie, not per event.** Any event created for the same movie funnels into that movie's single shared room — matching the flow `Create/join event → Enter movie room → Continue discussion`. Delivered via Firestore's real-time listeners (`onSnapshot`), not a custom WebSocket layer — a built-in Firestore capability, not new infrastructure. Writes go through the backend as usual (validated, and blocked for restricted/suspended accounts); reads subscribe directly from the frontend to Firestore, secured by Firestore's own Security Rules rather than backend code — the one place in the architecture where read-side authorization lives outside the backend.

---

# 14. Location-Based Discovery

ZATLAN should support discovery based on location and time.

Users may search/discover based on:
- Movie
- Director
- Genre
- Location
- Time
- Nearby events
- Virtual/in-person

Examples:

> "What movie events are happening near me tonight?"

> "Who wants to watch this movie in Chennai?"

> "Find horror movie events within 5 km."

Location privacy must be treated as a first-class consideration.

**Decision — scoped to nearby events only for the prototype; "nearby people" is parked as a separate, harder feature** requiring a much coarser (city-level, not GPS-precise) design to satisfy the location-privacy requirement above. Firestore has no native radius/proximity query, so events are geohash-indexed and queried via geohash-range approximation — a technique, not a new component. Nearby-search results are always filtered through the same event visibility rules as everywhere else (public, or private events the caller can already see) — a naive radius query would otherwise leak a private event's existence/location to any nearby stranger. Google Maps' API key is safe to use client-side (unlike TMDB's) — it's designed for frontend embedding, secured via domain restriction rather than secrecy.

---

# 15. Communities & Forums

ZATLAN may support user-created communities similar to subreddit-style communities.

Potential capabilities:
- Create communities
- Join communities
- Create posts
- Comment/discuss
- Community moderators
- Community rules
- Topic-specific movie communities

Examples:

```text
Tamil Cinema
Horror Movies
Korean Cinema
Christopher Nolan
90s Movies
```

A full community/forum system is considered lower priority for the prototype and should not delay the core ZATLAN experience.

---

# 16. Data Strategy

No single external movie dataset needs to provide everything — each source has a defined, non-overlapping responsibility.

## 16.1 IMDb / BigQuery — Analytics Only (revised — no longer used for live rating display)

The IMDb dataset was investigated as a potential movie-data foundation. It does not provide the information ZATLAN's movie discovery experience needs for presentation, particularly:
- Movie posters/images
- Backdrop images
- Movie synopsis/overview

**Decision — superseded:** IMDb rating was originally planned for live display, but the public BigQuery IMDb dataset is stale (not kept current), and TMDB's API doesn't expose IMDb's actual rating value at all (only an `imdb_id` for cross-referencing) — so refreshing "IMDb rating" from BigQuery would never have produced a fresher number, only a differently-stale one. **TMDB's own rating (`vote_average`) is shown in the product instead; IMDb rating is dropped from live display entirely.**

**Confirmed use of IMDb/BigQuery going forward: analytics only**, off the live request path entirely — feeding the batch taste-matching job (§9) and future recommendation-signal analysis. Not used for anything a user sees on a page load.

See [docs/imdb-data-analysis.md](imdb-data-analysis.md) for the full IMDb dataset analysis.

## 16.2 TMDB — Rich Movie Information (confirmed)

TMDB API is the primary, confirmed source for rich, user-facing movie information:
- Movie details
- Synopsis / overview
- Posters
- Backdrops
- Genres
- Cast
- Crew
- Languages
- Release information
- Other available movie metadata
- Images

**Security decision:** TMDB credentials (read access token / API key) must remain on the backend only — the React frontend never calls TMDB directly.

TMDB API usage will be subject to TMDB's API terms and attribution requirements (see §27).

## 16.3 ZATLAN Ratings vs. TMDB Ratings

ZATLAN ratings must remain distinct from the third-party rating shown alongside a movie — displayed separately, not merged into one score. (Originally scoped as "IMDb rating" — superseded by §16.1: the displayed third-party rating is TMDB's, not IMDb's.)

Example:

```text
TMDB: 8.7 / 10
ZATLAN: 4.6 / 5
```

## 16.4 ZATLAN-Generated Data

ZATLAN will generate its own application and social data, including:
- Users
- Profiles
- Watched history
- Watchlists
- Likes
- Ratings
- Reviews
- Events
- Event participation
- Social relationships
- Discussions
- User preferences

---

# 17. Data Architecture

Revised from the original direction — IMDb/BigQuery is analytics-only and explicitly **off** the live backend path (§16.1), not a live input to it:

```text
        TMDB ──────────────┐
                            ▼
                      ZATLAN Backend ──── Firestore ──── User / Social Data
                            │                │
                            ▼                ▼
                         Gemini      (movies collection = ZATLAN Movie DB)

        IMDb → BigQuery ── (analytics only — batch jobs, disconnected from the live path above)
```

**ZATLAN Movie DB is a Firestore collection** (`movies`), not a separate database — same store as everything else, no reason found yet to split it out. See §17.1.

## 17.1 Movie Data Request Flow

ZATLAN does not call TMDB every time a user opens a movie. ZATLAN maintains its own persistent movie database, checked before falling back to TMDB:

```text
User
 ↓
ZATLAN Backend
 ↓
Cache
 ├── HIT → Return
 │
 └── MISS
       ↓
   ZATLAN Movie DB
       ├── HIT → Return
       │
       └── MISS
             ↓
          TMDB API
             ↓
       Store in ZATLAN DB
             ↓
       Populate cache
             ↓
           Return
```

Responsibilities:
- **Cache** — performance, reduces repeated reads/API calls
- **ZATLAN Movie DB** — persistent, application-level source of truth for movie records ZATLAN has already imported
- **TMDB** — external source consulted only when ZATLAN does not yet have the requested movie/data

## 17.2 Automatic Movie Ingestion

ZATLAN does not manually add every movie, and does not need to import the entire TMDB catalogue for the prototype. Initial approach: **on-demand ingestion**, so the ZATLAN movie database grows organically based on what users actually search for.

```text
User searches for a movie
        ↓
Check cache → miss
        ↓
Check ZATLAN Movie DB → miss
        ↓
Search TMDB → found
        ↓
Fetch required TMDB details
        ↓
Store in ZATLAN DB
        ↓
Populate cache
        ↓
Return to user
```

**Future (not required for MVP):** scheduled synchronization for newly available movies and changed metadata, potentially using TMDB's daily ID exports and change-tracking mechanisms.

**Correction — this flow is for a movie the user has already selected, not for search/discovery.** Originally conflated; corrected in §17.5. On-demand ingestion only pulls a movie into Firestore once someone already knows about it and opens its page — if search relied only on what's already ingested, nothing new could ever be *found* in the first place. Search now has its own, separately-populated index (§17.5).

## 17.5 Search / Discovery Index

**Decision:** the search index is **bulk-seeded on a schedule**, fully decoupled from the on-demand, per-movie detail ingestion above — a batch job pulls a broad slice of the TMDB catalog and indexes it upfront and periodically, so search always hits ZATLAN's own pre-populated index and never calls TMDB live. §17.2's on-demand flow still runs, but only once a specific result is selected, fetching the full detail record.

**Decision — Vertex AI Search (Media vertical), not a non-Google search service.** Algolia, Typesense, and Meilisearch are not Google products; Vertex AI Search is a genuine Google Cloud product with a vertical built for content-catalog search specifically, so per ZATLAN's Google-first mandate it's the correct first candidate. $300 in available GCP credit covers testing it; exact pricing at scale is being verified before full commitment. **Fallback if it proves too costly/complex:** Firestore word-prefix indexing (titles indexed as arrays of word-level prefixes, queried via `array-contains`) — weaker typo tolerance, but fully Google-native (just Firestore) and free.

## 17.3 IMDb ↔ TMDB Identifier Mapping

Where possible, records are connected using stable identifiers — TMDB supports lookup by IMDb ID.

```text
IMDb ID
   │
   ├── IMDb data from BigQuery (analytics only — §16.1, never the live rating shown to users)
   │
   └── TMDB movie record
          ├── synopsis
          ├── poster
          ├── backdrop
          ├── genres
          ├── cast
          ├── TMDB rating (the rating actually shown — §16.1)
          └── other metadata
```

This lets ZATLAN combine useful parts of both sources without duplicating responsibilities.

## 17.4 Architectural Principle: Not a Thin TMDB Client

ZATLAN is **not** a thin TMDB client — it is its own movie/social platform:

```text
TMDB              → rich movie information + the rating actually shown: posters, backdrops, synopsis,
                      genres, cast/crew, metadata, TMDB rating
IMDb + BigQuery    → analytics only, off the live path: vote data, structured IMDb data,
                      taste-matching signals (§9)
ZATLAN Database      → movie records used by ZATLAN: users, watchlists, watched history, ratings, reviews,
                      events, social graph, chat, notifications
BigQuery           → analytics, recommendation signals, user behaviour, social/taste analysis
Gemini             → AI-powered functionality
Vertex AI Search   → movie search/discovery index (§17.5)
```

---

# 18. Technology Stack

## Frontend
- React
- TypeScript
- Vite
- Firebase SDK
- Google Maps integration

## Backend
- Node.js
- TypeScript
- Express or Fastify
- Cloud Run

## Application Database

### Firestore

Used for:
- Users
- Profiles
- Following/followers, blocked/muted
- Watchlists
- Watched movies
- Ratings
- Reviews
- Events
- Social relationships
- Chat rooms (movie rooms) — real-time via Firestore listeners, no separate WebSocket layer
- Messages
- Notifications feed
- **The movie catalog itself** (`movies` collection — see §17)

### Firebase Realtime Database

Used specifically for **live presence** ("who's watching now," §12) — Firestore has no built-in disconnect detection; RTDB's `onDisconnect()` is Firebase's own recommended pattern for this, even in apps that use Firestore for everything else. Not used for general app data.

### Firebase Cloud Messaging (FCM)

Push notification delivery. See §22 for confirmed notification triggers.

### Vertex AI Search (Media vertical)

Movie search/discovery index, bulk-seeded from TMDB on a schedule. See §17.5.

## Analytics / Data Platform

### BigQuery

Used for:
- Movie datasets
- IMDb data
- External movie data analysis
- User behaviour analytics
- Recommendation analysis
- Social/taste analysis

---

# 19. Google Cloud Services

## Core Google Services

### BigQuery
Primary data and analytics platform.

Use cases:
- Movie data
- Large-scale analysis
- Recommendation signals
- User behaviour analytics
- Data-driven insights

### Firebase / Firestore
Application database and backend services.

### Firebase Authentication
User authentication and identity.

### Cloud Run
Deploy and host the Node.js backend.

### Gemini / Google AI Studio
Potential use cases:
- Natural-language movie discovery
- AI-assisted recommendations
- Movie/social insights
- Personalized experiences

The exact Gemini functionality will be finalized based on the MVP.

### Google Maps Platform
Used for location-based discovery and event locations. Client-side API key is safe to expose in the frontend (unlike TMDB's) — secured via domain restriction, not secrecy.

### Firebase Realtime Database
Live presence only (§12) — a small, low-overhead addition to the same Firebase project, not a new vendor.

### Firebase Cloud Messaging (FCM)
Push notification delivery (§22).

### Vertex AI Search (Media vertical)
**Decision — moved from "Potential" to confirmed, pending pricing verification.** Search/discovery index for the movie catalog (§17.5). A genuine Google Cloud product purpose-built for content-catalog search, preferred over non-Google alternatives (Algolia/Typesense/Meilisearch — none are Google products) per ZATLAN's Google-first mandate. $300 in available credit is being used to verify actual cost at scale before final commitment; Firestore-based search is the documented fallback if it proves impractical.

## Potential Google Cloud Services

These services will only be introduced if they provide meaningful value:
- Pub/Sub — asynchronous processing, notifications, event processing, data pipelines
- Looker / Looker Studio — product analytics and insights
- Vertex AI (general ML/recommendation models, distinct from Vertex AI Search above) — advanced recommendation models and machine learning
- ADK — agentic AI functionality
- MCP Toolbox for Databases — AI/database interaction

We will not add services simply to increase the number of Google technologies used.

---

# 20. Development Methodology — TDD

ZATLAN will be developed using **Test-Driven Development (TDD)**.

For each feature:

```text
Define expected behaviour
        ↓
Write failing test
        ↓
Implement minimum functionality
        ↓
Make test pass
        ↓
Refactor
        ↓
Add/maintain integration tests
```

---

# 21. Testing Strategy

## Unit Tests
Test:
- Business logic
- Validation
- Recommendation calculations
- Data transformations
- Utility functions

## Integration Tests
Test:
- API/database interactions
- Authentication
- Firestore operations
- BigQuery interactions
- External service integrations

## Frontend Tests
Test:
- React components
- Important user interactions
- UI states

## End-to-End Tests

### Movie discovery

```text
Login
  ↓
Search movie
  ↓
View movie
  ↓
Add to watchlist
  ↓
Rate/review
```

### Social/watch-party flow

```text
Login
  ↓
Find movie
  ↓
Find interested people
  ↓
Create/join event
  ↓
Enter movie room
  ↓
Continue discussion
```

## Regression Testing

The complete test suite will be executed before major checkpoints and final submission.

Testing will happen continuously throughout development rather than being postponed until the end.

---

# 22. MVP Scope

The prototype should prioritize a coherent end-to-end experience.

## P0 — Core
- Movie search (Vertex AI Search, bulk-seeded from TMDB — §17.5)
- Movie details
- TMDB rating (superseded "IMDb rating" — §16.1)
- ZATLAN ratings
- Likes
- Reviews (with optional per-review anonymity — hidden display name, still attributed server-side for moderation)
- Watched list (with per-entry privacy override)
- Watchlist
- Recommendations (content-based, live, with cold-start trending fallback)
- User profiles (onboarding via Firebase Auth + auto-created profile; passwordless OAuth/social sign-in only — §8)
- People discovery (one-directional follow, precomputed taste-matching)
- Watch events (dual private-access: join link + optional direct invite)
- Streaming availability (TMDB `watch/providers`, hardcoded to India for the prototype)

## P1 — Important Social Experience
- Location-based discovery (events only — "nearby people" parked, see §14)
- Persistent movie rooms (one per movie, Firestore real-time listeners)
- Chat
- Presence ("X people watching now" — §12)
- Notifications (push via FCM, in-app feed, email with opt-out) — confirmed triggers: follow requests, event join requests/approvals, moderator actions against you; more added as identified
- Block / mute
- Moderator reporting & platform-level enforcement (role via Firebase custom claims; community-moderator delegation deferred with Forums below)
- Gemini-powered functionality
- Context-aware AI content moderation (§30.8) — Gemini-based triage layer flagging likely violations; human enforcement ladder (§30.6) unchanged

## P2 — Future / Advanced
- Teleparty-style synchronized playback — investigated and documented (§12); confirmed to require a **separate native app**, not a backend feature
- One-login access to multiple streaming platforms
- Full Reddit-style forum system (community-moderator delegation deferred alongside it)
- Complex streaming integrations
- "Nearby people" discovery
- "Movies none of us have watched" filter (new idea, not yet designed in detail — see [docs/hld.md](hld.md) §11)
- **Additional content types — TV series and books.** ZATLAN starts movies-only for the prototype, but the direction is to become a "what do we watch/read together" platform, not only movies. Series come first (same TMDB source, same catalog/rooms/events model, adds season/episode structure); books follow as a separate media type with its own metadata source. The signed-in discovery surface already carries a "Series and books — coming soon" banner so users don't read the movies-only catalog as a gap. Not scoped in detail yet; parked until the current build is tested and stable.
- Monetization — Google Ads integration as a future revenue layer, must not compromise privacy/safety/core experience (§31)
- Passkey (WebAuthn) sign-in, alongside OAuth — deferred since Firebase Authentication has no native passkey provider yet (§8, [docs/hld.md](hld.md) §11)

P2 features must not delay the core ZATLAN prototype.

---

# 23. Core User Journey

```text
              Discover a Movie
                     ↓
             View Movie Details
                     ↓
              Add / Watch / Rate
                     ↓
              Get Recommendations
                     ↓
             Discover Similar People
                     ↓
             Create / Join Watch Event
                     ↓
                Movie Room
                     ↓
             Continue Discussion
```

---

# 24. Project Milestones

## Milestone 1 — Data & Product Foundation
**Target: August 23, 2026**

Scope:
- Complete IMDb data analysis
- Determine TMDB data requirements
- Map data against ZATLAN features
- Identify missing data
- Identify synthetic/ZATLAN-generated data
- Finalize MVP scope
- Finalize architecture
- Finalize Google Cloud services
- Define major database entities
- Establish TDD strategy

**Definition of Done:** We know what we are building, what data powers it, and how we are going to build it.

## Milestone 2 — Platform Foundation
**Target: August 26, 2026**

Scope:
- React + TypeScript frontend
- Node.js + TypeScript backend
- Firebase project
- Firebase Authentication
- Firestore
- BigQuery
- Movie data integration
- Cloud Run
- Test environment
- Frontend/backend/database integration

**Definition of Done:** A user can authenticate and the basic ZATLAN frontend, backend, database and Google Cloud infrastructure work together.

## Milestone 3 — Core Movie Experience
**Target: August 30, 2026**

Scope:
- Movie search
- Movie details
- Movie metadata
- Ratings
- Likes
- Reviews
- Watched list
- Watchlist
- Initial recommendation system

All features developed using TDD.

**Definition of Done:** A user can login → search → view a movie → add to watched/watchlist → rate/review → receive recommendations.

## Milestone 4 — Social Movie Experience
**Target: September 4, 2026**

Scope:
- User profiles
- People who watched a movie
- Similar movie taste discovery
- Watch events
- Public/private events
- Online/in-person events
- Location-based discovery
- Movie rooms
- Chat
- Persistent discussion
- Useful Gemini functionality

**Definition of Done:** A user can find a movie → discover interested people → create/join a watch event → find people online/nearby → enter a movie room → continue discussing afterwards.

## Milestone 5 — Final Testing, Polish & Submission
**Target: September 7, 2026**

Scope:
- Unit testing
- Integration testing
- E2E testing
- Regression testing
- Edge cases
- Security checks
- Performance checks
- Bug fixing
- UI/UX polish
- Cloud deployment
- Analytics/insights
- Documentation
- Demo preparation
- Pachamama submission

**Internal deadlines:**
- September 5 — Feature complete
- September 6 — Stabilization and final polish
- September 7 — Submission

**Definition of Done:** ZATLAN works end-to-end, critical flows are tested, the prototype is deployed and presentable, and the project is ready for Pachamama submission.

---

# 25. Pachamama Timeline

| Date | Milestone |
|---|---|
| August 15 | Build Phase Started |
| August 20 | First Checkpoint |
| August 23 | Data & Product Foundation |
| August 26 | Platform Foundation |
| August 28 | Second Checkpoint |
| August 30 | Core Movie Experience |
| September 4 | Social Movie Experience |
| September 5 | Final Checkpoint / Feature Complete |
| September 6 | Stabilization & Final Polish |
| September 7 | Submission Lock |
| September 10 | Results |
| September 24 | Finale |

---

# 26. Success Criteria

ZATLAN should demonstrate:
1. A meaningful movie-data foundation.
2. A working movie discovery experience.
3. Data-driven recommendations or social discovery.
4. A meaningful social movie experience.
5. Watch events and movie discussion.
6. Meaningful use of Google Cloud technologies.
7. Useful application of Gemini/AI where appropriate.
8. TDD-backed core functionality.
9. A working end-to-end prototype.
10. A clear path from prototype to a larger social movie platform.

---

# 27. External Data Attribution

ZATLAN will properly attribute external data providers used by the application.

Potential sources include:
- TMDB
- IMDb
- JustWatch, if applicable through streaming-provider data

Attribution requirements will be implemented according to the applicable provider's current terms.

For TMDB, the application will include the required attribution and identify that ZATLAN uses the TMDB API.

---

# 28. Open Decisions / TBD

Most items previously listed here were resolved during the HLD walkthrough — see [docs/hld.md](hld.md) for the full reasoning behind each. Genuinely still open:

- Exact Gemini use cases
- Final Firestore schema (field-level detail — the HLD establishes collection shapes and patterns, not a formal schema doc yet)
- Whether additional public or synthetic datasets are required
- Exact cache technology for §17.1 (in-memory, Redis/Memorystore, or Firestore-based) — the cache's existence and role are decided, its implementation isn't
- How much automatic TMDB synchronization to implement beyond on-demand ingestion
- **Vertex AI Search pricing/feasibility at scale** — being verified against available GCP credit; Firestore word-prefix search is the fallback (§17.5)
- Region detection for Streaming Availability beyond the hardcoded India default (§7)
- Full notification-trigger list beyond the three confirmed (§22) — more added as identified during build

Resolved and removed from this list since the last update: movie data-source combination, TMDB/IMDb integration strategy, streaming availability data source, recommendation algorithm (P0 scope), privacy model, user-matching/taste algorithm, event permissions, whether forums are in the prototype (they're not — P2), whether Maps is P0/P1 (P1).

---

# 29. Guiding Principle

ZATLAN should not attempt to become every movie product at once.

The prototype should prove one strong idea:

> **ZATLAN helps people discover not only what to watch, but who to watch it with.**

The movie database provides the foundation.

The user data creates the social graph.

The combination creates the ZATLAN experience.

---

# 30. Community Safety & Platform Conduct

## 30.1 Core Principle

ZATLAN is a social movie platform. The purpose of social interaction on ZATLAN is to help people connect around movies, shows, watch parties, discussions, and shared interests.

Chat rooms, forums, events, and user profiles must be designed and moderated to support movie-related social interaction.

## 30.2 Prohibited Behaviour

ZATLAN should prohibit:
- Sexting or sexually explicit conversations
- Soliciting or requesting sexual content
- Sharing sexually explicit images or media
- Sexual solicitation or prostitution
- Using ZATLAN primarily as a dating/hookup platform
- Unwanted sexual advances or harassment
- Sexual comments directed at other users
- Sharing another person's private or intimate content
- Grooming or sexual exploitation
- Spam, scams, or malicious solicitation

Normal discussion of movies that contain sexual themes, relationships, or mature content is not automatically prohibited. The context should remain relevant to legitimate movie discussion.

## 30.3 Chat Room Rules

When creating a chat room or watch event, the creator must agree to ZATLAN's community rules.

The room should have:
- A clear movie/topic association
- A defined purpose
- Public/private visibility
- Participant controls
- Report functionality
- Block/mute functionality
- Moderator/admin controls where applicable

Private rooms are still subject to ZATLAN's Terms of Service and Community Guidelines.

## 30.4 Forum Rules

User-created communities/forums must have:
- A defined topic
- Community rules
- Moderation controls
- Report functionality
- Content removal capabilities
- User blocking/muting

Community creators and moderators are responsible for maintaining the community within ZATLAN's rules.

## 30.5 User Reporting

Users should be able to report: messages, users, reviews, forum posts, comments, chat rooms, events, communities.

Reports should support categories such as: sexual/explicit content, harassment, hate or abusive behaviour, spam/scam, threats, privacy violation, other inappropriate behaviour.

## 30.6 Enforcement

ZATLAN should support progressive moderation actions where appropriate:
1. Warning
2. Content removal
3. Temporary restriction
4. Temporary suspension
5. Permanent account suspension

Severe violations may result in immediate account suspension.

## 30.7 Privacy & Safety

ZATLAN should minimize unnecessary exposure of personal information.

Location-based features should use privacy-conscious defaults and should not expose a user's precise location to other users unless explicitly intended and consented to.

The exact moderation architecture, age requirements, and escalation process are **TBD** and should be finalized before the social/chat functionality is launched. Automated content detection is addressed in §30.8, below.

## 30.8 AI-Assisted Content Moderation

Resolves part of §30.7's "automated content detection" TBD.

ZATLAN should support **context-aware** content moderation — detecting vulgarity, sexual solicitation, harassment, and other behaviour prohibited under §30.2, while distinguishing that from **legitimate discussion of mature or sexual themes within a movie itself** (e.g. discussing a film's sexual-assault subplot, a director's explicit content, or a controversial scene). §30.2 already draws this distinction in prose; here it needs to be something a moderation system can actually apply, not just a human-readable guideline.

**Decision (P1):** if plain keyword/pattern-based detection proves insufficient to make that distinction reliably, ZATLAN will use an AI engine — an AI Agent — as the moderation layer. Context-aware judgment (is this message *about* a movie's content, or an actual solicitation happening in the room) is exactly the kind of task a keyword filter can't do but an LLM-based classifier can. Candidate approach: Gemini (already a confirmed ZATLAN technology, §19), applied to flagged/reported content and possibly to live message screening, rather than introducing a separate third-party AI vendor.

**Relationship to human moderation (§30.6):** AI-assisted detection is a **triage/flagging layer**, not a replacement for the human enforcement ladder already defined in §30.6 (warning → removal → restriction → suspension). Automated detection surfaces likely violations — e.g. auto-flagging into the report queue at higher priority, or auto-hiding content pending review for high-confidence cases — but a human moderator still makes the enforcement decision, consistent with [docs/hld.md](hld.md) §14b/§22, which already assume every enforcement action is moderator- or admin-initiated, not fully automated.

Exact detection scope (real-time message screening vs. report-triggered analysis only), false-positive handling, and whether Gemini or a separate AI Agent framework is used remain implementation details for the build phase — this section commits to the product requirement (context-aware moderation must exist), not the exact model/pipeline.

**Implementation note (added once this was actually built):** resolved as report-triggered analysis via Gemini, and — a deliberate escalation past this section's own "AI-assisted detection is a triage/flagging layer, not a replacement for human enforcement" framing — fully autonomous: there is no human moderator step at all. Gemini's decision (violates or not, what to do about it) executes immediately and directly. See [docs/hld.md](hld.md) §14 and [docs/api-contracts.md](api-contracts.md) §12 for the full design and why (no moderator-role system exists in this codebase to hand a flagged report off to).

## 30.9 Product Design Principle

ZATLAN should encourage:

> **"Find people who share your taste in movies."**

It should not encourage:

> **"Find people for sexual or romantic interactions."**

Social discovery, matching, events, chat, and forums should therefore remain anchored to the movie experience.

---

# 31. Monetization (Future)

ZATLAN's MVP and Pachamama submission are not monetization-focused — this section records a future direction, not a build requirement for the prototype.

**Decision — Google Ads integration is a candidate future monetization mechanism.** Consistent with ZATLAN's Google-first technology mandate (§19), Google Ads (e.g. AdSense/Ad Manager) is the natural first candidate over a non-Google ad network, if/when ZATLAN pursues monetization.

**Constraint — advertising is a separate layer, not woven into the core product:**
- Must not compromise user privacy — no ad-driven data sharing beyond what ZATLAN's own privacy model (§8, §30.7) already allows.
- Must not compromise user safety — ad content is still subject to §30's moderation/safety standards.
- Must not compromise the core movie/social experience — the product ZATLAN demonstrates for Pachamama (§3, §23) should not be shaped around ad placement.

Out of scope for the prototype (see §22 P2) — recorded here so it isn't lost, not because it's scheduled.

---

**ZATLAN — Stories are better together. 🍿**
