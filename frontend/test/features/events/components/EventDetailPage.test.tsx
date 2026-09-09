import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getEvent = vi.fn()
const joinEvent = vi.fn()
const leaveEvent = vi.fn()
const deleteEvent = vi.fn()
const getJoinRequests = vi.fn()
const approveJoinRequest = vi.fn()
const denyJoinRequest = vi.fn()
// AppHeader's own dependency — the shared shell every signed-in page renders.
const getNotifications = vi.fn()
vi.mock('../../../../src/features/home/services/homeApi', () => ({
  getEvent,
  joinEvent,
  leaveEvent,
  deleteEvent,
  getJoinRequests,
  approveJoinRequest,
  denyJoinRequest,
  getNotifications
}))
vi.mock('../../../../src/lib/AuthContext', () => ({
  useAuth: () => ({ signOutUser: vi.fn() })
}))

const { EventDetailPage } = await import('../../../../src/features/events/components/EventDetailPage')

beforeEach(() => {
  // AppHeader's own fetch — not this file's focus.
  getNotifications.mockResolvedValue({ items: [] })
})

afterEach(() => {
  getEvent.mockReset()
  joinEvent.mockReset()
  leaveEvent.mockReset()
  deleteEvent.mockReset()
  getJoinRequests.mockReset()
  approveJoinRequest.mockReset()
  denyJoinRequest.mockReset()
  getNotifications.mockReset()
  vi.restoreAllMocks()
})

const me = { uid: 'guest-1', displayName: 'Me', email: 'me@example.com' } as never

const baseEvent = {
  eventId: 'evt-1',
  hostId: 'host-1',
  movieId: 'movie-1',
  title: 'Rooftop watch',
  movieTitle: 'Interstellar',
  moviePoster: null,
  datetime: '2099-06-01T20:00:00.000Z',
  mode: 'online' as const,
  location: null,
  preciseLocation: null,
  visibility: 'public' as const,
  joinCode: null,
  participantLimit: 40,
  participantCount: 18,
  requiresApproval: false,
  roomId: 'room-1',
  createdAt: null,
  hostDisplayName: 'Meera',
  viewerStatus: 'none' as const
}

