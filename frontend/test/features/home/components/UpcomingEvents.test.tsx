import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getUpcomingEvents = vi.fn()
const joinEvent = vi.fn()
vi.mock('../../../../src/features/home/services/homeApi', () => ({ getUpcomingEvents, joinEvent }))

const { UpcomingEvents } = await import('../../../../src/features/home/components/UpcomingEvents')

const event = {
  eventId: 'evt-1',
  hostId: 'host-1',
  movieId: 'm1',
  title: 'Interstellar Watch Party',
  datetime: '2099-06-01T20:00:00.000Z',
  mode: 'online' as const,
  location: null,
  visibility: 'public' as const,
  participantLimit: 5,
  participantCount: 2,
  requiresApproval: false,
  roomId: 'room-1',
  movieTitle: 'Interstellar',
  moviePoster: null
}

afterEach(() => {
  getUpcomingEvents.mockReset()
  joinEvent.mockReset()
})

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<UpcomingEvents />} />
        <Route path="/rooms/:roomId" element={<p>Room chat page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('UpcomingEvents', () => {
  it('shows an empty-state message when there are no public events', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [] })
    renderWithRouter()
    await waitFor(() => expect(screen.getByText(/no public events/i)).toBeInTheDocument())
  })

  it('renders an event and joins it on click, the button itself becoming Chat', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [event] })
    joinEvent.mockResolvedValue({ status: 'joined' })
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Interstellar Watch Party')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /join/i }))

    await waitFor(() => expect(joinEvent).toHaveBeenCalledWith('evt-1'))
    // Chat, not a disabled "Joined" — you're in, so the button takes you
    // straight to the room instead of just sitting there inert.
    expect(await screen.findByRole('button', { name: /^chat$/i })).not.toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Joined' })).not.toBeInTheDocument()
  })

  it('shows Requested when the event requires approval', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [event] })
    joinEvent.mockResolvedValue({ status: 'pending' })
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Interstellar Watch Party')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /join/i }))

    expect(await screen.findByRole('button', { name: 'Requested' })).toBeDisabled()
  })

  it('shows area/city for an in-person event', async () => {
    getUpcomingEvents.mockResolvedValue({
      items: [{ ...event, mode: 'in-person' as const, location: { area: 'Bandra West', city: 'Mumbai' }, preciseLocation: null }]
    })
    renderWithRouter()

    expect(await screen.findByText('Bandra West, Mumbai')).toBeInTheDocument()
  })

  it('shows Chat immediately on load for an event the backend already reports as joined — real bug: this used to reset to "Join" on every page refresh', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [{ ...event, joined: true }] })
    renderWithRouter()

    expect(await screen.findByRole('button', { name: /^chat$/i })).not.toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Joined' })).not.toBeInTheDocument()
    expect(joinEvent).not.toHaveBeenCalled()
  })

  it('shows Requested immediately on load for an approval-required event the backend already reports as pending — real bug: this used to reset to "Join" on every page refresh, indistinguishable from never having requested', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [{ ...event, requiresApproval: true, joined: false, pending: true }] })
    renderWithRouter()

    expect(await screen.findByRole('button', { name: 'Requested' })).toBeDisabled()
    expect(joinEvent).not.toHaveBeenCalled()
  })

  it('the Join button becomes Chat once joined, opening the event\'s room', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [event] })
    joinEvent.mockResolvedValue({ status: 'joined' })
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Interstellar Watch Party')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^chat$/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /join/i }))
    expect(await screen.findAllByRole('button', { name: /^chat$/i })).toHaveLength(1) // one button, not Joined+Chat side by side
    fireEvent.click(screen.getByRole('button', { name: /^chat$/i }))

    expect(await screen.findByText('Room chat page')).toBeInTheDocument()
  })
})
