import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getNotifications = vi.fn()
const markNotificationRead = vi.fn()
const clearAllNotifications = vi.fn()
vi.mock('../../src/features/home/services/homeApi', () => ({
  getNotifications,
  markNotificationRead,
  clearAllNotifications
}))

const { NotificationBell } = await import('../../src/components/NotificationBell')

afterEach(() => {
  getNotifications.mockReset()
  markNotificationRead.mockReset()
  clearAllNotifications.mockReset()
})

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<NotificationBell />} />
        <Route path="/notifications" element={<p>Notifications page</p>} />
        <Route path="/profile/:uid" element={<p>Profile page</p>} />
        <Route path="/events/:eventId" element={<p>Event detail page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

const item = {
  id: 'n1',
  type: 'followApproved' as const,
  fromUserId: 'friend-1',
  fromUserDisplayName: 'Rohan',
  fromUserPhotoURL: null,
  targetType: null,
  targetId: null,
  read: false,
  createdAt: new Date().toISOString()
}

describe('NotificationBell', () => {
  it('shows the unread count badge on mount', async () => {
    getNotifications.mockResolvedValue({ items: [item] })
    renderWithRouter()

    await waitFor(() => expect(getNotifications).toHaveBeenCalledWith(true))
    expect(await screen.findByLabelText('1 unread notifications')).toBeInTheDocument()
  })

  it('opens a dropdown of recent notifications on click, closed by default', async () => {
    getNotifications.mockResolvedValue({ items: [item] })
    renderWithRouter()

    expect(screen.queryByText(/approved your connect request/i)).not.toBeInTheDocument()

    fireEvent.click(await screen.findByLabelText(/unread notifications/i))
    expect(await screen.findByText(/approved your connect request/i)).toBeInTheDocument()
  })

  it('shows an empty state when there are no notifications', async () => {
    getNotifications.mockResolvedValue({ items: [] })
    renderWithRouter()

    fireEvent.click(await screen.findByLabelText(/unread notifications/i))
    expect(await screen.findByText(/no notifications/i)).toBeInTheDocument()
  })

  it('clicking a notification marks it read, navigates, and closes the dropdown', async () => {
    getNotifications.mockResolvedValue({ items: [item] })
    markNotificationRead.mockResolvedValue(undefined)
    renderWithRouter()

    fireEvent.click(await screen.findByLabelText(/unread notifications/i))
    fireEvent.click(await screen.findByText(/approved your connect request/i))

    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith('n1'))
    expect(await screen.findByText('Profile page')).toBeInTheDocument()
    expect(screen.queryByText(/approved your connect request/i)).not.toBeInTheDocument()
  })

  it('"View all" navigates to /notifications and closes the dropdown', async () => {
    getNotifications.mockResolvedValue({ items: [item] })
    renderWithRouter()

    fireEvent.click(await screen.findByLabelText(/unread notifications/i))
    fireEvent.click(await screen.findByRole('button', { name: /view all/i }))

    expect(await screen.findByText('Notifications page')).toBeInTheDocument()
  })

  it('"Clear all" marks everything read and resets the badge to zero', async () => {
    getNotifications.mockResolvedValue({ items: [item] })
    clearAllNotifications.mockResolvedValue(undefined)
    renderWithRouter()

    await screen.findByLabelText('1 unread notifications')
    fireEvent.click(screen.getByLabelText(/unread notifications/i))
    fireEvent.click(await screen.findByRole('button', { name: /clear all/i }))

    await waitFor(() => expect(clearAllNotifications).toHaveBeenCalled())
    expect(await screen.findByLabelText('0 unread notifications')).toBeInTheDocument()
  })

  it('re-polls the unread count every 90s, picking up a notification that arrived while the page just sat there', async () => {
    // shouldAdvanceTime: true — real setTimeout/microtask progress for
    // findByLabelText's internal polling and the mocked fetch's promise,
    // while still letting advanceTimersByTimeAsync fast-forward the 90s
    // interval on demand.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      getNotifications.mockResolvedValue({ items: [] })
      renderWithRouter()
      expect(await screen.findByLabelText('0 unread notifications')).toBeInTheDocument()
      expect(getNotifications).toHaveBeenCalledTimes(1)

      getNotifications.mockResolvedValue({ items: [item] })
      await vi.advanceTimersByTimeAsync(90_000)

      expect(getNotifications).toHaveBeenCalledTimes(2)
      expect(await screen.findByLabelText('1 unread notifications')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops polling once unmounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      getNotifications.mockResolvedValue({ items: [] })
      const { unmount } = renderWithRouter()
      await screen.findByLabelText('0 unread notifications')
      expect(getNotifications).toHaveBeenCalledTimes(1)

      unmount()
      await vi.advanceTimersByTimeAsync(90_000)

      expect(getNotifications).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