function renderAt(eventId = 'evt-1') {
  return render(
    <MemoryRouter initialEntries={[`/events/${eventId}`]}>
      <Routes>
        <Route path="/events/:eventId" element={<EventDetailPage me={me} />} />
        <Route path="/events" element={<p>Events list page</p>} />
        <Route path="/rooms/:roomId" element={<p>Room chat page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('EventDetailPage', () => {
  it('renders the event and a Join button for a stranger', async () => {
    getEvent.mockResolvedValue(baseEvent)
    renderAt()

    expect(await screen.findByText('Rooftop watch')).toBeInTheDocument()
    expect(screen.getByText('Meera')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join event' })).toBeInTheDocument()
  })

  it('clicking Join calls joinEvent and switches to the joined state', async () => {
    getEvent.mockResolvedValue(baseEvent)
    joinEvent.mockResolvedValue({ status: 'joined' })
    renderAt()

    fireEvent.click(await screen.findByRole('button', { name: 'Join event' }))

    await waitFor(() => expect(joinEvent).toHaveBeenCalledWith('evt-1'))
    expect(await screen.findByRole('button', { name: 'Chat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument()
  })

  it('shows Requested (disabled) when the join created a pending request', async () => {
    getEvent.mockResolvedValue(baseEvent)
    joinEvent.mockResolvedValue({ status: 'pending' })
    renderAt()

    fireEvent.click(await screen.findByRole('button', { name: 'Join event' }))

    const requested = await screen.findByRole('button', { name: 'Requested' })
    expect(requested).toBeDisabled()
  })

  it('already-joined viewers see Chat/Leave immediately, no Join click needed', async () => {
    getEvent.mockResolvedValue({ ...baseEvent, viewerStatus: 'joined' })
    renderAt()

    expect(await screen.findByRole('button', { name: 'Chat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Join event' })).not.toBeInTheDocument()
  })

  describe('in-person event location', () => {
    const inPersonEvent = {
      ...baseEvent,
      mode: 'in-person' as const,
      location: { area: 'Bandra West', city: 'Mumbai' }
    }

    it('shows a Get directions link to Google Maps once joined and the backend has released the exact coordinates', async () => {
      getEvent.mockResolvedValue({ ...inPersonEvent, viewerStatus: 'joined', preciseLocation: { lat: 19.0596, lng: 72.8295 } })
      renderAt()

      const link = await screen.findByRole('link', { name: /get directions/i })
      expect(link).toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=19.0596,72.8295')
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('shows the host their own event\'s directions too', async () => {
      getEvent.mockResolvedValue({ ...inPersonEvent, viewerStatus: 'host', preciseLocation: { lat: 19.0596, lng: 72.8295 } })
      renderAt()

      expect(await screen.findByRole('link', { name: /get directions/i })).toBeInTheDocument()
    })

    it('does not show a directions link before joining — the backend never releases exact coordinates pre-join', async () => {
      getEvent.mockResolvedValue({ ...inPersonEvent, viewerStatus: 'none', preciseLocation: null })
      renderAt()

      await screen.findByText('Bandra West, Mumbai')
      expect(screen.queryByRole('link', { name: /get directions/i })).not.toBeInTheDocument()
    })

    it('shows no directions link for an online event even if joined', async () => {
      getEvent.mockResolvedValue({ ...baseEvent, mode: 'online', viewerStatus: 'joined' })
      renderAt()

      await screen.findByRole('button', { name: 'Chat' })
      expect(screen.queryByRole('link', { name: /get directions/i })).not.toBeInTheDocument()
    })
  })

  it('the host sees Cancel event instead of Join, and it deletes then navigates back to Events', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    getEvent.mockResolvedValue({ ...baseEvent, hostId: 'guest-1', viewerStatus: 'host' })
    deleteEvent.mockResolvedValue(undefined)
    renderAt()

    const cancelButton = await screen.findByRole('button', { name: 'Cancel event' })
    fireEvent.click(cancelButton)

    await waitFor(() => expect(deleteEvent).toHaveBeenCalledWith('evt-1'))
    expect(await screen.findByText('Events list page')).toBeInTheDocument()
  })

  it('shows an error message when the event fails to load', async () => {
    getEvent.mockRejectedValue(new Error('No such event'))
    renderAt()

    expect(await screen.findByRole('alert')).toHaveTextContent('No such event')
  })

  describe('join requests (host only)', () => {
    const hostEvent = { ...baseEvent, hostId: 'guest-1', viewerStatus: 'host' as const, requiresApproval: true }

    it("fetches and shows each pending requester, with Approve/Deny — the gap this closes: there was previously no way for a host to act on a request at all", async () => {
      getEvent.mockResolvedValue(hostEvent)
      getJoinRequests.mockResolvedValue({ requested: [{ uid: 'req-1', displayName: 'Rohan' }], approved: [], denied: [] })
      renderAt()

      await waitFor(() => expect(getJoinRequests).toHaveBeenCalledWith('evt-1'))
      expect(await screen.findByText('Rohan')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument()
    })

    it('does not fetch join requests when the event does not require approval', async () => {
      getEvent.mockResolvedValue({ ...hostEvent, requiresApproval: false })
      renderAt()

      await screen.findByRole('button', { name: 'Cancel event' })
      expect(getJoinRequests).not.toHaveBeenCalled()
    })

    it('does not fetch join requests for a non-host viewer, even on an approval-required event', async () => {
      getEvent.mockResolvedValue({ ...baseEvent, requiresApproval: true, viewerStatus: 'none' })
      renderAt()

      await screen.findByRole('button', { name: 'Join event' })
      expect(getJoinRequests).not.toHaveBeenCalled()
    })

    it('shows no join-requests section when there are none pending', async () => {
      getEvent.mockResolvedValue(hostEvent)
      getJoinRequests.mockResolvedValue({ requested: [], approved: [], denied: [] })
      renderAt()

      await waitFor(() => expect(getJoinRequests).toHaveBeenCalled())
      expect(screen.queryByText(/join request/i)).not.toBeInTheDocument()
    })

    it('clicking Approve calls approveJoinRequest, moving that requester into the Approved list', async () => {
      getEvent.mockResolvedValue(hostEvent)
      getJoinRequests.mockResolvedValue({ requested: [{ uid: 'req-1', displayName: 'Rohan' }], approved: [], denied: [] })
      approveJoinRequest.mockResolvedValue(undefined)
      renderAt()

      await screen.findByText('Rohan')
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

      await waitFor(() => expect(approveJoinRequest).toHaveBeenCalledWith('evt-1', 'req-1'))
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument())
      // still visible — just moved out of the pending section, into Approved
      expect(screen.getByText('Rohan')).toBeInTheDocument()
    })

    it('clicking Deny calls denyJoinRequest, moving that requester into the Denied list', async () => {
      getEvent.mockResolvedValue(hostEvent)
      getJoinRequests.mockResolvedValue({ requested: [{ uid: 'req-1', displayName: 'Rohan' }], approved: [], denied: [] })
      denyJoinRequest.mockResolvedValue(undefined)
      renderAt()

      await screen.findByText('Rohan')
      fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

      await waitFor(() => expect(denyJoinRequest).toHaveBeenCalledWith('evt-1', 'req-1'))
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Deny' })).not.toBeInTheDocument())
      // still visible — just moved out of the pending section, into Denied
      expect(screen.getByText('Rohan')).toBeInTheDocument()
    })

    it('shows an error and leaves the request in the list when approving fails', async () => {
      getEvent.mockResolvedValue(hostEvent)
      getJoinRequests.mockResolvedValue({ requested: [{ uid: 'req-1', displayName: 'Rohan' }], approved: [], denied: [] })
      approveJoinRequest.mockRejectedValue(new Error('This event is at capacity'))
      renderAt()

      await screen.findByText('Rohan')
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('This event is at capacity')
      expect(screen.getByText('Rohan')).toBeInTheDocument()
    })

    it("shows who's already been approved, read-only (no Approve/Deny — they're already in)", async () => {
      getEvent.mockResolvedValue(hostEvent)
      getJoinRequests.mockResolvedValue({ requested: [], approved: [{ uid: 'p-1', displayName: 'Priya' }], denied: [] })
      renderAt()

      expect(await screen.findByText('Priya')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Deny' })).not.toBeInTheDocument()
    })

    it('shows who has been denied, so the host has a record of past decisions', async () => {
      getEvent.mockResolvedValue(hostEvent)
      getJoinRequests.mockResolvedValue({ requested: [], approved: [], denied: [{ uid: 'd-1', displayName: 'Vikram' }] })
      renderAt()

      expect(await screen.findByText('Vikram')).toBeInTheDocument()
    })
  })
})
