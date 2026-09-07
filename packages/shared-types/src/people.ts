// Wire shapes for the people/social-discovery endpoints (api-contracts.md §5).
import type { ActivityItem } from './activity.js'

export interface CelebritySuggestion {
  personId: string
  name: string
  photo: string | null
  appearsIn: number
}

// GET /people/search item — a plain by-name lookup (api-contracts.md §5),
// distinct from CelebritySuggestion: no appearsIn, since this isn't ranked
// against the caller's own watch history the way suggestions are.
export interface PersonSummary {
  personId: string
  name: string
  photo: string | null
}

// GET /users/me/tasteMatches item — relationship is joined live against the
// Follow collections (api-contracts.md §4) so a "Connect" button can render
// the right state without a second round-trip.
//
// matchReason records which tier of the ranking pipeline surfaced this
// candidate (precomputed watch-history overlap, live genre/language overlap,
// or the guaranteed catch-all) — lets the UI say *why* someone is suggested
// for free, no extra query.
export interface TasteMatch {
  uid: string
  displayName: string
  photoURL: string | null
  score: number
  relationship: 'following' | 'pending' | 'none'
  matchReason: 'tasteMatch' | 'genreOverlap' | 'languageOverlap' | 'suggested'
}

// GET /discover/people item — the signed-out Discover page's "People you
// might vibe with" teaser (movie/DiscoverPeopleTeaser.tsx). Public, so no
// `relationship`/`score`/`matchReason` the way TasteMatch has — there's no
// caller to compute those against yet. Deliberately real users (not
// fabricated sample data), ranked by real followerCount.
export interface TopFollowedPerson {
  uid: string
  displayName: string
  photoURL: string | null
  followerCount: number
}

// GET /movies/:movieId/watchedBy item — hld.md §5a. Scoped to the caller's
// own `following` list, both list-level (users.listVisible) and per-entry
// (watched.visibility) privacy checks applied server-side.
export interface WatchedByEntry {
  uid: string
  displayName: string
  watchedAt: string | null
}

// GET /users/:uid item — a public-profile watched entry, movie details
// already joined in so the frontend doesn't need a second round-trip per movie.
export interface PublicProfileWatchedEntry {
  movieId: string
  title: string | null
  poster: string | null
  watchedAt: string | null
}

// GET /users/:uid's Overview-tab genre breakdown — the % of the target's
// watched movies that carry each genre (a movie can carry more than one, so
// percentages don't sum to 100). Computed server-side from the movie catalog's
// own `genres` field, not a user-editable preference list — that's the
// separate, still-present `favoriteGenres` (onboarding's manual picks).
export interface ProfileGenreStat {
  genre: string
  percent: number
}

// GET /users/:uid (api-contracts.md §11b) — the public-facing counterpart to
// UserProfile (GET /users/me): only what's meant to be visible to other
// users, privacy-filtered server-side the same way as watchedBy above.
// `relationship` is "self" when the caller requests their own uid — the
// watched list still gets the same privacy filter in that case (a user
// wanting their own unfiltered list already has GET /users/me/watched).
export interface PublicProfile {
  uid: string
  displayName: string
  username: string | null
  photoURL: string | null
  favoriteGenres: string[] | null
  preferredLanguages: string[] | null
  followerCount: number
  followingCount: number
  relationship: 'self' | 'following' | 'pending' | 'none'
  watchedListVisible: boolean
  watched: PublicProfileWatchedEntry[]
  // Added for the MyProfile/OtherUserProfile design canvas artboards
  // (Overview tab's stat row, genre breakdown, recent-activity feed and
  // taste-match card) — all computed from data that already existed
  // server-side, no new user-entered fields.
  joinedAt: string | null
  watchedCount: number
  watchlistCount: number
  reviewCount: number
  topGenres: ProfileGenreStat[]
  // Same privacy gate as `watched` above (watchedListVisible) — empty
  // whenever that's false, never a separately-leaky channel for the same data.
  recentActivity: ActivityItem[]
  // Caller's precomputed taste-match score against this target (0-100),
  // from users/{callerUid}/tasteMatches/{targetUid} — same source
  // GET /users/me/tasteMatches reads. null when viewing your own profile,
  // or when no score has been precomputed for this pair yet.
  tasteMatchScore: number | null
}
