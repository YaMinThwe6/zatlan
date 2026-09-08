// Wire shapes for Reviews (hld.md §20/§21, api-contracts.md §3). Moderation
// strikes/bans (§22) and disputes are deferred — they depend on the
// moderator-role system (§14), which doesn't exist yet.

// GET /movies/:movieId/reviews item — public list. authorId/displayName are
// null server-side when isAnonymous is true (never trust the client to
// redact this, per hld.md's "never trust the frontend" principle).
export interface Review {
  authorId: string | null
  displayName: string | null
  rating: number
  reviewText: string | null
  isAnonymous: boolean
  createdAt: string | null
  updatedAt: string | null
}

// The caller's own review, as returned by GET /users/me/movies/:movieId and
// PUT /movies/:movieId/reviews/me — no authorId/displayName needed, it's
// implicitly "me".
export interface MyReview {
  rating: number
  reviewText: string | null
  isAnonymous: boolean
  createdAt: string | null
  updatedAt: string | null
}

// GET /users/me/movies/:movieId — bundles the caller's relationship to one
// movie (watchlisted/watched/liked/review) so Movie Detail's action bar can
// render correct pressed states in a single request.
export interface MovieStatus {
  watchlisted: boolean
  watched: boolean
  liked: boolean
  review: MyReview | null
}

// GET /users/me/movies/status?ids=a,b,c — the same relationship signal as
// MovieStatus but for a whole result set at once (search cards, discover
// grids) and without the review payload those surfaces never render. Keyed
// by movieId; an id the caller has no relationship to is still present with
// all-false rather than omitted, so the client can tell "no relationship"
// from "not in this response".
export interface MovieStatusLite {
  watchlisted: boolean
  watched: boolean
  liked: boolean
}

export interface MovieStatusMap {
  items: Record<string, MovieStatusLite>
}

// GET /users/:uid/reviews item — Profile page's Reviews tab. Reviews live at
// movies/{movieId}/reviews/{uid}, not under the user themselves, so this is
// a movie-keyed aggregation rather than movie.ts's per-movie Review — movie
// title/poster joined in the same way MyWatchedEntry/MyWatchlistEntry are.
// No authorId/displayName here (unlike Review above): this is always
// unambiguously the profile owner's own review, by construction.
export interface ProfileReviewEntry {
  movieId: string
  movieTitle: string | null
  moviePoster: string | null
  rating: number
  reviewText: string | null
  isAnonymous: boolean
  createdAt: string | null
}
