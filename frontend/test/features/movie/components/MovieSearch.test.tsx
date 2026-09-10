import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const searchMovies = vi.fn()
const getRecentMovies = vi.fn()
const discoverMovies = vi.fn()
const getMovieStatuses = vi.fn()
// The guest right rail's DiscoverPeopleTeaser fetches this on mount — not
// this file's focus, defaulted to empty in beforeEach below so it doesn't
// need setup in every test.
const getTopFollowedPeople = vi.fn()
vi.mock('../../../../src/features/movie/services/movieApi', () => ({ searchMovies, getRecentMovies, discoverMovies, getMovieStatuses, getTopFollowedPeople }))

// The guest right rail's DiscoverEventsTeaser fetches this on mount — not
// this file's focus, defaulted to empty in beforeEach below so it doesn't
// need setup in every test. getNotifications is AppHeader's own (the shared
// shell every signed-in page now renders), not this file's focus either.
const getUpcomingEvents = vi.fn()
const getNotifications = vi.fn()
vi.mock('../../../../src/features/home/services/homeApi', () => ({ getUpcomingEvents, getNotifications }))

// AppHeader's own fetch when no `me` prop is supplied.
const getMe = vi.fn()
vi.mock('../../../../src/lib/api', () => ({ getMe }))

let authUser: { uid: string } | null = { uid: 'uid-1' }
vi.mock('../../../../src/lib/AuthContext', () => ({
  useAuth: () => ({ user: authUser, loading: false, signInWithGoogle: vi.fn(), signInWithMicrosoft: vi.fn(), signInWithToken: vi.fn(), signOutUser: vi.fn() })
}))

const { MovieSearch } = await import('../../../../src/features/movie/components/MovieSearch')

afterEach(() => {
  searchMovies.mockReset()
  getRecentMovies.mockReset()
  discoverMovies.mockReset()
  getMovieStatuses.mockReset()
  getUpcomingEvents.mockReset()
  getTopFollowedPeople.mockReset()
  getNotifications.mockReset()
  getMe.mockReset()
  authUser = { uid: 'uid-1' }
})

// Every test below gets an empty "recently released" section by default —
// its own tests further down set specific responses.
beforeEach(() => {
  getRecentMovies.mockResolvedValue({ items: [] })
  discoverMovies.mockResolvedValue({ items: [], page: 1, totalPages: 1 })
  getMovieStatuses.mockResolvedValue({ items: {} })
  getUpcomingEvents.mockResolvedValue({ items: [] })
  getTopFollowedPeople.mockResolvedValue({ items: [] })
  getNotifications.mockResolvedValue({ items: [] })
  getMe.mockResolvedValue({ uid: 'uid-1', displayName: 'Yamin', email: 'yamin@example.com' })
})

