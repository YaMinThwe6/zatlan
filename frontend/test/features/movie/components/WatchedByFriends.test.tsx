import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getMovieWatchedBy = vi.fn()
vi.mock('../../../../src/features/movie/services/movieApi', () => ({ getMovieWatchedBy }))

const { WatchedByFriends } = await import('../../../../src/features/movie/components/WatchedByFriends')

afterEach(() => getMovieWatchedBy.mockReset())

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/movie/movie-1']}>
      <Routes>
        <Route path="/movie/:movieId" element={ui} />
        <Route path="/profile/:uid" element={<p>Profile page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('WatchedByFriends', () => {
  it('renders nothing while loading', () => {
    getMovieWatchedBy.mockReturnValue(new Promise(() => {})) // never resolves
    const { container } = renderWithRouter(<WatchedByFriends movieId="movie-1" watched={false} onMarkWatched={vi.fn()} onInviteFriend={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the request fails, rather than an error in a minor social section', async () => {
    getMovieWatchedBy.mockRejectedValue(new Error('boom'))
    const { container } = renderWithRouter(<WatchedByFriends movieId="movie-1" watched={false} onMarkWatched={vi.fn()} onInviteFriend={vi.fn()} />)
    await waitFor(() => expect(getMovieWatchedBy).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('invites the caller to mark it watched when no followed friend has, and they haven\'t watched it either — real bug: this used to just leave a blank column beside "About"', async () => {
    getMovieWatchedBy.mockResolvedValue({ items: [], nextCursor: null })
    const onMarkWatched = vi.fn()
    renderWithRouter(<WatchedByFriends movieId="movie-1" watched={false} onMarkWatched={onMarkWatched} onInviteFriend={vi.fn()} />)

    await waitFor(() => expect(getMovieWatchedBy).toHaveBeenCalledWith('movie-1'))
    const button = screen.getByRole('button', { name: /mark as watched/i })
    fireEvent.click(button)
    expect(onMarkWatched).toHaveBeenCalled()
  })

  it('invites the caller to start a watch party when they\'ve already watched it but no followed friend has', async () => {
    getMovieWatchedBy.mockResolvedValue({ items: [], nextCursor: null })
    const onInviteFriend = vi.fn()
    renderWithRouter(<WatchedByFriends movieId="movie-1" watched={true} onMarkWatched={vi.fn()} onInviteFriend={onInviteFriend} />)

    await waitFor(() => expect(getMovieWatchedBy).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /invite a friend/i }))
    expect(onInviteFriend).toHaveBeenCalled()
  })

  it('renders each followed watcher by display name', async () => {
    getMovieWatchedBy.mockResolvedValue({
      items: [
        { uid: 'u1', displayName: 'Rohan', watchedAt: '2026-01-01T00:00:00.000Z' },
        { uid: 'u2', displayName: 'Meera', watchedAt: '2026-01-02T00:00:00.000Z' }
      ],
      nextCursor: null
    })
    renderWithRouter(<WatchedByFriends movieId="movie-1" watched={false} onMarkWatched={vi.fn()} onInviteFriend={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Rohan')).toBeInTheDocument())
    expect(screen.getByText('Meera')).toBeInTheDocument()
  })

  it('opens the profile when a watcher\'s name is clicked', async () => {
    getMovieWatchedBy.mockResolvedValue({
      items: [{ uid: 'u1', displayName: 'Rohan', watchedAt: '2026-01-01T00:00:00.000Z' }],
      nextCursor: null
    })
    renderWithRouter(<WatchedByFriends movieId="movie-1" watched={false} onMarkWatched={vi.fn()} onInviteFriend={vi.fn()} />)

    fireEvent.click(await screen.findByText('Rohan'))
    expect(await screen.findByText('Profile page')).toBeInTheDocument()
  })
})
