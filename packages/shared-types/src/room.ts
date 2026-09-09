// Wire shapes for Rooms & messages (hld.md §16, api-contracts.md §9).
// Message reads bypass the backend API entirely — the frontend subscribes
// directly to Firestore (rooms/{roomId}/messages) via onSnapshot, governed by
// Security Rules, not this package. This type still documents the doc shape
// both the frontend's onSnapshot listener and the backend's write path share.

export interface RoomMessage {
  messageId: string
  authorId: string
  text: string
  createdAt: string | null
  editedAt: string | null
  deleted: boolean
}

export interface Room {
  roomId: string
  type: 'ephemeral' | 'persistent'
  originEventId: string
  memberIds: string[]
  createdAt: string | null
}

// GET /rooms/:roomId — member-only. Messages themselves only ever carry a
// bare authorId (reads bypass the backend, straight from Firestore), so this
// is what resolves the room back to its event's title and its members'
// display names for RoomChat.tsx's own header and message-author labels.
export interface RoomMember {
  uid: string
  displayName: string
}

export interface RoomDetail {
  roomId: string
  type: 'ephemeral' | 'persistent'
  eventTitle: string
  members: RoomMember[]
}
