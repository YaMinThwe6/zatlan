import { describe, it, expect, vi, afterEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let currentUser: { uid: string; displayName: string; email: string } | null = {
  uid: 'uid-1',
  displayName: 'Arjun',
  email: 'arjun@example.com'
}
vi.mock('../src/lib/AuthContext', () => ({
  useAuth: () => ({
    user: currentUser,
    loading: false,
    signInWithGoogle: vi.fn(),
    signInWithMicrosoft: vi.fn(),
    signInWithToken: vi.fn(),
    signOutUser: vi.fn()
  })
}))

vi.mock('../src/lib/firebase', () => ({
  auth: { currentUser: { getIdToken: vi.fn().mockResolvedValue('fake-id-token') } },
  googleProvider: {}
}))

const { default: App } = await import('../src/App')

// App itself no longer wraps in a router (that lives in main.tsx), so tests
// mount it under a MemoryRouter at "/" — App's own <Routes> take it from there.
function render() {
  return rtlRender(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>
  )
}

const originalFetch = globalThis.fetch

function envelope(data: unknown) {
  return { success: true, message: 'OK', statusCode: 200, data }
}

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
  currentUser = { uid: 'uid-1', displayName: 'Arjun', email: 'arjun@example.com' }
})

describe('App search flow', () => {
  it('searches and renders results, then loads detail on selection', async () => {
    // Dispatch by URL rather than call order — the mount-time getMe() call and the
    // user-triggered search call race each other (getMe awaits getIdToken() first,
    // so it doesn't necessarily reach fetch() before the search does).
    globalThis.fetch = vi.fn((url: string) => {
      // Exact match, not includes() — "/users/me" is a substring of
      // "/users/me/tasteMatches", "/users/me/movies/634649", and
      // "/users/me/notifications" too, all of which need their own branches
      // below instead of silently getting this one's getMe() response shape.
      if (/\/users\/me(?:\?|$)/.test(url)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => envelope({
            uid: 'uid-1',
            displayName: 'Arjun',
            email: 'arjun@example.com',
            isNewUser: false,
            onboardingComplete: true,
          }),
        })
      }
      if (url.includes('/search/movies')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => envelope({
            items: [{ movieId: '634649', title: 'Spider-Man: No Way Home', poster: null, year: 2021 }],
          }),
        })
      }
      if (url.includes('/movies/634649/reviews')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => envelope({ items: [], nextCursor: null }) })
      }
      if (url.includes('/users/me/movies/634649')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => envelope({ watchlisted: false, watched: false, liked: false, review: null }),
        })
      }
      // Must come before the general '/movies/634649' branch below — '/movies/634649/watchedBy'
      // also contains '/movies/634649' as a substring, so without this the movie-detail
      // response (no `items` field) gets matched instead, and WatchedByFriends eventually
      // crashes on `items.length` when its state update lands before the test's own unmount.
      if (url.includes('/watchedBy')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => envelope({ items: [] }) })
      }
      if (url.includes('/movies/634649')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => envelope({
            movieId: '634649',
            title: 'Spider-Man: No Way Home',
            poster: null,
            year: 2021,
            runtime: 148,
            genres: ['Action', 'Adventure'],
            synopsis: 'Peter faces multiverse consequences.',
            cast: [{ personId: '1', name: 'Tom Holland', character: 'Peter Parker', photo: null }],
            crew: [],
            voteAverage: 8.1,
            voteCount: 1000,
            trailerKey: null,
            streamingProviders: [],
            zatlanRating: { sum: 0, count: 0 },
            likeCount: 0,
          }),
        })
      }
      // Home's own sections, MovieDetail's WatchedByFriends, and MovieSearch's
      // default "recently released" section — benign empty responses, this
      // test only cares about Search.
      if (
        url.includes('/home/greeting') ||
        url.includes('/recommendations') ||
        url.includes('/users/me/tasteMatches') ||
        url.includes('/events/upcoming') ||
        url.includes('/home/activity') ||
        url.includes('/users/me/notifications') ||
        url.includes('/movies/recent') ||
        url.includes('/discover/movies')
      ) {
        return Promise.resolve({ ok: true, status: 200, json: async () => envelope({ items: [] }) })
      }
      if (url.includes('/users/me/movies/status')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => envelope({ items: {} }) })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    render()

    // Home is the default landing view — navigate to Search first.
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^search$/i }).length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByRole('button', { name: /^search$/i })[0])

    const searchInput = screen.getByLabelText(/search for a movie/i)
    fireEvent.change(searchInput, { target: { value: 'spider-man' } })
    fireEvent.submit(searchInput.closest('form') as HTMLFormElement)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Spider-Man: No Way Home \(2021\)/i })).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: /Spider-Man: No Way Home \(2021\)/i }))

    await waitFor(() =>
      expect(screen.getByText(/Peter faces multiverse consequences\./i)).toBeInTheDocument()
    )
    expect(screen.getByText('8.1')).toBeInTheDocument()
    expect(screen.getByText('Tom Holland')).toBeInTheDocument()
  })
})

describe('App — signed-out root ("/")', () => {
  it('shows public movie discovery, not an auth wall, when signed out', async () => {
    currentUser = null
    render()

    expect(await screen.findByText(/discover movies/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^get started$/i })).toBeInTheDocument()
    expect(screen.queryByText(/stories are better together/i)).not.toBeInTheDocument() // Welcome splash, not shown yet
  })

  it('opens Welcome when Get Started is clicked, and Back returns to Discover', async () => {
    currentUser = null
    render()

    await screen.findByText(/discover movies/i)
    fireEvent.click(screen.getByRole('button', { name: /^get started$/i }))

    // Mobile and desktop each render their own copy of the tagline/back
    // button, toggled by CSS breakpoint — both exist in jsdom regardless of
    // viewport since it doesn't evaluate media queries.
    await waitFor(() => expect(screen.getAllByText(/stories are better together/i).length).toBeGreaterThan(0))

    fireEvent.click(screen.getAllByRole('button', { name: /back to discover/i })[0])
    expect(await screen.findByText(/discover movies/i)).toBeInTheDocument()
  })
})
