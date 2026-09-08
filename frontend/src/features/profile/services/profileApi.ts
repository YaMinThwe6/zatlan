import { apiFetch } from '../../../lib/api'
export type { PublicProfile, ProfileReviewEntry } from '@binj/shared-types'
import type { PublicProfile, ProfileReviewEntry } from '@binj/shared-types'

// GET /users/:uid — api-contracts.md §11b. The public-facing counterpart to
// lib/api.ts's getMe: what any signed-in caller sees on someone else's
// profile, privacy-filtered server-side.
export function getUserProfile(uid: string): Promise<PublicProfile> {
  return apiFetch(`/users/${uid}`, { auth: true })
}

// GET /users/:uid/reviews — Profile page's Reviews tab. Anonymous reviews
// are only included when viewing your own profile (the backend enforces
// this regardless of what the caller claims).
export function getUserReviews(uid: string): Promise<{ items: ProfileReviewEntry[] }> {
  return apiFetch(`/users/${uid}/reviews`, { auth: true })
}
