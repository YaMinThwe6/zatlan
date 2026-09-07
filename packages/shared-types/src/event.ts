// Wire shapes for Events (hld.md §7, api-contracts.md §8).

// Coarse, always-visible location — collected from the host separately from
// the exact coordinates, and shown to anyone browsing (guest or signed-in,
// joined or not). Never precise enough to pinpoint the actual meeting spot.
export interface EventLocation {
  area: string
  city: string
}

// The exact coordinates. Only ever populated in a response for the host or
// an already-joined participant — everyone else gets `preciseLocation: null`
// even though the event itself has a location. See events.service.ts's
// toEventSummary for the gating.
export interface EventPreciseLocation {
  lat: number
  lng: number
}

export interface EventSummary {
  eventId: string
  hostId: string
  movieId: string
  title: string | null
  datetime: string | null
  mode: 'online' | 'in-person'
  location: EventLocation | null
  preciseLocation: EventPreciseLocation | null
  visibility: 'public' | 'private'
  joinCode: string | null // set only when visibility is "private"
  participantLimit: number
  participantCount: number
  requiresApproval: boolean
  roomId: string // hld.md §16 — every event has exactly one chat room
  createdAt: string | null
  // Whether the caller has already joined — false for a signed-out guest
  // (nothing to check them against) rather than omitted, so the frontend's
  // Join/Joined button state can be initialized correctly on first render
  // instead of always starting as "Join" until clicked.
  joined: boolean
}

// GET /events/upcoming item — EventSummary joined with the movie it's for,
// and the host's displayName (the Events page card's "Hosted by" line).
export interface UpcomingEvent extends EventSummary {
  movieTitle: string | null
  moviePoster: string | null
  hostDisplayName: string
}

// GET /events/nearby item — hld.md §9. Same shape as UpcomingEvent, plus the
// caller-relative distance the geohash-range query was filtered/sorted by.
export interface NearbyEvent extends UpcomingEvent {
  distanceKm: number
}

// GET /events/:eventId — same fields as UpcomingEvent (hostDisplayName
// included), plus the caller's own relationship to the event so the
// Join/Requested/Chat button renders correctly on first load, not just
// after clicking something.
export interface EventDetail extends UpcomingEvent {
  viewerStatus: 'host' | 'joined' | 'pending' | 'none'
}

// POST /events request body — hld.md §7 "Create Event", api-contracts.md §8.
// `location` is required only for mode: 'in-person' (events.service.ts's
// createEvent rejects an in-person event without one); ignored for 'online'.
export interface CreateEventInput {
  movieId: string
  datetime: string // ISO
  mode: 'online' | 'in-person'
  visibility: 'public' | 'private'
  participantLimit: number
  requiresApproval: boolean
  title?: string | null
  location?: { area: string; city: string; lat: number; lng: number } | null
}
