import { apiFetch } from '../../../lib/api'
export type { MovieSummary, MovieDetail, MovieStatus, MovieStatusLite, MovieStatusMap, DiscoverMoviesResponse, Review, MyReview, WatchedByEntry, SimilarMovieItem, TopFollowedPerson, MyWatchedEntry, MyWatchlistEntry } from '@binj/shared-types'
import type { MovieSummary, MovieDetail, MovieStatus, MovieStatusMap, DiscoverMoviesResponse, Review, MyReview, WatchedByEntry, SimilarMovieItem, TopFollowedPerson, MyWatchedEntry, MyWatchlistEntry } from '@binj/shared-types'

export function searchMovies(query: string): Promise<{ items: MovieSummary[] }> {
  return apiFetch(`/search/movies?q=${encodeURIComponent(query)}`)
}

export function getRecentMovies(): Promise<{ items: MovieSummary[] }> {
  return apiFetch('/movies/recent')
}

// Browse-by-facet: every movie in a genre and/or original language,
// popularity-ordered, TMDB's own discover paging passed straight through
// (page 1-based, `totalPages` bounds "load more"). `genre` is a TMDB genre
// name, `language` an ISO 639-1 code — the caller resolves those from the
// chip it matched (see movie/genreLanguageMatch.ts).
export function discoverMovies(
  opts: { genre?: string | null; language?: string | null; page?: number }
): Promise<DiscoverMoviesResponse> {
  const params = new URLSearchParams()
  if (opts.genre) params.set('genre', opts.genre)
  if (opts.language) params.set('language', opts.language)
  if (opts.page && opts.page > 1) params.set('page', String(opts.page))
  return apiFetch(`/discover/movies?${params.toString()}`)
}

// Batch relationship lookup for a whole result set — one request instead of
// one per card. Signed-in only. An id the caller has no relationship to is
// still present in the map (all-false), so a missing key means "not asked",
// not "no relationship".
export function getMovieStatuses(movieIds: string[]): Promise<MovieStatusMap> {
  if (movieIds.length === 0) return Promise.resolve({ items: {} })
  return apiFetch(`/users/me/movies/status?ids=${movieIds.map(encodeURIComponent).join(',')}`, { auth: true })
}

export function getMovie(movieId: string): Promise<MovieDetail> {
  return apiFetch(`/movies/${encodeURIComponent(movieId)}`)
}

export function getMovieStatus(movieId: string): Promise<MovieStatus> {
  return apiFetch(`/users/me/movies/${encodeURIComponent(movieId)}`, { auth: true })
}

export function getMovieReviews(movieId: string, cursor?: string): Promise<{ items: Review[]; nextCursor: string | null }> {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return apiFetch(`/movies/${encodeURIComponent(movieId)}/reviews${qs}`)
}

export function submitReview(
  movieId: string,
  review: { rating: number; reviewText: string | null; isAnonymous: boolean }
): Promise<MyReview> {
  return apiFetch(`/movies/${encodeURIComponent(movieId)}/reviews/me`, { method: 'PUT', body: review, auth: true })
}

export function deleteReview(movieId: string): Promise<void> {
  return apiFetch(`/movies/${encodeURIComponent(movieId)}/reviews/me`, { method: 'DELETE', auth: true })
}

export function likeMovie(movieId: string): Promise<void> {
  return apiFetch(`/users/me/likes/${encodeURIComponent(movieId)}`, { method: 'PUT', auth: true })
}

export function unlikeMovie(movieId: string): Promise<void> {
  return apiFetch(`/users/me/likes/${encodeURIComponent(movieId)}`, { method: 'DELETE', auth: true })
}

export function addToWatchlist(movieId: string): Promise<void> {
  return apiFetch(`/users/me/watchlist/${encodeURIComponent(movieId)}`, { method: 'PUT', auth: true })
}

export function removeFromWatchlist(movieId: string): Promise<void> {
  return apiFetch(`/users/me/watchlist/${encodeURIComponent(movieId)}`, { method: 'DELETE', auth: true })
}

export function markWatched(movieId: string): Promise<void> {
  return apiFetch(`/users/me/watched/${encodeURIComponent(movieId)}`, { method: 'PUT', auth: true })
}

export function unmarkWatched(movieId: string): Promise<void> {
  return apiFetch(`/users/me/watched/${encodeURIComponent(movieId)}`, { method: 'DELETE', auth: true })
}

// Profile page's Watched/Watchlist tabs — self-only (movie title/poster
// already joined in server-side), paginated the same cursor-round-tripped
// way onboarding's suggestion grids already are.
export function getMyWatched(cursor?: string | null): Promise<{ items: MyWatchedEntry[]; nextCursor: string | null }> {
  return apiFetch(`/users/me/watched${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { auth: true })
}

export function getMyWatchlist(cursor?: string | null): Promise<{ items: MyWatchlistEntry[]; nextCursor: string | null }> {
  return apiFetch(`/users/me/watchlist${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { auth: true })
}

export function getMovieWatchedBy(movieId: string): Promise<{ items: WatchedByEntry[]; nextCursor: string | null }> {
  return apiFetch(`/movies/${encodeURIComponent(movieId)}/watchedBy`, { auth: true })
}

// No auth — public, same as getMovie itself. "Similar taste picks for you"
// (movie detail's right rail).
export function getSimilarMovies(movieId: string): Promise<{ items: SimilarMovieItem[] }> {
  return apiFetch(`/movies/${encodeURIComponent(movieId)}/similar`)
}

// No auth — public. The signed-out Discover page's "People you might vibe
// with" teaser (DiscoverPeopleTeaser.tsx): real top-followed users, never
// fabricated sample data.
export function getTopFollowedPeople(): Promise<{ items: TopFollowedPerson[] }> {
  return apiFetch('/discover/people')
}
