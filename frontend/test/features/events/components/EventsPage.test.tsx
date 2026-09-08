import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getUpcomingEvents = vi.fn()
const getHostedEvents = vi.fn()
const joinEvent = vi.fn()
const createEvent = vi.fn()
// AppHeader's own dependency — the shared shell every signed-in page renders.
const getNotifications = vi.fn()
vi.mock('../../../../src/features/home/services/homeApi', () => ({ getUpcomingEvents, getHostedEvents, joinEvent, createEvent, getNotifications }))

const searchMovies = vi.fn()
vi.mock('../../../../src/features/movie/services/movieApi', () => ({ searchMovies }))

const getMe = vi.fn()
vi.mock('../../../../src/lib/api', () => ({ getMe }))
vi.mock('../../../../src/lib/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'host-1' }, loading: false, signInWithGoogle: vi.fn(), signInWithMicrosoft: vi.fn(), signInWithToken: vi.fn(), signOutUser: vi.fn() })
}))

const { EventsPage } = await import('../../../../src/features/events/components/EventsPage')

beforeEach(() => {
  // AppHeader's own fetches — not this file's focus.
  getNotifications.mockResolvedValue({ items: [] })
  getMe.mockResolvedValue({ uid: 'host-1', displayName: 'Yamin', email: 'yamin@example.com' })
})

afterEach(() => {
  getUpcomingEvents.mockReset()
  getHostedEvents.mockReset()
  joinEvent.mockReset()
  createEvent.mockReset()
  searchMovies.mockReset()
  getNotifications.mockReset()
  getMe.mockReset()
})

