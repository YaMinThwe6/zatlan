# ZATLAN — Patchamomma 2026

## Project Overview

ZATLAN is a social movie platform designed to help people discover movies, connect with people who share their movie interests, and turn watching movies into a shared social experience.

The core idea is:

> **"I want to watch this movie. Who else wants to watch it with me?"**

ZATLAN combines movie discovery, personalized recommendations, social connections, watch events, location-based discovery, and movie discussion.

---

## Planned Features

### 1. Movie Discovery
- Search movies and series
- Movie information
- Ratings
- Likes
- Reviews
- Genre selection
- Language selection
- Region selection
- Watched list
- Watchlist
- Recommendations

### 2. Streaming Availability
- Show which streaming platforms a movie is available on.

### 3. User Profiles
- User profile
- Movie activity
- Watched movies
- Watchlist
- Ratings and reviews
- Privacy/security preferences

### 4. People Discovery
- See people who watched a particular movie
- Discover people with similar movie tastes
- Use shared movie interests for social discovery

### 5. Events / Watch Parties
- Public events
- Private events
- Recurring events
- Online events
- In-person events
- Find people interested in watching the same movie

### 6. Watch Together
- Future Teleparty-style synchronized viewing
- This is not a core MVP requirement and should not block the prototype.

### 7. Persistent Movie Rooms
- Movie-specific chat rooms
- Discussion before watching
- Interaction while watching
- Continue discussions after the movie ends

### 8. Multiple Streaming Platforms
- Future possibility of integrating multiple streaming services
- Example: Airtel Xstream
- One-login/multiple-platform access is considered a future integration and is not part of the core MVP.

### 9. Location-Based Discovery
Discover movies, people, and events based on:
- Movie
- Director
- Genre
- Location
- Time
- Virtual/in-person
- Nearby events

### 10. Forums / Communities
- User-created communities
- Subreddit-style discussions
- Community moderators
- Movie/topic-specific communities

---

# Technology Stack

## Frontend

- React
- TypeScript
- Vite
- Firebase SDK
- Google Maps integration

## Backend

- Node.js
- TypeScript
- Express/Fastify
- Cloud Run

## Database & Data

### BigQuery
Used for:
- IMDb dataset
- Movie data analysis
- Analytics
- Recommendation data
- User/movie behavioural analysis

### Firestore
Used for application data such as:
- Users
- Profiles
- Watchlists
- Watched movies
- Ratings
- Reviews
- Events
- Social relationships
- Chat rooms
- Messages

### Firebase Authentication
Used for:
- User registration
- Login
- Authentication
- Identity management

### Cloud Storage / Firebase Storage
Potentially used for:
- Profile pictures
- Event images
- Community images
- Other user-generated media

---

# Google Cloud Services

The project will prioritize Google technologies as part of Patchamomma 2026.

### Core Services

- **Google BigQuery** — IMDb data, analytics and recommendation analysis
- **Firebase / Firestore** — application database and user-generated data
- **Firebase Authentication** — authentication
- **Cloud Run** — backend/API deployment
- **Gemini / Google AI Studio** — AI-powered functionality
- **Google Maps Platform** — location-based discovery

### Potential Services

These will only be introduced if they provide real value to ZATLAN:

- **Pub/Sub** — asynchronous events and background processing
- **Looker / Looker Studio** — analytics and project insights
- **Vertex AI** — advanced ML/recommendation capabilities
- **ADK (Agent Development Kit)** — agentic AI functionality
- **MCP Toolbox for Databases** — allowing AI agents to interact with databases safely

We will avoid adding Google Cloud services simply for the sake of using more services.

---

# Data Strategy

## IMDb Dataset

The initial prototype will explore the IMDb dataset available through Google BigQuery.

The first priority is to analyze the actual dataset and determine:

- What movie information is available
- Which ZATLAN features it can support
- Which relationships exist between titles, people, genres, ratings, etc.
- What data is missing
- What additional public datasets may be required
- What data can reasonably be generated synthetically

## ZATLAN-Generated Data

ZATLAN will generate its own application/social data, including:

- User profiles
- Watch history
- Watchlists
- Likes
- Ratings
- Reviews
- Events
- Event participation
- Social connections
- Discussions
- User preferences

The IMDb dataset does not need to provide all of this.

The goal is to use IMDb as the **movie-data foundation** while ZATLAN generates the social and behavioural data.

---

# Recommendation Strategy

ZATLAN will eventually combine movie metadata and user behaviour.

### Content-based recommendations

Potential signals:

- Genre
- Language
- Region
- Director
- Actors
- Movie characteristics
- Ratings
- Similar movies

### Social / behavioural recommendations

Potential signals generated by ZATLAN:

- Watched movies
- Ratings
- Likes
- Reviews
- Watchlist
- Event participation
- Similar user behaviour

The exact recommendation approach will be decided after the IMDb data analysis.

---

# Development Methodology — TDD

ZATLAN will be developed using **Test-Driven Development (TDD)**.

For each feature:

1. Define expected behaviour
2. Write the test
3. Run the test and confirm it fails
4. Implement the minimum required functionality
5. Run the test and make it pass
6. Refactor
7. Add/maintain relevant integration and regression tests

## Testing Layers

### Unit Tests
For:
- Business logic
- Validation
- Recommendation calculations
- Data transformations
- Utility functions

