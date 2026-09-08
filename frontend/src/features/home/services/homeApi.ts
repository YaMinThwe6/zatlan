import { apiFetch } from '../../../lib/api'
export type { RecommendationItem, TasteMatch, UpcomingEvent, ActivityItem, Greeting, NotificationItem, NearbyEvent, FriendsRecommendationItem, CreateEventInput, EventSummary, EventDetail, EventJoinRequest } from '@binj/shared-types'
import type { RecommendationItem, TasteMatch, UpcomingEvent, ActivityItem, Greeting, NotificationItem, NearbyEvent, FriendsRecommendationItem, CreateEventInput, EventSummary, EventDetail, EventJoinRequest } from '@binj/shared-types'

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

// No auth — public, reachable by a signed-out guest too (MovieSearch.tsx's
// Discover teaser). The response never carries exact coordinates either way
// (backend's listUpcomingEvents), so there's nothing sensitive to gate here.
// `movieId` narrows to one movie's events — MovieDetail's "Watch together"
// right rail; omitted, this is Home's broader "Upcoming watch events".
export function getUpcomingEvents(movieId?: string): Promise<{ items: UpcomingEvent[] }> {
  return apiFetch(`/events/upcoming${movieId ? `?movieId=${encodeURIComponent(movieId)}` : ''}`)
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

export function getEvent(eventId: string): Promise<EventDetail> {
  return apiFetch(`/events/${encodeURIComponent(eventId)}`, { auth: true })
}

export function deleteEvent(eventId: string): Promise<void> {
  return apiFetch(`/events/${encodeURIComponent(eventId)}`, { method: 'DELETE', auth: true })
}

// Host-only — the event detail page's own "Join requests" section, backend
// 403s anyone else (events.service.ts's listJoinRequests).
export function getJoinRequests(eventId: string): Promise<{ items: EventJoinRequest[] }> {
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
