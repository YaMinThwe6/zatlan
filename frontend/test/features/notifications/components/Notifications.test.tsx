import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getMe = vi.fn()
vi.mock('../../../../src/lib/api', async () => {
  const actual = await vi.importActual<object>('../../../../src/lib/api')
  return { ...actual, getMe }
})

const signOutUser = vi.fn()
vi.mock('../../../../src/lib/AuthContext', () => ({
  useAuth: () => ({ signOutUser })
}))

const getNotifications = vi.fn()
const markNotificationRead = vi.fn()
const clearAllNotifications = vi.fn()
vi.mock('../../../../src/features/home/services/homeApi', () => ({
  getNotifications,
  markNotificationRead,
  clearAllNotifications
}))

const { Notifications } = await import('../../../../src/features/notifications/components/Notifications')

afterEach(() => {
  getMe.mockReset()
  getNotifications.mockReset()
  markNotificationRead.mockReset()
  clearAllNotifications.mockReset()
  vi.restoreAllMocks()
})

// Awaits the shared shell's own async chain settling too (AppHeader awaits
// getMe before its NotificationBell child even mounts, which then awaits
// its own separate getNotifications call) — otherwise that chain can still
// be in flight when a test ends, firing after afterEach resets the mocks
// and throwing on a now-unconfigured one, intermittently breaking whichever
// test happens to be running when it lands.
async function renderAt(path = '/notifications') {
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/people" element={<p>People page</p>} />
        <Route path="/profile/:uid" element={<p>Profile page</p>} />
        <Route path="/events/:eventId" element={<p>Event detail page</p>} />
        <Route path="/rooms/:roomId" element={<p>Room chat page</p>} />
      </Routes>
    </MemoryRouter>
  )
  // getNotifications is called twice — once by the page itself (no args),
  // once by NotificationBell (unreadOnly=true) — waiting for the `true` call
  // specifically confirms NotificationBell's own later-gated chain settled,
  // not just the page's own immediate fetch.
  await waitFor(() => expect(getNotifications).toHaveBeenCalledWith(true))
  return result
}

const baseItem = {
  id: 'n1',
  fromUserId: 'friend-1',
  fromUserDisplayName: 'Rohan',
  fromUserPhotoURL: null,
  targetType: null,
  targetId: null,
  read: false,
  createdAt: new Date().toISOString()
}