const upcomingEvent = {
  eventId: 'evt-1',
  hostId: 'host-1',
  movieId: 'movie-1',
  title: null,
  movieTitle: 'Interstellar',
  moviePoster: null,
  hostDisplayName: 'Asha',
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

  it('shows a "Host a watch party" CTA on the Hosting tab\'s empty state, opening the create-event modal — the old message had no way to act on it', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [] })
    getHostedEvents.mockResolvedValue({ items: [] })
    renderWithRouter()

    await waitFor(() => expect(getUpcomingEvents).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Hosting' }))

    expect(await screen.findByText(/not hosting any upcoming events/i)).toBeInTheDocument()
    // Two matches now — the header's persistent button and the empty
    // state's own dedicated CTA. Asserting the count, not just "one of them
    // works", is what actually proves the empty state grew its own button
    // rather than this test passing by coincidence via the header's.
    const ctas = screen.getAllByRole('button', { name: /host a watch party/i })
    expect(ctas.length).toBe(2)
    fireEvent.click(ctas[ctas.length - 1])
    expect(screen.getByRole('dialog', { name: /host a watch party/i })).toBeInTheDocument()
  })

  it('shows Requested immediately on load for an approval-required event the backend already reports as pending — real bug: this used to reset to "Join" on every page refresh', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [{ ...upcomingEvent, requiresApproval: true, joined: false, pending: true }] })
    renderWithRouter()

    expect(await screen.findByRole('button', { name: 'Requested' })).toBeDisabled()
    expect(joinEvent).not.toHaveBeenCalled()
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

  it('clears the previous tab\'s items when switching tabs, so a slow or failed fetch never shows stale rows under the wrong tab\'s action label', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [upcomingEvent] })
    let rejectHosting!: (err: Error) => void
    getHostedEvents.mockReturnValue(new Promise((_resolve, reject) => { rejectHosting = reject }))
    renderWithRouter()

    expect(await screen.findByText('Interstellar')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hosting' }))

    // Stale "Upcoming" row must be gone immediately on switching tabs, not
    // just once the new (still-pending) fetch eventually settles.
    await waitFor(() => expect(screen.queryByText('Interstellar')).not.toBeInTheDocument())

    rejectHosting(new Error('boom'))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(screen.queryByText('Interstellar')).not.toBeInTheDocument()
  })

  it('opens the create-event modal from "Host a watch party"', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [] })
    renderWithRouter()

    await waitFor(() => expect(getUpcomingEvents).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /host a watch party/i }))

    expect(screen.getByRole('dialog', { name: /host a watch party/i })).toBeInTheDocument()
  })

  it('shows the host\'s display name on an Upcoming card', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [upcomingEvent] })
    renderWithRouter()

    expect(await screen.findByText(/hosted by asha/i)).toBeInTheDocument()
  })

  it('omits the host line on the Hosting tab — redundant, it\'s always the caller\'s own event', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [] })
    getHostedEvents.mockResolvedValue({ items: [upcomingEvent] })
    renderWithRouter()

    await waitFor(() => expect(getUpcomingEvents).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Hosting' }))

    expect(await screen.findByText('Interstellar')).toBeInTheDocument()
    expect(screen.queryByText(/hosted by/i)).not.toBeInTheDocument()
  })

  describe('mode filter chips', () => {
    const onlineEvent = { ...upcomingEvent, eventId: 'evt-online', movieTitle: 'Online Movie', mode: 'online' as const }
    const inPersonEvent = {
      ...upcomingEvent,
      eventId: 'evt-in-person',
      movieTitle: 'In Person Movie',
      mode: 'in-person' as const,
      location: { area: 'Guindy', city: 'Chennai' }
    }

    it('shows every mode by default', async () => {
      getUpcomingEvents.mockResolvedValue({ items: [onlineEvent, inPersonEvent] })
      renderWithRouter()

      expect(await screen.findByText('Online Movie')).toBeInTheDocument()
      expect(screen.getByText('In Person Movie')).toBeInTheDocument()
    })

    it('filters down to only Online when that chip is clicked', async () => {
      getUpcomingEvents.mockResolvedValue({ items: [onlineEvent, inPersonEvent] })
      renderWithRouter()

      await screen.findByText('Online Movie')
      fireEvent.click(screen.getByRole('button', { name: 'Online' }))

      expect(screen.getByText('Online Movie')).toBeInTheDocument()
      expect(screen.queryByText('In Person Movie')).not.toBeInTheDocument()
    })

    it('filters down to only In-person when that chip is clicked', async () => {
      getUpcomingEvents.mockResolvedValue({ items: [onlineEvent, inPersonEvent] })
      renderWithRouter()

      await screen.findByText('Online Movie')
      fireEvent.click(screen.getByRole('button', { name: 'In-person' }))

      expect(screen.queryByText('Online Movie')).not.toBeInTheDocument()
      expect(screen.getByText('In Person Movie')).toBeInTheDocument()
    })
  })

  describe('sort control', () => {
    const soonEvent = { ...upcomingEvent, eventId: 'evt-soon', movieTitle: 'Soon Movie', datetime: '2099-01-01T12:00:00.000Z', participantCount: 2 }
    const laterButPopularEvent = {
      ...upcomingEvent,
      eventId: 'evt-popular',
      movieTitle: 'Popular Movie',
      datetime: '2099-06-01T12:00:00.000Z',
      participantCount: 39
    }

    it('defaults to soonest first', async () => {
      getUpcomingEvents.mockResolvedValue({ items: [laterButPopularEvent, soonEvent] })
      renderWithRouter()

      const titles = (await screen.findAllByText(/movie$/i)).map((el) => el.textContent)
      expect(titles).toEqual(['Soon Movie', 'Popular Movie'])
    })

    it('reorders to most popular first when that sort is chosen', async () => {
      getUpcomingEvents.mockResolvedValue({ items: [soonEvent, laterButPopularEvent] })
      renderWithRouter()

      await screen.findByText('Soon Movie')
      fireEvent.change(screen.getByLabelText(/sort/i), { target: { value: 'popular' } })

      const titles = screen.getAllByText(/movie$/i).map((el) => el.textContent)
      expect(titles).toEqual(['Popular Movie', 'Soon Movie'])
    })
  })

  it('groups events under This week / This weekend / Next week / Later headers', async () => {
    // shouldAdvanceTime: true — real setTimeout/microtask progress for
    // findByText's internal polling and the mocked fetch's promise, while
    // Date() itself stays fixed for eventDateGroup's "now".
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-01-06T12:00:00.000Z')) // Tuesday
    try {
      getUpcomingEvents.mockResolvedValue({
        items: [
          { ...upcomingEvent, eventId: 'evt-week', movieTitle: 'This Week Movie', datetime: '2026-01-08T12:00:00.000Z' },
          { ...upcomingEvent, eventId: 'evt-weekend', movieTitle: 'Weekend Movie', datetime: '2026-01-10T12:00:00.000Z' },
          { ...upcomingEvent, eventId: 'evt-next', movieTitle: 'Next Week Movie', datetime: '2026-01-12T12:00:00.000Z' },
          { ...upcomingEvent, eventId: 'evt-later', movieTitle: 'Later Movie', datetime: '2026-02-01T12:00:00.000Z' }
        ]
      })
      renderWithRouter()

      expect(await screen.findByText('This Week Movie')).toBeInTheDocument()
      const headers = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
      expect(headers).toEqual(['This week', 'This weekend', 'Next week', 'Later'])
    } finally {
      vi.useRealTimers()
    }
  })
})
