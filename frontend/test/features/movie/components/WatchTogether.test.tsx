import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getUpcomingEvents = vi.fn()
const joinEvent = vi.fn()
const createEvent = vi.fn()
vi.mock('../../../../src/features/home/services/homeApi', () => ({ getUpcomingEvents, joinEvent, createEvent }))

const { WatchTogether } = await import('../../../../src/features/movie/components/WatchTogether')

const events = [
  {
    eventId: 'e1', hostId: 'host-1', movieId: 'm0', title: 'Interstellar Night', datetime: '2099-06-01T20:00:00.000Z',
    mode: 'online' as const, location: null, preciseLocation: null, visibility: 'public' as const, joinCode: null,
    participantLimit: 10, participantCount: 3, requiresApproval: false, roomId: 'r1', createdAt: null,
    movieTitle: 'Interstellar', moviePoster: null
  }
]

afterEach(() => {
  getUpcomingEvents.mockReset()
  joinEvent.mockReset()
  createEvent.mockReset()
})

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<WatchTogether movieId="m0" />} />
        <Route path="/rooms/:roomId" element={<p>Room chat page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('WatchTogether', () => {
  it('fetches events scoped to this movie', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [] })
    renderWithRouter()
    await waitFor(() => expect(getUpcomingEvents).toHaveBeenCalledWith('m0'))
  })

  it('still shows the Create a watch party CTA when there are no upcoming events for this movie', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [] })
    renderWithRouter()
    expect(await screen.findByText(/create a watch party/i)).toBeInTheDocument()
  })

  it('renders each event with title, date, and a Join button', async () => {
    getUpcomingEvents.mockResolvedValue({ items: events })
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Interstellar Night')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^join$/i })).toBeInTheDocument()
  })

  it('joins an event and reflects the joined state', async () => {
    getUpcomingEvents.mockResolvedValue({ items: events })
    joinEvent.mockResolvedValue({ status: 'joined' })
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Interstellar Night')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^join$/i }))

    await waitFor(() => expect(joinEvent).toHaveBeenCalledWith('e1'))
    expect(await screen.findByRole('button', { name: /chat/i })).toBeInTheDocument()
  })

  it('shows Joined immediately on load for an event the backend already reports as joined — real bug: this reverted to "Join" on every page refresh, missed when the same bug was fixed on Home/Events', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [{ ...events[0], joined: true, pending: false }] })
    renderWithRouter()

    expect(await screen.findByRole('button', { name: /chat/i })).toBeInTheDocument()
    expect(joinEvent).not.toHaveBeenCalled()
  })

  it('shows Requested immediately on load for an approval-required event the backend already reports as pending — real bug: this reverted to "Join" on every page refresh, missed when the same bug was fixed on Home/Events', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [{ ...events[0], requiresApproval: true, joined: false, pending: true }] })
    renderWithRouter()

    expect(await screen.findByRole('button', { name: 'Requested' })).toBeDisabled()
    expect(joinEvent).not.toHaveBeenCalled()
  })

  it('opens the create-event form when the CTA is clicked', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [] })
    renderWithRouter()

    fireEvent.click(await screen.findByText(/create a watch party/i))
    expect(screen.getByLabelText(/date.*time/i)).toBeInTheDocument()
  })

  it('creates an online event and refreshes the list', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [] })
    createEvent.mockResolvedValue({ eventId: 'new-1' })
    renderWithRouter()

    fireEvent.click(await screen.findByText(/create a watch party/i))
    fireEvent.change(screen.getByLabelText(/date.*time/i), { target: { value: '2099-06-01T20:00' } })
    fireEvent.click(screen.getByRole('button', { name: /^schedule$/i }))

    await waitFor(() =>
      expect(createEvent).toHaveBeenCalledWith(
        expect.objectContaining({ movieId: 'm0', mode: 'online', visibility: 'public', location: null })
      )
    )
    await waitFor(() => expect(getUpcomingEvents).toHaveBeenCalledTimes(2)) // initial load + refresh after create
  })

  it('blocks submitting an in-person event until location has been captured', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [] })
    renderWithRouter()

    fireEvent.click(await screen.findByText(/create a watch party/i))
    fireEvent.change(screen.getByLabelText(/date.*time/i), { target: { value: '2099-06-01T20:00' } })
    fireEvent.change(screen.getByLabelText(/mode/i), { target: { value: 'in-person' } })
    fireEvent.click(screen.getByRole('button', { name: /^schedule$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/location/i)
    expect(createEvent).not.toHaveBeenCalled()
  })
})
