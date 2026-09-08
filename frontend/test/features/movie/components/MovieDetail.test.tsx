import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getMovie = vi.fn()
const getMovieStatus = vi.fn()
const getMovieReviews = vi.fn()
const submitReview = vi.fn()
const deleteReview = vi.fn()
const addToWatchlist = vi.fn()
const removeFromWatchlist = vi.fn()
const markWatched = vi.fn()
const unmarkWatched = vi.fn()
const likeMovie = vi.fn()
const unlikeMovie = vi.fn()
// Not the focus of these tests — defaulted once so WatchedByFriends' own fetch
// doesn't need setup in every test (vi.clearAllMocks() below clears call
// history, not this mockResolvedValue).
const getMovieWatchedBy = vi.fn().mockResolvedValue({ items: [], nextCursor: null })
// SimilarPicks' own dependency — same "rendered for real, not the focus of
// these tests" treatment as getMovieWatchedBy above.
const getSimilarMovies = vi.fn().mockResolvedValue({ items: [] })

vi.mock('../../../../src/features/movie/services/movieApi', () => ({
  getMovie,
  getMovieStatus,
  getMovieReviews,
  submitReview,
  deleteReview,
  addToWatchlist,
  removeFromWatchlist,
  markWatched,
  unmarkWatched,
  likeMovie,
  unlikeMovie,
  getMovieWatchedBy,
  getSimilarMovies
}))

// AppHeader's + WatchTogether's own dependencies (rendered for real below,
// not mocked away, same as Sidebar/MobileTabBar — none of these have anything
// specific to MovieDetail worth asserting here beyond "the shell is there").
const getMe = vi.fn().mockResolvedValue({ displayName: 'Yamin', email: 'yamin@example.com' })
vi.mock('../../../../src/lib/api', () => ({ getMe }))
const getNotifications = vi.fn().mockResolvedValue({ items: [] })
const getUpcomingEvents = vi.fn().mockResolvedValue({ items: [] })
const joinEvent = vi.fn()
const createEvent = vi.fn()
vi.mock('../../../../src/features/home/services/homeApi', () => ({ getNotifications, getUpcomingEvents, joinEvent, createEvent }))

// Every test below exercises the signed-in path unless it opts into
// mockAuthUser(null) itself — that matches this file's existing tests, which
// all predate guest mode and assert signed-in behavior throughout.
let authUser: { uid: string } | null = { uid: 'uid-1' }
function mockAuthUser(user: { uid: string } | null) {
  authUser = user
}
vi.mock('../../../../src/lib/AuthContext', () => ({
  useAuth: () => ({ user: authUser, loading: false, signInWithGoogle: vi.fn(), signInWithMicrosoft: vi.fn(), signInWithToken: vi.fn(), signOutUser: vi.fn() })
}))

const { MovieDetail } = await import('../../../../src/features/movie/components/MovieDetail')

const movie = {
  movieId: 'movie-1',
  title: 'Dune: Part Two',
  poster: null,
  year: 2024,
  runtime: 166,
  genres: ['Sci-Fi', 'Adventure'],
  synopsis: 'Paul Atreides unites with Chani and the Fremen.',
  cast: [{ personId: 'p1', name: 'Timothee Chalamet', character: 'Paul Atreides', photo: null }],
  crew: [{ personId: 'p2', name: 'Denis Villeneuve', role: 'Director', photo: null }],
  voteAverage: 8.3,
  voteCount: 4200,
  trailerKey: null,
  streamingProviders: [{ name: 'Netflix', type: 'subscription' as const, logo: '' }],
  binjRating: { sum: 0, count: 0 },
  likeCount: 0
}

const emptyStatus = { watchlisted: false, watched: false, liked: false, review: null }

function mockDefaults() {
  getMovie.mockResolvedValue(movie)
  getMovieStatus.mockResolvedValue(emptyStatus)
  getMovieReviews.mockResolvedValue({ items: [], nextCursor: null })
}