describe('Notifications', () => {
  it('shows readable copy for each notification type', async () => {
    getMe.mockResolvedValue({ uid: 'me-1' })
    getNotifications.mockResolvedValue({
      items: [
        { ...baseItem, id: 'n1', type: 'followRequest' },
        { ...baseItem, id: 'n2', type: 'followApproved' },
        { ...baseItem, id: 'n2b', type: 'newFollower' },
        { ...baseItem, id: 'n3', type: 'eventJoinRequest', targetType: 'event', targetId: 'evt-1' },
        { ...baseItem, id: 'n4', type: 'eventJoinApproved', targetType: 'event', targetId: 'evt-1' },
        { ...baseItem, id: 'n5', type: 'eventJoinDenied', targetType: 'event', targetId: 'evt-1' },
        { ...baseItem, id: 'n7', type: 'eventReminderHost24h', targetType: 'event', targetId: 'evt-1' },
        { ...baseItem, id: 'n8', type: 'eventReminderHost1h', targetType: 'event', targetId: 'evt-1' },
        { ...baseItem, id: 'n9', type: 'eventReminderParticipant24h', targetType: 'event', targetId: 'evt-1' },
        { ...baseItem, id: 'n10', type: 'eventReminderParticipant1h', targetType: 'event', targetId: 'evt-1' },
        { ...baseItem, id: 'n6', type: 'chatActive', targetType: 'room', targetId: 'room-1' }
      ]
    })
    await renderAt()

    expect(await screen.findByText(/Rohan wants to connect/i)).toBeInTheDocument()
    expect(screen.getByText(/Rohan approved your connect request/i)).toBeInTheDocument()
    expect(screen.getByText(/Rohan started following you/i)).toBeInTheDocument()
    expect(screen.getByText(/Rohan requested to join your event/i)).toBeInTheDocument()
    expect(screen.getByText(/your request to join was approved/i)).toBeInTheDocument()
    expect(screen.getByText(/your request to join was denied/i)).toBeInTheDocument()
    expect(screen.getByText(/event is tomorrow.*hosting/i)).toBeInTheDocument()
    expect(screen.getByText(/event starts in about an hour.*hosting/i)).toBeInTheDocument()
    expect(screen.getByText(/event you're going to is tomorrow/i)).toBeInTheDocument()
    expect(screen.getByText(/event you're going to starts in about an hour/i)).toBeInTheDocument()
    expect(screen.getByText(/Rohan.*chat is active/i)).toBeInTheDocument()
  })

  it('shows an empty state when there are no notifications', async () => {
    getMe.mockResolvedValue({ uid: 'me-1' })
    getNotifications.mockResolvedValue({ items: [] })
    await renderAt()

    expect(await screen.findByText(/no notifications/i)).toBeInTheDocument()
  })

  it('shows an error message when the fetch fails', async () => {
    getMe.mockResolvedValue({ uid: 'me-1' })
    getNotifications.mockRejectedValue(new Error('Failed to load'))
    await renderAt()

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load')
  })

  it('clicking a followRequest notification marks it read and goes to the People page\'s Requests tab, where the approve/deny UI lives', async () => {
    getMe.mockResolvedValue({ uid: 'me-1' })
    getNotifications.mockResolvedValue({ items: [{ ...baseItem, type: 'followRequest' }] })
    markNotificationRead.mockResolvedValue(undefined)
    await renderAt()

    fireEvent.click(await screen.findByText(/Rohan wants to connect/i))

    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith('n1'))
    expect(await screen.findByText('People page')).toBeInTheDocument()
  })

  it('clicking a followApproved notification goes to the approver’s profile', async () => {
    getMe.mockResolvedValue({ uid: 'me-1' })
    getNotifications.mockResolvedValue({ items: [{ ...baseItem, type: 'followApproved' }] })
    markNotificationRead.mockResolvedValue(undefined)
    await renderAt()

    fireEvent.click(await screen.findByText(/approved your connect request/i))

    expect(await screen.findByText('Profile page')).toBeInTheDocument()
  })

  it('clicking an event-related notification goes to that event’s detail page', async () => {
    getMe.mockResolvedValue({ uid: 'me-1' })
    getNotifications.mockResolvedValue({ items: [{ ...baseItem, type: 'eventJoinApproved', targetType: 'event', targetId: 'evt-1' }] })
    markNotificationRead.mockResolvedValue(undefined)
    await renderAt()

    fireEvent.click(await screen.findByText(/your request to join was approved/i))

    expect(await screen.findByText('Event detail page')).toBeInTheDocument()
  })

  it('clicking a host event-reminder notification goes to that event’s detail page', async () => {
    getMe.mockResolvedValue({ uid: 'me-1' })
    getNotifications.mockResolvedValue({ items: [{ ...baseItem, type: 'eventReminderHost24h', targetType: 'event', targetId: 'evt-1' }] })
    markNotificationRead.mockResolvedValue(undefined)
    await renderAt()

    fireEvent.click(await screen.findByText(/event is tomorrow/i))

    expect(await screen.findByText('Event detail page')).toBeInTheDocument()
  })

  it('clicking a chatActive notification goes to the room chat', async () => {
    getMe.mockResolvedValue({ uid: 'me-1' })
    getNotifications.mockResolvedValue({ items: [{ ...baseItem, type: 'chatActive', targetType: 'room', targetId: 'room-1' }] })
    markNotificationRead.mockResolvedValue(undefined)
    await renderAt()

    fireEvent.click(await screen.findByText(/chat is active/i))

    expect(await screen.findByText('Room chat page')).toBeInTheDocument()
  })

  it('does not call markNotificationRead again for an already-read notification', async () => {
    getMe.mockResolvedValue({ uid: 'me-1' })
    getNotifications.mockResolvedValue({ items: [{ ...baseItem, type: 'followApproved', read: true }] })
    await renderAt()

    fireEvent.click(await screen.findByText(/approved your connect request/i))

    await screen.findByText('Profile page')
    expect(markNotificationRead).not.toHaveBeenCalled()
  })

  it('Clear all marks every notification read and hides itself once there\'s nothing unread left', async () => {
    getMe.mockResolvedValue({ uid: 'me-1' })
    getNotifications.mockResolvedValue({ items: [{ ...baseItem, type: 'followApproved', read: false }] })
    clearAllNotifications.mockResolvedValue(undefined)
    await renderAt()

    await screen.findByText(/approved your connect request/i)
    fireEvent.click(screen.getAllByRole('button', { name: /clear all/i })[0])

    await waitFor(() => expect(clearAllNotifications).toHaveBeenCalled())
    expect(screen.queryByLabelText('Unread')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument()
  })

  it('does not show Clear all when there is nothing unread', async () => {
    getMe.mockResolvedValue({ uid: 'me-1' })
    getNotifications.mockResolvedValue({ items: [{ ...baseItem, type: 'followApproved', read: true }] })
    await renderAt()

    await screen.findByText(/approved your connect request/i)
    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument()
  })

  it('visually distinguishes unread notifications', async () => {
    getMe.mockResolvedValue({ uid: 'me-1' })
    getNotifications.mockResolvedValue({
      items: [
        { ...baseItem, id: 'n1', type: 'followApproved', read: false },
        { ...baseItem, id: 'n2', type: 'followApproved', read: true }
      ]
    })
    await renderAt()

    await screen.findAllByText(/approved your connect request/i)
    expect(screen.getAllByLabelText('Unread')).toHaveLength(1)
  })
})