// MovieSearch decides guest-vs-signed-in from useAuth() rather than a prop
// now, and navigates for real (Home, Get Started, movie cards) instead of
// calling callback props — so every render goes through a router with stub
// destination routes. The signed-in tests mount it at "/search" (its real
// route when reached from Home); the guest tests mount it at "/" (its real
// route for a signed-out visitor, hld.md §3).
function renderWithRouter(initialEntry: '/search' | '/' = '/search') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/search" element={<MovieSearch />} />
        <Route path="/" element={initialEntry === '/' ? <MovieSearch /> : <p>Home page</p>} />
        <Route path="/get-started" element={<p>Get started page</p>} />
        <Route path="/movie/:movieId" element={<p>Movie detail page</p>} />
        <Route path="/story" element={<p>About page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('MovieSearch — signed-in usage (via Home)', () => {
  it('sits inside the app shell: sidebar with Search active, mobile tab bar, no guest header', () => {
    renderWithRouter()
    // Sidebar (desktop) + MobileTabBar (mobile) each render a Search control
    expect(screen.getAllByRole('button', { name: /^search$/i }).length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByRole('button', { name: /^get started$/i })).not.toBeInTheDocument()
  })

  it('navigates Home from the shell', async () => {
    renderWithRouter()
    fireEvent.click(screen.getByRole('button', { name: /← home/i }))
    expect(await screen.findByText('Home page')).toBeInTheDocument()
  })

  it('teases that series and books are coming', () => {
    renderWithRouter()
    expect(screen.getByText(/series and books/i)).toBeInTheDocument()
    expect(screen.getByText(/for now, discovery is all about movies/i)).toBeInTheDocument()
  })

  it('badges a result the caller has watched / watchlisted', async () => {
    searchMovies.mockResolvedValue({
      items: [
        { movieId: 'm1', title: 'Seen It', poster: null, year: 2024 },
        { movieId: 'm2', title: 'Saved It', poster: null, year: 2024 }
      ]
    })
    getMovieStatuses.mockResolvedValue({
      items: {
        m1: { watchlisted: false, watched: true, liked: false },
        m2: { watchlisted: true, watched: false, liked: false }
      }
    })
    renderWithRouter()

    const input = screen.getByLabelText(/search for a movie/i)
    fireEvent.change(input, { target: { value: 'It' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    await screen.findByText('Seen It')
    await waitFor(() => expect(getMovieStatuses).toHaveBeenCalledWith(['m1', 'm2']))
    expect(await screen.findByText(/✓ Watched/)).toBeInTheDocument()
    expect(await screen.findByText(/\+ Watchlist/)).toBeInTheDocument()
  })
})

describe('MovieSearch — browse by genre / language chip', () => {
  it('offers a "Browse Korean films" chip when the query names a language, then shows the discover grid', async () => {
    discoverMovies.mockResolvedValue({
      items: [{ movieId: 'k1', title: 'Parasite', poster: null, year: 2019 }],
      page: 1,
      totalPages: 3
    })
    renderWithRouter('/')

    fireEvent.change(screen.getByLabelText(/search for a movie/i), { target: { value: 'korean' } })
    const chip = await screen.findByRole('button', { name: /browse korean films/i })
    fireEvent.click(chip)

    await waitFor(() => expect(discoverMovies).toHaveBeenCalledWith({ genre: null, language: 'ko', page: 1 }))
    expect(await screen.findByText('Parasite')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /korean films/i })).toBeInTheDocument()
  })

  it('offers a genre chip and pages in more results with "Load more", deduping repeats across pages', async () => {
    discoverMovies.mockResolvedValueOnce({
      items: [{ movieId: 'h1', title: 'Hereditary', poster: null, year: 2018 }],
      page: 1,
      totalPages: 2
    })
    discoverMovies.mockResolvedValueOnce({
      items: [
        { movieId: 'h1', title: 'Hereditary', poster: null, year: 2018 }, // TMDB repeats it on page 2
        { movieId: 'h2', title: 'The Witch', poster: null, year: 2015 }
      ],
      page: 2,
      totalPages: 2
    })
    renderWithRouter('/')

    fireEvent.change(screen.getByLabelText(/search for a movie/i), { target: { value: 'horror movies' } })
    fireEvent.click(await screen.findByRole('button', { name: /browse horror movies/i }))

    await screen.findByText('Hereditary')
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))

    await waitFor(() => expect(discoverMovies).toHaveBeenLastCalledWith({ genre: 'Horror', language: null, page: 2 }))
    expect(await screen.findByText('The Witch')).toBeInTheDocument()
    expect(screen.getAllByText('Hereditary')).toHaveLength(1) // not doubled
  })

  it('leaves browse mode when the query is edited', async () => {
    discoverMovies.mockResolvedValue({ items: [{ movieId: 'k1', title: 'Parasite', poster: null, year: 2019 }], page: 1, totalPages: 1 })
    searchMovies.mockResolvedValue({ items: [] })
    renderWithRouter('/')

    fireEvent.change(screen.getByLabelText(/search for a movie/i), { target: { value: 'korean' } })
    fireEvent.click(await screen.findByRole('button', { name: /browse korean films/i }))
    await screen.findByText('Parasite')

    fireEvent.change(screen.getByLabelText(/search for a movie/i), { target: { value: 'koreanx' } })
    await waitFor(() => expect(screen.queryByRole('heading', { name: /korean films/i })).not.toBeInTheDocument())
  })
})

describe('MovieSearch — guest usage (public Discover)', () => {
  it('shows the ZATLAN brand and a Get Started button instead of a back button', () => {
    authUser = null
    renderWithRouter('/')
    expect(screen.getByText('ZATLAN')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^get started$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /← home/i })).not.toBeInTheDocument()
  })

  it('navigates to Get Started when Get Started is clicked', async () => {
    authUser = null
    renderWithRouter('/')
    fireEvent.click(screen.getByRole('button', { name: /^get started$/i }))
    expect(await screen.findByText('Get started page')).toBeInTheDocument()
  })

  it('offers an Our Story button in the guest header, and drops the guest chrome for a signed-in visitor', async () => {
    authUser = null
    renderWithRouter('/')
    fireEvent.click(screen.getByRole('button', { name: /our story/i }))
    expect(await screen.findByText('About page')).toBeInTheDocument()

    authUser = { uid: 'uid-1' }
    renderWithRouter()
    // Guest-only chrome is gone; nav (incl. Our Story) now lives in the app shell.
    expect(screen.queryByRole('button', { name: /^get started$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^discover movies$/i })).not.toBeInTheDocument()
    // Lets the signed-in shell's own async chain (AppHeader awaits getMe
    // before its NotificationBell child even mounts, which then awaits
    // getNotifications) settle before this test ends — otherwise it can fire
    // after afterEach resets the mocks, throwing in whichever test runs next.
    await waitFor(() => expect(getNotifications).toHaveBeenCalled())
  })

  it('shows the right-rail People teaser', () => {
    authUser = null
    renderWithRouter('/')
    expect(screen.getByText('People you might vibe with')).toBeInTheDocument()
  })

  it('does not show the right-rail People teaser for a signed-in visitor', () => {
    renderWithRouter()
    expect(screen.queryByText('People you might vibe with')).not.toBeInTheDocument()
  })
})

