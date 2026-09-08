// Notifications (hld.md §17, api-contracts.md §10). `type` is currently written
// by exactly two flows — Follow and Events — via the backend's shared
// `notify.ts` helper; the rest of §17's type list lands with their owning flows.
export type NotificationType = 'followRequest' | 'followApproved' | 'eventJoinRequest' | 'eventJoinApproved' | 'eventJoinDenied' | 'moderationWarning'

export interface NotificationItem {
  id: string
  type: NotificationType
  fromUserId: string | null
  // Joined in server-side (listNotifications) so the notification center has
  // something readable to show without a second round-trip per item — every
  // current notification type is "someone did something", so the actor's
  // name/photo is the one piece of context that's always relevant.
  fromUserDisplayName: string | null
  fromUserPhotoURL: string | null
  targetType: string | null
  targetId: string | null
  read: boolean
  createdAt: string | null
}