// The Watchlist/Watched/Like action-bar buttons (ActionButton in
// MovieDetail.tsx) share their exact accessible name with Sidebar's own
// "Watchlist"/"Watched"/"Ratings & Reviews" nav rows (rendered for real
// alongside this page, not mocked away) — an ordinary getAllByRole(...)[0]
// stopped reliably picking the real toggle once Sidebar's rows became real
// buttons instead of a disabled <div>. ActionButton is the only one of the
// two that's an actual pressed/unpressed toggle (aria-pressed set), so that's
// the real distinguishing feature — not DOM order, which is fragile.
function actionButton(name: RegExp) {
  const match = screen.getAllByRole('button', { name }).find((el) => el.hasAttribute('aria-pressed'))
  if (!match) throw new Error(`No action-bar button found matching ${name}`)
  return match
}

afterEach(() => {
  vi.clearAllMocks()
  authUser = { uid: 'uid-1' }
})

// Seeds two history entries so the "Back" button's navigate(-1) has
// somewhere real to go — a bare single-entry history can't go back further.
// Also stubs /get-started and /profile/:uid, the two destinations MovieDetail
// itself can navigate to.
function renderWithRouter(movieId = 'movie-1') {
  return render(
    <MemoryRouter initialEntries={['/', `/movie/${movieId}`]} initialIndex={1}>
      <Routes>
        <Route path="/" element={<p>Previous page</p>} />
        <Route path="/movie/:movieId" element={<MovieDetail />} />
        <Route path="/get-started" element={<p>Get started page</p>} />
        <Route path="/profile/:uid" element={<p>Profile page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('MovieDetail', () => {
  it('renders hero info: title, year, genres, runtime, TMDB rating, and "No ratings yet" when binjRating.count is 0', async () => {
    mockDefaults()
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Dune: Part Two')).toBeInTheDocument())
    expect(screen.getByText(/2024/)).toBeInTheDocument()
    expect(screen.getByText(/Sci-Fi, Adventure/)).toBeInTheDocument()
    expect(screen.getByText(/166/)).toBeInTheDocument()
    expect(screen.getByText('8.3')).toBeInTheDocument()
    expect(screen.getByText(/no ratings yet/i)).toBeInTheDocument()
  })

  it('shows the BINJ average when binjRating.count > 0', async () => {
    getMovie.mockResolvedValue({ ...movie, binjRating: { sum: 18, count: 4 } }) // avg 4.5
    getMovieStatus.mockResolvedValue(emptyStatus)
    getMovieReviews.mockResolvedValue({ items: [], nextCursor: null })
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('4.5')).toBeInTheDocument())
  })

  it('reflects current status on load: watchlist/watched/like pressed state', async () => {
    getMovie.mockResolvedValue(movie)
    getMovieStatus.mockResolvedValue({ watchlisted: true, watched: false, liked: true, review: null })
    getMovieReviews.mockResolvedValue({ items: [], nextCursor: null })
    renderWithRouter()

    await waitFor(() => expect(actionButton(/watchlist/i)).toHaveAttribute('aria-pressed', 'true'))
    expect(actionButton(/^watched$/i)).toHaveAttribute('aria-pressed', 'false')
    expect(actionButton(/^like$/i)).toHaveAttribute('aria-pressed', 'true')
  })

  it('toggling watchlist calls addToWatchlist optimistically and updates pressed state', async () => {
    mockDefaults()
    addToWatchlist.mockResolvedValue(undefined)
    renderWithRouter()

    await waitFor(() => expect(actionButton(/watchlist/i)).toBeInTheDocument())
    fireEvent.click(actionButton(/watchlist/i))

    expect(actionButton(/watchlist/i)).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(addToWatchlist).toHaveBeenCalledWith('movie-1'))
  })

  it('rolls back the optimistic toggle when the API call fails', async () => {
    mockDefaults()
    addToWatchlist.mockRejectedValue(new Error('network error'))
    renderWithRouter()

    await waitFor(() => expect(actionButton(/watchlist/i)).toBeInTheDocument())
    fireEvent.click(actionButton(/watchlist/i))

    await waitFor(() => expect(actionButton(/watchlist/i)).toHaveAttribute('aria-pressed', 'false'))
    expect(screen.getByRole('alert')).toHaveTextContent('network error')
  })

  it('toggling watched calls markWatched, toggling like calls likeMovie', async () => {
    mockDefaults()
    markWatched.mockResolvedValue(undefined)
    likeMovie.mockResolvedValue(undefined)
    renderWithRouter()

    await waitFor(() => expect(actionButton(/^watched$/i)).toBeInTheDocument())
    fireEvent.click(actionButton(/^watched$/i))
    fireEvent.click(actionButton(/^like$/i))

    await waitFor(() => expect(markWatched).toHaveBeenCalledWith('movie-1'))
    await waitFor(() => expect(likeMovie).toHaveBeenCalledWith('movie-1'))
  })

  it('renders the poster image when the movie has one', async () => {
    getMovie.mockResolvedValueOnce({ ...movie, poster: '/dune2.jpg' })
    getMovieStatus.mockResolvedValue(emptyStatus)
    getMovieReviews.mockResolvedValue({ items: [], nextCursor: null })
    renderWithRouter()

    await waitFor(() => expect(document.querySelector('img.poster')).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w500/dune2.jpg'))
  })

  it('shows a Play trailer button in the hero when the movie has a trailer', async () => {
    getMovie.mockResolvedValueOnce({ ...movie, trailerKey: 'abc123' })
    getMovieStatus.mockResolvedValue(emptyStatus)
    getMovieReviews.mockResolvedValue({ items: [], nextCursor: null })
    renderWithRouter()

    expect(await screen.findByRole('button', { name: /play trailer/i })).toBeInTheDocument()
  })

  it('renders the widescreen backdrop image alongside the poster when the movie has one', async () => {
    getMovie.mockResolvedValueOnce({ ...movie, backdrop: '/wide.jpg' })
    getMovieStatus.mockResolvedValue(emptyStatus)
    getMovieReviews.mockResolvedValue({ items: [], nextCursor: null })
    renderWithRouter()

    await waitFor(() => expect(document.querySelector('img[src*="w1280/wide.jpg"]')).toBeInTheDocument())
  })

  it('renders no poster image when the movie has none', async () => {
    mockDefaults() // fixture's poster is null
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Dune: Part Two')).toBeInTheDocument())
    expect(document.querySelector('img.poster')).not.toBeInTheDocument()
  })

  it('invites the caller to mark the movie watched when no followed friend has and they haven\'t either — real bug: this slot used to just be an empty column beside "About"', async () => {
    mockDefaults()
    markWatched.mockResolvedValue(undefined)
    likeMovie.mockResolvedValue(undefined)
    renderWithRouter()

    const button = await screen.findByRole('button', { name: /mark as watched/i })
    fireEvent.click(button)

    await waitFor(() => expect(markWatched).toHaveBeenCalledWith('movie-1'))
  })

  it('invites the caller to start a watch party when they\'ve already watched it but no followed friend has, opening the create-event flow pre-filled with this movie', async () => {
    mockDefaults()
    getMovieStatus.mockResolvedValue({ ...emptyStatus, watched: true })
    renderWithRouter()

    fireEvent.click(await screen.findByRole('button', { name: /invite a friend/i }))

    expect(await screen.findByRole('dialog', { name: /host a watch party/i })).toBeInTheDocument()
    // The movie is pre-selected (no "Which movie?" search step) — its title
    // shows directly in the create form, confirming initialMovie was passed.
    expect(screen.getAllByText('Dune: Part Two').length).toBeGreaterThan(0)
  })

  it('renders streaming providers, synopsis, and cast', async () => {
    mockDefaults()
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Netflix')).toBeInTheDocument())
    expect(screen.getByText(/Paul Atreides unites/)).toBeInTheDocument()
    expect(screen.getByText('Timothee Chalamet')).toBeInTheDocument()
    expect(screen.getByText('Paul Atreides')).toBeInTheDocument()
  })

  it('renders the reviews list with reviewer name, stars, and text', async () => {
    getMovie.mockResolvedValue(movie)
    getMovieStatus.mockResolvedValue(emptyStatus)
    getMovieReviews.mockResolvedValue({
      items: [
        { authorId: 'u2', displayName: 'Meera', rating: 5, reviewText: 'Incredible film', isAnonymous: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { authorId: null, displayName: null, rating: 3, reviewText: 'It was fine', isAnonymous: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ],
      nextCursor: null
    })
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Meera')).toBeInTheDocument())
    expect(screen.getByText('Incredible film')).toBeInTheDocument()
    expect(screen.getByText('Anonymous')).toBeInTheDocument()
    expect(screen.getByText('It was fine')).toBeInTheDocument()
  })

  it('"Write a review" opens a blank form when the caller has no existing review', async () => {
    mockDefaults()
    renderWithRouter()

    await waitFor(() => expect(screen.getByRole('button', { name: /write a review/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /write a review/i }))

    expect(screen.getByRole('textbox', { name: /review/i })).toHaveValue('')
    expect(screen.queryByRole('button', { name: /delete review/i })).not.toBeInTheDocument()
  })

  it('"Write a review" pre-fills and offers Delete when the caller already has a review', async () => {
    getMovie.mockResolvedValue(movie)
    getMovieStatus.mockResolvedValue({
      watchlisted: false, watched: false, liked: false,
      review: { rating: 4, reviewText: 'Pretty good', isAnonymous: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    })
    getMovieReviews.mockResolvedValue({ items: [], nextCursor: null })
    renderWithRouter()

    await waitFor(() => expect(screen.getByRole('button', { name: /edit your review/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /edit your review/i }))

    expect(screen.getByRole('textbox', { name: /review/i })).toHaveValue('Pretty good')
    const stars = within(screen.getByRole('group', { name: /rating/i })).getAllByRole('button')
    expect(stars[3]).toHaveAttribute('aria-pressed', 'true') // 4th star = rating 4
    expect(screen.getByRole('checkbox', { name: /anonymous/i })).toBeChecked()
    expect(screen.getByRole('button', { name: /delete review/i })).toBeInTheDocument()
  })

  it('submitting the review form calls submitReview and refreshes the list and status', async () => {
    mockDefaults()
    submitReview.mockResolvedValue({ rating: 5, reviewText: 'Amazing', isAnonymous: false, createdAt: '', updatedAt: '' })
    renderWithRouter()

    await waitFor(() => expect(screen.getByRole('button', { name: /write a review/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /write a review/i }))

    const stars = within(screen.getByRole('group', { name: /rating/i })).getAllByRole('button')
    fireEvent.click(stars[4]) // 5th star = rating 5
    fireEvent.change(screen.getByRole('textbox', { name: /review/i }), { target: { value: 'Amazing' } })
    fireEvent.click(screen.getByRole('button', { name: /^post review$/i }))

    await waitFor(() => expect(submitReview).toHaveBeenCalledWith('movie-1', { rating: 5, reviewText: 'Amazing', isAnonymous: false }))
    await waitFor(() => expect(getMovieReviews).toHaveBeenCalledTimes(2)) // initial load + refresh after submit
  })

  it('refreshes the movie itself after submitting, so a newly-changed BINJ average shows without a reload', async () => {
    mockDefaults()
    submitReview.mockResolvedValue({ rating: 5, reviewText: 'Amazing', isAnonymous: false, createdAt: '', updatedAt: '' })
    getMovie.mockResolvedValueOnce(movie).mockResolvedValueOnce({ ...movie, binjRating: { sum: 5, count: 1 } })
    renderWithRouter()

    await waitFor(() => expect(screen.getByRole('button', { name: /write a review/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /write a review/i }))
    const stars = within(screen.getByRole('group', { name: /rating/i })).getAllByRole('button')
    fireEvent.click(stars[4])
    fireEvent.click(screen.getByRole('button', { name: /^post review$/i }))

    await waitFor(() => expect(getMovie).toHaveBeenCalledTimes(2)) // initial load + refresh after submit
    expect(await screen.findByText('5.0')).toBeInTheDocument()
  })

  it('deleting a review calls deleteReview and refreshes', async () => {
    getMovie.mockResolvedValue(movie)
    getMovieStatus.mockResolvedValue({
      watchlisted: false, watched: false, liked: false,
      review: { rating: 2, reviewText: null, isAnonymous: false, createdAt: '', updatedAt: '' }
    })
    getMovieReviews.mockResolvedValue({ items: [], nextCursor: null })
    deleteReview.mockResolvedValue(undefined)
    renderWithRouter()

    await waitFor(() => expect(screen.getByRole('button', { name: /edit your review/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /edit your review/i }))
    fireEvent.click(screen.getByRole('button', { name: /delete review/i }))

    await waitFor(() => expect(deleteReview).toHaveBeenCalledWith('movie-1'))
    await waitFor(() => expect(getMovieStatus).toHaveBeenCalledTimes(2))
  })

  it('shows independent loading/error states per section', async () => {
    getMovie.mockResolvedValue(movie)
    getMovieStatus.mockRejectedValue(new Error('status failed'))
    getMovieReviews.mockResolvedValue({ items: [], nextCursor: null })
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Dune: Part Two')).toBeInTheDocument())
    // Movie itself and reviews still render fine even though status failed independently.
    expect(screen.queryByText(/status failed/i)).toBeInTheDocument()
  })

  it('navigates back when Back is clicked', async () => {
    mockDefaults()
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Dune: Part Two')).toBeInTheDocument())
    fireEvent.click(screen.getAllByRole('button', { name: /back/i })[0])
    expect(await screen.findByText('Previous page')).toBeInTheDocument()
  })

  it('renders the desktop Sidebar + AppHeader shell for a signed-in visitor', async () => {
    mockDefaults()
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Dune: Part Two')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /our story/i })).toBeInTheDocument() // Sidebar nav
    expect(await screen.findByText('Yamin')).toBeInTheDocument() // AppHeader's identity, once getMe resolves
  })
})

describe('MovieDetail — signed-out visitor (public Discover)', () => {
  it('never calls getMovieStatus or getMovieWatchedBy for a guest', async () => {
    mockAuthUser(null)
    mockDefaults()
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Dune: Part Two')).toBeInTheDocument())
    expect(getMovieStatus).not.toHaveBeenCalled()
    expect(getMovieWatchedBy).not.toHaveBeenCalled()
  })

  it('never shows the signed-in Sidebar/AppHeader shell for a guest', async () => {
    mockAuthUser(null)
    mockDefaults()
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Dune: Part Two')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /our story/i })).not.toBeInTheDocument()
    expect(getMe).not.toHaveBeenCalled()
  })

  it('shows a sign-in prompt instead of the action bar, navigating to Get Started', async () => {
    mockAuthUser(null)
    mockDefaults()
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Dune: Part Two')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^watchlist$/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /sign in to save, rate & review/i })[0])
    expect(await screen.findByText('Get started page')).toBeInTheDocument()
  })

  it('still shows the public reviews list, but "Write a review" prompts sign-in instead of opening the form', async () => {
    mockAuthUser(null)
    getMovie.mockResolvedValue(movie)
    getMovieReviews.mockResolvedValue({
      items: [{ authorId: 'u2', displayName: 'Meera', rating: 5, reviewText: 'Incredible film', isAnonymous: false, createdAt: '', updatedAt: '' }],
      nextCursor: null
    })
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Meera')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^write a review$/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /sign in to write a review/i }))
    expect(await screen.findByText('Get started page')).toBeInTheDocument()
  })

  it('shows a scheduled watch party for this movie with a Sign in to join CTA', async () => {
    mockAuthUser(null)
    mockDefaults()
    getUpcomingEvents.mockResolvedValue({
      items: [
        {
          eventId: 'e1', hostId: 'host-1', movieId: 'movie-1', title: 'Dune Watch Party', datetime: '2099-06-01T20:00:00.000Z',
          mode: 'online', location: null, preciseLocation: null, visibility: 'public', joinCode: null,
          participantLimit: 10, participantCount: 3, requiresApproval: false, roomId: 'r1', createdAt: null, joined: false,
          movieTitle: 'Dune: Part Two', moviePoster: null
        }
      ]
    })
    renderWithRouter()

    expect(await screen.findByText('Dune Watch Party')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /sign in to join/i }))
    expect(await screen.findByText('Get started page')).toBeInTheDocument()
  })
})