describe('MovieSearch — search', () => {
  it('searches and renders results, then opens MovieDetail on click', async () => {
    authUser = null
    searchMovies.mockResolvedValue({ items: [{ movieId: 'm1', title: 'Dune: Part Two', poster: null, year: 2024 }] })
    renderWithRouter('/')

    fireEvent.change(screen.getByLabelText(/search for a movie/i), { target: { value: 'Dune' } })
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))

    await waitFor(() => expect(searchMovies).toHaveBeenCalledWith('Dune'))
    expect(await screen.findByText('Dune: Part Two')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Dune: Part Two'))
    expect(await screen.findByText('Movie detail page')).toBeInTheDocument()
  })

  it('renders the poster image from TMDB\'s CDN when a result has one', async () => {
    authUser = null
    searchMovies.mockResolvedValue({ items: [{ movieId: 'm1', title: 'Dune: Part Two', poster: '/abc123.jpg', year: 2024 }] })
    renderWithRouter('/')

    fireEvent.change(screen.getByLabelText(/search for a movie/i), { target: { value: 'Dune' } })
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))

    await screen.findByText('Dune: Part Two')
    const img = document.querySelector('img') as HTMLImageElement
    expect(img.src).toBe('https://image.tmdb.org/t/p/w342/abc123.jpg')
  })

  it('shows a "No poster" placeholder when a result has none', async () => {
    authUser = null
    searchMovies.mockResolvedValue({ items: [{ movieId: 'm1', title: 'Dune: Part Two', poster: null, year: 2024 }] })
    renderWithRouter('/')

    fireEvent.change(screen.getByLabelText(/search for a movie/i), { target: { value: 'Dune' } })
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))

    await screen.findByText('Dune: Part Two')
    expect(screen.getByText(/no poster/i)).toBeInTheDocument()
  })

  it('shows an error message when search fails', async () => {
    authUser = null
    searchMovies.mockRejectedValue(new Error('Search failed'))
    renderWithRouter('/')

    fireEvent.change(screen.getByLabelText(/search for a movie/i), { target: { value: 'Dune' } })
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Search failed'))
  })
})

describe('MovieSearch — recently released (default browse view)', () => {
  it('fetches and shows recently released movies on mount, before any search', async () => {
    getRecentMovies.mockResolvedValue({ items: [{ movieId: 'r1', title: 'Fresh Release', poster: null, year: 2026 }] })
    renderWithRouter('/')

    expect(await screen.findByText('Fresh Release')).toBeInTheDocument()
    expect(screen.getByText(/recently released/i)).toBeInTheDocument()
  })

  it('switches to search results once a search is submitted, hiding recently released', async () => {
    getRecentMovies.mockResolvedValue({ items: [{ movieId: 'r1', title: 'Fresh Release', poster: null, year: 2026 }] })
    searchMovies.mockResolvedValue({ items: [{ movieId: 'm1', title: 'Dune: Part Two', poster: null, year: 2024 }] })
    renderWithRouter('/')

    await screen.findByText('Fresh Release')
    const input = screen.getByLabelText(/search for a movie/i)
    fireEvent.change(input, { target: { value: 'Dune' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)

    expect(await screen.findByText('Dune: Part Two')).toBeInTheDocument()
    expect(screen.queryByText('Fresh Release')).not.toBeInTheDocument()
    expect(screen.queryByText(/recently released/i)).not.toBeInTheDocument()
  })

  it('does not break the rest of the page when recently-released fails to load', async () => {
    getRecentMovies.mockRejectedValue(new Error('boom'))
    renderWithRouter('/')

    await waitFor(() => expect(screen.getByText(/couldn't load recent releases/i)).toBeInTheDocument())
    expect(screen.getByLabelText(/search for a movie/i)).toBeInTheDocument()
  })
})
