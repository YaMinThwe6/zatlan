import type { NotificationItem } from '../features/home/services/homeApi'

// Shared by the header dropdown (NotificationBell.tsx) and the full list
// (features/notifications/components/Notifications.tsx) — one switch
// statement per concern, not duplicated in both places.

// Every type but moderationWarning is "someone did something" — the actor's
// name (joined in server-side, notifications.service.ts's listNotifications)
// is what makes each line readable. moderationWarning has no actor.
export function notificationText(item: NotificationItem): string {
  const name = item.fromUserDisplayName ?? 'Someone'
  switch (item.type) {
    case 'followRequest':
      return `${name} wants to connect with you`
    case 'followApproved':
      return `${name} approved your connect request`
    case 'newFollower':
      return `${name} started following you`
    case 'eventJoinRequest':
      return `${name} requested to join your event`
    case 'eventJoinApproved':
      return 'Your request to join was approved'
    case 'eventJoinDenied':
      return 'Your request to join was denied'
    case 'eventReminderHost24h':
      return "Your event is tomorrow — you're hosting"
    case 'eventReminderHost1h':
      return "Your event starts in about an hour — you're hosting"
    case 'eventReminderParticipant24h':
      return "An event you're going to is tomorrow"
    case 'eventReminderParticipant1h':
      return "An event you're going to starts in about an hour"
    case 'chatActive':
      return `${name}'s event chat is active`
    case 'moderationWarning':
      return 'You have a moderation warning on your account'
    default:
      return 'New notification'
  }
}

// Where clicking a notification should take you. followRequest goes to
// PeopleDiscovery's own Requests tab (?tab=requests) — the Approve/Deny UI
// lives there, not in Settings (moved 2026-09-09; managing who follows you
// is a people-management action, not a settings toggle).
export function notificationTarget(item: NotificationItem): string | null {
  switch (item.type) {
    case 'followRequest':
      return '/people?tab=requests'
    case 'followApproved':
    case 'newFollower':
      return item.fromUserId ? `/profile/${item.fromUserId}` : null
    case 'eventJoinRequest':
    case 'eventJoinApproved':
    case 'eventJoinDenied':
    case 'eventReminderHost24h':
    case 'eventReminderHost1h':
    case 'eventReminderParticipant24h':
    case 'eventReminderParticipant1h':
      return item.targetId ? `/events/${item.targetId}` : null
    case 'chatActive':
      return item.targetId ? `/rooms/${item.targetId}` : null
    default:
      return null
  }
}

export function formatNotificationTime(iso: string | null): string {
  if (!iso) return ''
  const diffMs = Math.max(0, Date.now() - new Date(iso).getTime())
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}
