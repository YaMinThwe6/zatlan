import { auth } from './firebase'
// Request/response shapes live in @zatlan/shared-types, the single source of
// truth both frontend and backend import from (packages/shared-types) — see
// [[feedback_monorepo_shared_packages_solid]]. `Me` is this file's own name
// for the shared `UserProfile`.
export type { UserProfile as Me, ReportTargetType, CreateReportResult } from '@zatlan/shared-types'
import type { UserProfile as Me, ReportTargetType, CreateReportResult } from '@zatlan/shared-types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:6501'

interface ApiFetchOptions {
  method?: string
  body?: unknown
  auth?: boolean
  // Attaches the ID token when there IS a signed-in user, but — unlike
  // `auth` — never throws or requires one. For an endpoint the backend
  // itself gates with optionalAuth (currently just GET /events/upcoming):
  // reachable signed out (a guest teaser), but a signed-in caller should
  // still get their own joined/pending status back, not a guest's.
  optionalAuth?: boolean
}

// The single response envelope every backend endpoint uses (docs/backend-conventions.md
// §3): success responses carry the payload under `data`; error responses carry a
// machine-readable `code` alongside `message`. Every feature's `services/*Api.ts`
// calls into this — it's the only place that knows about the envelope shape.
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  if (options.auth) {
    const token = await auth.currentUser?.getIdToken()
    if (!token) {
      throw new Error('Not signed in')
    }
    headers['Authorization'] = `Bearer ${token}`
  } else if (options.optionalAuth) {
    const token = await auth.currentUser?.getIdToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  })

  if (res.status === 204) {
    return undefined as T
  }

  const responseBody = await res.json().catch(() => null)

  if (!res.ok) {
    throw new Error(responseBody?.message ?? `Request failed: ${res.status}`)
  }

  return responseBody?.data as T
}

export function getMe(): Promise<Me> {
  return apiFetch('/users/me', { auth: true })
}

export function updateMe(patch: Partial<Pick<Me, 'displayName' | 'username' | 'listVisible' | 'followRequiresApproval' | 'favoriteGenres' | 'preferredLanguages' | 'onboardingComplete' | 'themePreference' | 'accentTheme' | 'notificationPrefs' | 'hideFromDiscovery'>>): Promise<Me> {
  return apiFetch('/users/me', { method: 'PATCH', body: patch, auth: true })
}

// PRD §30.3/§30.8 — cross-cutting: every feature that can be reported (chat
// messages today, reviews/events/profiles later) calls into this same
// endpoint, so it lives alongside getMe/updateMe rather than under any one
// feature. Gemini's decision applies immediately server-side; the caller
// gets it back in the same response, not a separate "check later" step.
export function reportContent(input: {
  targetType: ReportTargetType
  targetId: string
  reason: string
  roomId?: string
  movieId?: string
}): Promise<CreateReportResult> {
  return apiFetch('/reports', { method: 'POST', body: input, auth: true })
}