### Integration Tests
For:
- API + database interactions
- Authentication
- Firestore operations
- BigQuery interactions
- External service integrations

### Frontend Tests
For:
- React components
- User interactions
- Important UI states

### E2E Tests

Critical user journeys such as:

**Movie discovery flow**

Login → Search movie → View movie → Add to watchlist

**Social/watch-party flow**

Login → Find movie → Find interested people → Create/join event → Enter movie room

### Final Regression Testing

The complete test suite will be run before major checkpoints and final submission.

Testing is part of development throughout the project rather than a separate task at the end.

---

# Project Milestones

## Milestone 1 — Data & Product Foundation

**Target: August 23, 2026**

### Scope

- Analyze IMDb dataset
- Map IMDb data against ZATLAN features
- Identify missing data
- Identify required public/synthetic/ZATLAN-generated data
- Finalize MVP scope
- Finalize architecture
- Finalize Google Cloud services
- Define database entities
- Establish TDD/testing strategy

### Definition of Done

We can clearly answer:

> **What are we building, what data powers it, and how are we going to build it?**

---

## Milestone 2 — Platform Foundation

**Target: August 26, 2026**

### Scope

- Set up React + TypeScript frontend
- Set up Node.js + TypeScript backend
- Set up Firebase project
- Set up Firebase Authentication
- Set up Firestore
- Set up BigQuery
- Connect IMDb data
- Set up Cloud Run
- Establish CI/test environment
- Create initial application/backend integration

### Definition of Done

A user can open ZATLAN, authenticate, and the frontend, backend, database and Google Cloud infrastructure communicate successfully.

---

## Milestone 3 — Core Movie Experience

**Target: August 30, 2026**

### Scope

Build the primary movie experience:

- Movie search
- Movie details
- Genres/languages/regions
- Ratings
- Likes
- Reviews
- Watched list
- Watchlist
- Initial recommendation system

All features are developed using TDD.

### Definition of Done

A user can:

> Login → Search for a movie → View its details → Add it to watched/watchlist → Rate/review it → Receive recommendations.

This should provide the main movie-platform experience.

---

## Milestone 4 — Social Movie Experience

**Target: September 4, 2026**

### Scope

Turn ZATLAN from a movie platform into a social movie platform.

Core social functionality:

- User profiles
- People who watched a movie
- Similar movie taste discovery
- Watch events
- Public/private events
- Online/in-person events
- Location-based discovery
- Movie rooms/chat
- Persistent discussions
- Gemini-powered functionality where useful

### Definition of Done

A user can:

> Find a movie → Discover people interested in it → Create/join a watch event → Find people online/nearby → Enter a movie room → Continue discussing the movie afterwards.

Advanced features such as Teleparty synchronization, complex forums, and streaming-service authentication should not block this milestone.

---

## Milestone 5 — Final Testing, Polish & Submission

**Target: September 7, 2026**

### Scope

- Complete unit tests
- Integration tests
- E2E tests
- Regression testing
- Edge-case testing
- Security checks
- Performance checks
- Bug fixing
- UI/UX polish
- Cloud deployment
- Analytics/insights
- Documentation
- README
- Architecture documentation
- Demo preparation
- Patchamomma submission

### Internal Deadline

**September 5:** Feature complete

**September 6:** Stabilization, testing and final polish

**September 7:** Submission

### Definition of Done

ZATLAN works end-to-end, the critical flows are tested, the prototype is deployed and presentable, and the project is ready for Patchamomma submission.

---

# Patchamomma 2026 Timeline

| Date | Milestone |
|---|---|
| **Aug 15** | Build Phase Started |
| **Aug 20** | First Checkpoint |
| **Aug 23** | Data & Product Foundation |
| **Aug 26** | Platform Foundation |
| **Aug 28** | Second Patchamomma Checkpoint |
| **Aug 30** | Core Movie Experience |
| **Sep 4** | Social Movie Experience |
| **Sep 5** | Final Feature Completion / Final Checkpoint |
| **Sep 6** | Stabilization & Final Polish |
| **Sep 7** | Submission Lock |
| **Sep 10** | Results |
| **Sep 24** | Finale |

---

# MVP Principle

ZATLAN has a broad long-term feature set, but the prototype will prioritize a coherent end-to-end experience rather than attempting to fully implement every planned feature.

The core experience is:

> **Discover a movie → Discover people → Decide to watch → Watch together → Discuss afterwards.**

Features such as Teleparty synchronization, one-login access to multiple streaming services, and a full Reddit-style community system are considered future/advanced functionality and should not jeopardize the core prototype.

The prototype is **movies-only**. TV series and books are planned as additional content types (series first, books after) — the catalog, rooms, and events model is meant to extend to them, but they are out of scope for this submission. See [docs/PRD.md](docs/PRD.md) §P2.

---

# Project Success Criteria

ZATLAN should demonstrate:

1. A meaningful movie-data foundation using BigQuery/IMDb.
2. A working social movie experience rather than only a movie database.
3. Data-driven recommendations or social discovery.
4. Meaningful use of Google Cloud/Gemini technologies.
5. A functional end-to-end prototype.
6. TDD-backed core functionality.
7. A clear demonstration of how ZATLAN can scale beyond the prototype.

---

## ZATLAN

**Stories are better together. 🍿**