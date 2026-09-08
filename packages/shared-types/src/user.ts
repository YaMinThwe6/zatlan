// Wire shape of `GET /users/me` / `PATCH /users/me` (api-contracts.md §11).
// Deliberately NOT the same shape as the backend's internal Firestore user
// document (schema.md `users/{uid}`) — that carries storage-only fields like
// `createdAt`/`statusExpiresAt` as Firestore Timestamps, which never cross
// the wire. This is the response DTO both sides agree on.
export interface UserProfile {
  uid: string
  displayName: string
  username: string | null
  email: string
  photoURL: string | null
  listVisible: boolean
  followRequiresApproval: boolean
  status: 'active' | 'restricted' | 'suspended'
  favoriteGenres: string[] | null
  preferredLanguages: string[] | null
  onboardingComplete: boolean
  notificationPrefs: { emailEnabled: boolean }
  themePreference: 'dark' | 'light' | 'system'
  accentTheme: 'emerald' | 'cyan' | 'purple' | 'pink' | 'amber' | 'red'
  // Opt-out of GET /discover/people (the signed-out Discover page's "top
  // followed users" teaser) — distinct from listVisible, which only gates
  // the watched list.
  hideFromDiscovery: boolean
  isNewUser: boolean
}
