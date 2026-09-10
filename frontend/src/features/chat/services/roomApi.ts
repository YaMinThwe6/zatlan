import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { apiFetch } from '../../../lib/api'
import { firestore } from '../../../lib/firebase'
export type { RoomMessage, RoomDetail, RoomMember } from '@zatlan/shared-types'
import type { RoomMessage, RoomDetail } from '@zatlan/shared-types'

export function getRoom(roomId: string): Promise<RoomDetail> {
  return apiFetch(`/rooms/${encodeURIComponent(roomId)}`, { auth: true })
}

export function sendMessage(roomId: string, text: string): Promise<{ messageId: string; createdAt: string | null }> {
  return apiFetch(`/rooms/${encodeURIComponent(roomId)}/messages`, { method: 'POST', body: { text }, auth: true })
}

export function editMessage(roomId: string, messageId: string, text: string): Promise<void> {
  return apiFetch(`/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`, {
    method: 'PATCH',
    body: { text },
    auth: true
  })
}

export function deleteMessage(roomId: string, messageId: string): Promise<void> {
  return apiFetch(`/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE', auth: true })
}

export function promoteRoom(roomId: string): Promise<void> {
  return apiFetch(`/rooms/${encodeURIComponent(roomId)}`, { method: 'PATCH', body: { type: 'persistent' }, auth: true })
}

export function scheduleEventFromRoom(
  roomId: string,
  body: {
    movieId: string
    datetime: string
    mode: 'online' | 'in-person'
    visibility: 'public' | 'private'
    participantLimit: number
    requiresApproval: boolean
    title?: string
    location?: { address: string; lat: number; lng: number }
    invitedUserIds?: string[]
  }
): Promise<{ eventId: string }> {
  return apiFetch(`/rooms/${encodeURIComponent(roomId)}/events`, { method: 'POST', body, auth: true })
}

// hld.md §16 — reads bypass the backend entirely. Subscribes directly to
// Firestore; firestore.rules (not this code) enforces that only the room's
// own memberIds can read. Returns the unsubscribe function.
export function subscribeToMessages(roomId: string, onMessages: (messages: RoomMessage[]) => void): () => void {
  const messagesQuery = query(collection(firestore, 'rooms', roomId, 'messages'), orderBy('createdAt', 'asc'))
  return onSnapshot(messagesQuery, (snapshot) => {
    const messages: RoomMessage[] = snapshot.docs.map((doc) => {
      const data = doc.data()
      return {
        messageId: doc.id,
        authorId: data.authorId,
        text: data.text,
        createdAt: data.createdAt?.toDate?.().toISOString() ?? null,
        editedAt: data.editedAt?.toDate?.().toISOString() ?? null,
        deleted: Boolean(data.deleted)
      }
    })
    onMessages(messages)
  })
}
