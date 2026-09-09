import { apiFetch } from '../../../lib/api'
export type { MovieCandidate, CelebritySuggestion, PersonSummary } from '@zatlan/shared-types'
import type { MovieCandidate, CelebritySuggestion, PersonSummary } from '@zatlan/shared-types'

export function checkUsernameAvailable(username: string): Promise<{ available: boolean }> {
  return apiFetch(`/users/username-available?username=${encodeURIComponent(username)}`, { auth: true })
}

// cursor is an opaque token from a previous call's nextCursor — round-tripped
// verbatim, never constructed by the frontend (onboarding.service.ts's own
// comment: it's really just the next TMDB Discover page to fetch, but that's
// a backend implementation detail, not a contract the frontend should know).
export function getWatchedCandidates(
  genres: string[],
  languages: string[],
  cursor?: string | null
): Promise<{ items: MovieCandidate[]; nextCursor: string | null }> {
  const params = new URLSearchParams()
  if (genres.length > 0) params.set('genres', genres.join(','))
  if (languages.length > 0) params.set('languages', languages.join(','))
  if (cursor) params.set('cursor', cursor)
  const qs = params.toString()
  return apiFetch(`/onboarding/watched-candidates${qs ? `?${qs}` : ''}`, { auth: true })
}

export function getCelebritySuggestions(
  genres: string[] = [],
  languages: string[] = [],
  cursor?: string | null
): Promise<{ items: CelebritySuggestion[]; nextCursor: string | null }> {
  const params = new URLSearchParams()
  if (genres.length > 0) params.set('genres', genres.join(','))
  if (languages.length > 0) params.set('languages', languages.join(','))
  if (cursor) params.set('cursor', cursor)
  const qs = params.toString()
  return apiFetch(`/onboarding/celebrity-suggestions${qs ? `?${qs}` : ''}`, { auth: true })
}

// Local-only, like the suggestions above — only ever finds someone ZATLAN has
// already ingested via some movie's credits (people.service.ts's
// searchPeopleService), not the entire universe of actors.
export function searchPeople(query: string): Promise<{ items: PersonSummary[] }> {
  return apiFetch(`/people/search?q=${encodeURIComponent(query)}`, { auth: true })
}

export function followCelebrity(personId: string): Promise<void> {
  return apiFetch(`/users/me/followedCelebrities/${encodeURIComponent(personId)}`, { method: 'PUT', auth: true })
}

export function unfollowCelebrity(personId: string): Promise<void> {
  return apiFetch(`/users/me/followedCelebrities/${encodeURIComponent(personId)}`, { method: 'DELETE', auth: true })
}
