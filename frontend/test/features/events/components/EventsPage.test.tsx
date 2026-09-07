import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getUpcomingEvents = vi.fn()
const getHostedEvents = vi.fn()
const joinEvent = vi.fn()
const createEvent = vi.fn()
vi.mock('../../../../src/features/home/services/homeApi', () => ({ getUpcomingEvents, getHostedEvents, joinEvent, createEvent }))

const searchMovies = vi.fn()
vi.mock('../../../../src/features/movie/services/movieApi', () => ({ searchMovies }))

const { EventsPage } = await import('../../../../src/features/events/components/EventsPage')

afterEach(() => {
  getUpcomingEvents.mockReset()
  getHostedEvents.mockReset()
  joinEvent.mockReset()
  createEvent.mockReset()
  searchMovies.mockReset()
})

const upcomingEvent = {
  eventId: 'evt-1',
  hostId: 'host-1',
  movieId: 'movie-1',
  title: null,
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
  createdAt: null
}

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/events']}>
      <Routes>
        <Route path="/events" element={<EventsPage />} />
        <Route path="/events/:eventId" element={<p>Event detail page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('EventsPage', () => {
  it('loads and renders the Upcoming tab by default', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [upcomingEvent] })
    renderWithRouter()

    expect(await screen.findByText('Interstellar')).toBeInTheDocument()
    expect(getUpcomingEvents).toHaveBeenCalled()
    expect(getHostedEvents).not.toHaveBeenCalled()
  })

  it('switches to the Hosting tab and fetches hosted events instead', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [] })
    getHostedEvents.mockResolvedValue({ items: [{ ...upcomingEvent, eventId: 'evt-2', title: 'My Party' }] })
    renderWithRouter()

    await waitFor(() => expect(getUpcomingEvents).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Hosting' }))

    expect(await screen.findByText('My Party')).toBeInTheDocument()
    expect(getHostedEvents).toHaveBeenCalled()
  })

  it('shows an empty state instead of nothing when there are no upcoming events', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [] })
    renderWithRouter()

    expect(await screen.findByText(/No public events coming up yet/i)).toBeInTheDocument()
  })

  it('clicking Join calls joinEvent and reflects the Joined state', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [upcomingEvent] })
    joinEvent.mockResolvedValue({ status: 'joined' })
    renderWithRouter()

    const joinButton = await screen.findByRole('button', { name: 'Join' })
    fireEvent.click(joinButton)

    await waitFor(() => expect(joinEvent).toHaveBeenCalledWith('evt-1'))
    expect(await screen.findByText('Joined')).toBeInTheDocument()
  })

  it('clicking an event row navigates to its detail page, without triggering Join', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [upcomingEvent] })
    renderWithRouter()

    fireEvent.click(await screen.findByText('Interstellar'))

    expect(await screen.findByText('Event detail page')).toBeInTheDocument()
    expect(joinEvent).not.toHaveBeenCalled()
  })

  it('opens the create-event modal from "Host a watch party"', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [] })
    renderWithRouter()

    await waitFor(() => expect(getUpcomingEvents).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /host a watch party/i }))

    expect(screen.getByRole('dialog', { name: /host a watch party/i })).toBeInTheDocument()
  })
})
