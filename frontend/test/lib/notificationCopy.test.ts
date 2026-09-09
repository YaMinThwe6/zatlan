import { describe, it, expect } from 'vitest'
import { notificationTarget } from '../../src/lib/notificationCopy'
import type { NotificationItem } from '../../src/features/home/services/homeApi'

const baseItem: NotificationItem = {
  id: 'n1',
  type: 'followRequest',
  fromUserId: 'friend-1',
  fromUserDisplayName: 'Rohan',
  fromUserPhotoURL: null,
  targetType: null,
  targetId: null,
  read: false,
  createdAt: new Date().toISOString()
}

describe('notificationTarget', () => {
  it('sends a followRequest to the People page\'s Requests tab, where the approve/deny UI lives', () => {
    expect(notificationTarget({ ...baseItem, type: 'followRequest' })).toBe('/people?tab=requests')
  })
})
