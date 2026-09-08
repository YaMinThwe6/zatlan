import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getUpcomingEvents = vi.fn()
vi.mock('../../../../src/features/home/services/homeApi', () => ({ getUpcomingEvents }))

const { WatchTogetherGuest } = await import('../../../../src/features/movie/components/WatchTogetherGuest')

const event = {
  eventId: 'e1',
  hostId: 'host-1',
  movieId: 'm0',
  title: 'Interstellar Night',
  datetime: '2099-06-01T20:00:00.000Z',
  mode: 'online' as const,
  location: null,
  preciseLocation: null,
  visibility: 'public' as const,
  joinCode: null,
  participantLimit: 10,
  participantCount: 3,
  requiresApproval: false,
  roomId: 'r1',
  createdAt: null,
  joined: false,
  movieTitle: 'Interstellar',
  moviePoster: null
}

afterEach(() => {
  getUpcomingEvents.mockReset()
})

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<WatchTogetherGuest movieId="m0" />} />
        <Route path="/get-started" element={<p>Get started page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('WatchTogetherGuest', () => {
  it('fetches events scoped to this movie', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [] })
    renderWithRouter()
    await waitFor(() => expect(getUpcomingEvents).toHaveBeenCalledWith('m0'))
  })

  it('renders nothing when no watch party is scheduled for this movie — a guest can\'t host one, so there\'s no evergreen CTA to fall back to', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [] })
    const { container } = renderWithRouter()
    await waitFor(() => expect(getUpcomingEvents).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while loading or if the fetch fails, rather than showing an error to a guest', async () => {
    getUpcomingEvents.mockRejectedValue(new Error('network error'))
    const { container } = renderWithRouter()
    await waitFor(() => expect(getUpcomingEvents).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a scheduled watch party with a Sign in to join CTA, not a real Join button', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [event] })
    renderWithRouter()

    expect(await screen.findByText('Interstellar Night')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in to join/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^join$/i })).not.toBeInTheDocument()
  })

  it('navigates to Get Started when Sign in to join is clicked', async () => {
    getUpcomingEvents.mockResolvedValue({ items: [event] })
    renderWithRouter()

    fireEvent.click(await screen.findByRole('button', { name: /sign in to join/i }))
    expect(await screen.findByText('Get started page')).toBeInTheDocument()
  })
})
