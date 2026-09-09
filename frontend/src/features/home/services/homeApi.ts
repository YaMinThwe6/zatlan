import { apiFetch } from '../../../lib/api'
export type { RecommendationItem, TasteMatch, UpcomingEvent, ActivityItem, Greeting, NotificationItem, NearbyEvent, FriendsRecommendationItem, CreateEventInput, EventSummary, EventDetail, EventJoinRequest, EventJoinRequestsResponse, FollowRequest } from '@zatlan/shared-types'
import type { RecommendationItem, TasteMatch, UpcomingEvent, ActivityItem, Greeting, NotificationItem, NearbyEvent, FriendsRecommendationItem, CreateEventInput, EventSummary, EventDetail, EventJoinRequestsResponse, FollowRequest } from '@zatlan/shared-types'

export function getHomeGreeting(): Promise<Greeting> {
  return apiFetch('/home/greeting', { auth: true })
}

export function getHomeActivity(): Promise<{ items: ActivityItem[] }> {
  return apiFetch('/home/activity', { auth: true })
}

export function getFriendsRecommendations(): Promise<{ items: FriendsRecommendationItem[] }> {
  return apiFetch('/home/friends-recommendations', { auth: true })
}

export function getRecommendations(): Promise<{ items: RecommendationItem[] }> {
  return apiFetch('/recommendations', { auth: true })
}

export function getTasteMatches(limit?: number): Promise<{ items: TasteMatch[] }> {
  return apiFetch(`/users/me/tasteMatches${limit ? `?limit=${limit}` : ''}`, { auth: true })
}

export function followUser(uid: string): Promise<{ status: 'following' | 'pending' }> {
  return apiFetch(`/users/${encodeURIComponent(uid)}/follow`, { method: 'PUT', auth: true })
}

export function unfollowUser(uid: string): Promise<void> {
  return apiFetch(`/users/${encodeURIComponent(uid)}/follow`, { method: 'DELETE', auth: true })
}

// Settings' Privacy section — shown alongside "Approve followers manually".
// The backend has always supported this (GET/approve/deny); this was the
// missing frontend wiring, same gap the event join-request UI closed earlier.
export function getFollowRequests(): Promise<{ items: FollowRequest[] }> {
  return apiFetch('/users/me/followRequests', { auth: true })
}

export function approveFollowRequest(requesterUid: string): Promise<void> {
  return apiFetch(`/users/me/followRequests/${encodeURIComponent(requesterUid)}/approve`, { method: 'POST', auth: true })
}

export function denyFollowRequest(requesterUid: string): Promise<void> {
  return apiFetch(`/users/me/followRequests/${encodeURIComponent(requesterUid)}/deny`, { method: 'POST', auth: true })
}

// Reachable by a signed-out guest too (MovieSearch.tsx's Discover teaser),
// so this can't require auth — but a signed-in caller still needs their own
// joined/pending status back, not a guest's, so it attaches the token
// whenever one is available. Real bug this fixed: this used to call
// apiFetch with no auth option at all, so EVERY call — signed in or not —
// went out with no Authorization header, and joined/pending always came
// back false regardless of the caller's actual relationship to each event.
// The response never carries exact coordinates either way (backend's
// listUpcomingEvents), so there's nothing else sensitive to gate here.
// `movieId` narrows to one movie's events — MovieDetail's "Watch together"
// right rail; omitted, this is Home's broader "Upcoming watch events".
export function getUpcomingEvents(movieId?: string): Promise<{ items: UpcomingEvent[] }> {
  return apiFetch(`/events/upcoming${movieId ? `?movieId=${encodeURIComponent(movieId)}` : ''}`, { optionalAuth: true })
}

export function createEvent(input: CreateEventInput): Promise<EventSummary> {
  return apiFetch('/events', { method: 'POST', body: input, auth: true })
}

export function getNearbyEvents(lat: number, lng: number, radiusKm: number): Promise<{ items: NearbyEvent[] }> {
  return apiFetch(`/events/nearby?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`, { auth: true })
}

export function joinEvent(eventId: string): Promise<{ status: 'joined' | 'pending' }> {
  return apiFetch(`/events/${encodeURIComponent(eventId)}/join`, { method: 'PUT', auth: true })
}

export function leaveEvent(eventId: string): Promise<void> {
  return apiFetch(`/events/${encodeURIComponent(eventId)}/join`, { method: 'DELETE', auth: true })
}

// Events page's "Hosting" tab — every event the caller hosts, public or
// private, unlike getUpcomingEvents which only ever returns public ones.
export function getHostedEvents(): Promise<{ items: UpcomingEvent[] }> {
  return apiFetch('/events/hosting', { auth: true })
}

// Profile page's Events tab — the other two of its four sections (Hosting
// reuses getHostedEvents above).
export function getJoinedEvents(when: 'future' | 'past'): Promise<{ items: UpcomingEvent[] }> {
  return apiFetch(`/events/joined?when=${when}`, { auth: true })
}

export function getRequestedEvents(): Promise<{ items: UpcomingEvent[] }> {
  return apiFetch('/events/requested', { auth: true })
}

export function getEvent(eventId: string): Promise<EventDetail> {
  return apiFetch(`/events/${encodeURIComponent(eventId)}`, { auth: true })
}

export function deleteEvent(eventId: string): Promise<void> {
  return apiFetch(`/events/${encodeURIComponent(eventId)}`, { method: 'DELETE', auth: true })
}

// Host-only — the event detail page's own "Join requests" section, backend
// 403s anyone else (events.service.ts's listJoinRequests).
export function getJoinRequests(eventId: string): Promise<EventJoinRequestsResponse> {
  return apiFetch(`/events/${encodeURIComponent(eventId)}/joinRequests`, { auth: true })
}

export function approveJoinRequest(eventId: string, requesterUid: string): Promise<void> {
  return apiFetch(`/events/${encodeURIComponent(eventId)}/joinRequests/${encodeURIComponent(requesterUid)}/approve`, { method: 'POST', auth: true })
}

export function denyJoinRequest(eventId: string, requesterUid: string): Promise<void> {
  return apiFetch(`/events/${encodeURIComponent(eventId)}/joinRequests/${encodeURIComponent(requesterUid)}/deny`, { method: 'POST', auth: true })
}

export function getNotifications(unreadOnly = false): Promise<{ items: NotificationItem[] }> {
  return apiFetch(`/users/me/notifications${unreadOnly ? '?unreadOnly=true' : ''}`, { auth: true })
}

export function markNotificationRead(id: string): Promise<void> {
  return apiFetch(`/users/me/notifications/${encodeURIComponent(id)}`, { method: 'PATCH', body: { read: true }, auth: true })
}

export function clearAllNotifications(): Promise<void> {
  return apiFetch('/users/me/notifications/clear', { method: 'POST', auth: true })
}
