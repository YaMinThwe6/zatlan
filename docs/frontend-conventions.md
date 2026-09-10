# ZATLAN — Frontend Conventions

Written 2026-08-29, alongside [backend-conventions.md](backend-conventions.md) — same motivation: the frontend grew feature-by-feature (`onboarding/`, `home/`, then `MovieDetail.tsx`/`MovieSearch.tsx` loose in `src/`) without ever naming a target shape, worth doing deliberately now rather than letting the next feature improvise its own.

---

## 1. Structure — feature-based

**Status (2026-08-29): done**, on `feature/architecture-restructure` — the tree below is now the actual `src/` layout, not just a target (with `features/auth/` also getting a `services/` folder, per §2).

One component per file (already the practice — every `.tsx` in the codebase is a single component), organized by feature/domain rather than by file type, so working on one feature means working in one folder instead of jumping across the whole tree.

```
frontend/src/
├── assets/                 # static files (images, fonts) — unchanged
├── components/             # global reusable UI primitives (Button, Input, ...) — empty for
│                            # now; nothing in the app is generic enough yet to extract. Starts
│                            # filling in the first time two features actually need the same
│                            # widget, not speculatively.
├── hooks/                  # global custom hooks — empty for now, same reasoning
├── lib/                    # cross-cutting infrastructure, not owned by any one feature:
│                            # firebase.ts (SDK init), AuthContext.tsx (auth threads through
│                            # every feature), and apiFetch() itself (shared fetch/auth-header/
│                            # error-parsing logic every feature's service file calls into)
├── features/
│   ├── auth/
│   │   ├── components/     # Login.tsx
│   │   └── services/       # authApi.ts
│   ├── onboarding/
│   │   ├── components/     # OnboardingWizard, UsernameStep, GenresStep, LanguageStep,
│   │   │                   # WatchedStep, CelebritiesStep, SuccessStep, MultiSelectStep
│   │   ├── services/       # onboardingApi.ts
│   │   └── constants.ts, greeting.ts, usernameSuggestions.ts
│   ├── home/
│   │   ├── components/     # Home, GreetingHero, TopPicks, PeopleYouMightVibeWith,
│   │   │                   # UpcomingEvents, FriendsAreWatching
│   │   ├── services/       # homeApi.ts
│   │   └── home.css
│   └── movie/
│       ├── components/     # MovieSearch, MovieDetail
│       └── services/       # movieApi.ts
└── App.tsx, App.css, main.tsx, index.css   # the shell — not a feature
```

Each feature's `components/*.test.tsx` moves with it into a sibling `test/features/<feature>/` (mirroring `frontend/test/` → `frontend/src/`, same as today, just one level deeper) — the [[feedback_monorepo_shared_packages_solid]] "tests live in a sibling `test/` dir" rule still applies per-feature, not just per-package.

A feature's `index.ts` is its public API surface (re-exporting only what other features/App.tsx actually need) — not required from day one for every feature, but the convention to reach for once a feature's internals start being reached into directly from outside it.

---

## 2. `lib/api.ts` → per-feature `services/`

**Status (2026-08-29): done**, on `feature/architecture-restructure`. The old single `lib/api.ts` (~30 functions spanning auth, onboarding, home, movies, reviews, events, follow, notifications) is now one `services/<feature>Api.ts` per feature:

- `features/auth/services/authApi.ts` — `startEmailAuth`, `verifyEmailAuth`. (Added during execution — the original plan's tree showed `features/auth/` with only `components/`, but the two Login-only API calls clearly belong in their own feature's `services/`, same as every other feature, rather than staying in cross-cutting `lib/`.)
- `features/onboarding/services/onboardingApi.ts` — `checkUsernameAvailable`, `getWatchedCandidates`, `getCelebritySuggestions`, `followCelebrity`/`unfollowCelebrity`
- `features/home/services/homeApi.ts` — `getHomeGreeting`, `getHomeActivity`, `getRecommendations`, `getTasteMatches`, `followUser`/`unfollowUser`, `getUpcomingEvents`, `joinEvent`/`leaveEvent`, `getNotifications`, `markNotificationRead`
- `features/movie/services/movieApi.ts` — `searchMovies`, `getMovie`, `getMovieStatus`, `getMovieReviews`, `submitReview`, `deleteReview`, `likeMovie`/`unlikeMovie`, `addToWatchlist`/`removeFromWatchlist`, `markWatched`/`unmarkWatched`
- `getMe`/`updateMe` (used by nearly everything — onboarding, Home's topbar, App.tsx's gate) stay in `lib/api.ts` alongside `AuthContext` rather than forced into any one feature

`apiFetch()` itself (the shared fetch wrapper: auth header injection, JSON body) stays in `lib/api.ts` — it's genuinely cross-cutting, every service file imports it, no feature owns it. It was also updated in the same pass to parse the new backend envelope (docs/backend-conventions.md §3): unwraps `data` on success, throws `responseBody.message` on failure — replacing the old `responseBody?.error?.message` shape.

Type re-exports (`export type { ... } from '@zatlan/shared-types'`) moved to whichever service file each type actually belongs to, rather than one shared block. `Me` (the app's name for `UserProfile`) stayed in `lib/api.ts` alongside `getMe`/`updateMe`.

---

## 3. CSS

**Decision — no tooling yet, deliberately.** Plain hand-written `.css` files (`App.css`, `home.css`, `index.css`), imported directly, no Tailwind/CSS Modules/styled-components/Emotion/preprocessor. The project already has a dedicated styling pass on its roadmap (post-functional-slice, per [[project_checkpoint2_implementation]]) — that's the natural moment to pick a CSS approach, not before, since picking one now means either migrating whatever gets written between now and then, or living with a mixed styling approach.

---

## 4. What this doesn't change

[[feedback_feature_branch_workflow]] and [[feedback_no_ai_attribution_in_commits]] both still apply to the restructuring branch when it happens, same as any other feature branch.
