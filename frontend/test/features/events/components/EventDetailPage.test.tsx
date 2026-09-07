import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getEvent = vi.fn()
const joinEvent = vi.fn()
const leaveEvent = vi.fn()
const deleteEvent = vi.fn()
vi.mock('../../../../src/features/home/services/homeApi', () => ({ getEvent, joinEvent, leaveEvent, deleteEvent }))

const { EventDetailPage } = await import('../../../../src/features/events/components/EventDetailPage')

afterEach(() => {
  getEvent.mockReset()
  joinEvent.mockReset()
  leaveEvent.mockReset()
  deleteEvent.mockReset()
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
})
