import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getUserProfile = vi.fn()
const followUser = vi.fn()
const unfollowUser = vi.fn()
const getNotifications = vi.fn().mockResolvedValue({ items: [] })

vi.mock('../../../../src/features/profile/services/profileApi', () => ({ getUserProfile }))
vi.mock('../../../../src/features/home/services/homeApi', () => ({ followUser, unfollowUser, getNotifications }))

// AppHeader's own dependency (rendered for real below, not mocked away, same
// as MovieDetail.test.tsx treats Sidebar/AppHeader) — nothing specific to
// Profile worth asserting beyond "the signed-in shell is there".
const getMe = vi.fn().mockResolvedValue({ uid: 'caller-1', displayName: 'Yamin', email: 'yamin@example.com' })
vi.mock('../../../../src/lib/api', () => ({ getMe }))

// Profile is only ever reached signed-in (App.tsx's "/profile/:uid" route
// doesn't exist in the guest route table) — this mock just supplies
// AppHeader's onSignOut handler, same as MovieDetail.test.tsx's.
vi.mock('../../../../src/lib/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'caller-1' }, loading: false, signInWithGoogle: vi.fn(), signInWithMicrosoft: vi.fn(), signInWithToken: vi.fn(), signOutUser: vi.fn() })
}))

const { Profile } = await import('../../../../src/features/profile/components/Profile')

const baseProfile = {
  uid: 'u1',
  displayName: 'Rohan',
  username: 'rohan.movies',
  photoURL: null,
  favoriteGenres: ['Sci-Fi', 'Thriller'],
  preferredLanguages: null,
  followerCount: 12,
  followingCount: 8,
  relationship: 'none' as const,
  watchedListVisible: true,
  watched: [{ movieId: 'm1', title: 'Interstellar', poster: null, watchedAt: '2026-01-01T00:00:00.000Z' }],
  joinedAt: '2026-06-01T00:00:00.000Z',
  watchedCount: 98,
  watchlistCount: 21,
  reviewCount: 37,
  topGenres: [
    { genre: 'Drama', percent: 82 },
    { genre: 'Romance', percent: 74 }
  ],
  recentActivity: [
    { activityId: 'a1', uid: 'u1', displayName: 'Rohan', type: 'watched' as const, movieId: 'm1', movieTitle: 'Hereditary', moviePoster: null, createdAt: '2026-01-01T00:00:00.000Z' }
  ],
  tasteMatchScore: 87
}

afterEach(() => {
  getUserProfile.mockReset()
  followUser.mockReset()
  unfollowUser.mockReset()
  getNotifications.mockClear()
  getMe.mockClear()
})

// Seeds two history entries so the "Back" button's navigate(-1) has
// somewhere real to go — a bare single-entry history can't go back further.
function renderWithRouter(uid = 'u1') {
  return render(
    <MemoryRouter initialEntries={['/', `/profile/${uid}`]} initialIndex={1}>
      <Routes>
        <Route path="/" element={<p>Previous page</p>} />
        <Route path="/profile/:uid" element={<Profile />} />
        <Route path="/movie/:movieId" element={<p>Movie detail page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('Profile', () => {
  it('renders the person\'s info and follower/following counts once loaded', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Rohan')).toBeInTheDocument())
    expect(screen.getByText('rohan.movies', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
  })

  it('navigates to the movie detail page when a Watched-list entry is clicked', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Interstellar')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Interstellar'))

    expect(await screen.findByText('Movie detail page')).toBeInTheDocument()
  })

  it('navigates to the movie detail page when a Recent Activity entry is clicked', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Hereditary')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Hereditary'))

    expect(await screen.findByText('Movie detail page')).toBeInTheDocument()
  })

  it('renders the signed-in desktop shell (Sidebar + AppHeader)', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Rohan')).toBeInTheDocument())
    expect(screen.getByText('BINJ')).toBeInTheDocument() // Sidebar's own logo mark
    await waitFor(() => expect(getMe).toHaveBeenCalled()) // AppHeader fetching its own `me`
  })

  it('shows a Connect button and follows on click', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    followUser.mockResolvedValue({ status: 'following' })
    renderWithRouter()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => expect(followUser).toHaveBeenCalledWith('u1'))
    expect(await screen.findByRole('button', { name: 'Following' })).toBeInTheDocument()
  })

  it('unfollows when clicking Following', async () => {
    getUserProfile.mockResolvedValue({ ...baseProfile, relationship: 'following' })
    unfollowUser.mockResolvedValue(undefined)
    renderWithRouter()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Following' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Following' }))

    await waitFor(() => expect(unfollowUser).toHaveBeenCalledWith('u1'))
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })

  it('does not show a follow button when viewing your own profile, shows a disabled Edit Profile instead', async () => {
    getUserProfile.mockResolvedValue({ ...baseProfile, relationship: 'self', tasteMatchScore: null })
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Rohan')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /connect|following|requested/i })).not.toBeInTheDocument()
    const editButton = screen.getByRole('button', { name: /edit profile/i })
    expect(editButton).toBeDisabled()
  })

  it('lists public watched movies', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    renderWithRouter()

    expect(await screen.findByText('Interstellar')).toBeInTheDocument()
  })

  it('shows a private-list message instead of movies when watchedListVisible is false', async () => {
    getUserProfile.mockResolvedValue({ ...baseProfile, watchedListVisible: false, watched: [], recentActivity: [] })
    renderWithRouter()

    expect(await screen.findByText(/private/i)).toBeInTheDocument()
  })

  // QA (docs/qa/settings-bugs.md #2): turning off "Show my watched list" also
  // hid it from the owner's own profile — the backend now still returns the
  // owner's own data regardless of watchedListVisible; this is the frontend
  // half of the fix, rendering it instead of the "private" message for self.
  it('shows your own watched list even when watchedListVisible is false, since that toggle only hides it from others', async () => {
    getUserProfile.mockResolvedValue({ ...baseProfile, relationship: 'self', tasteMatchScore: null, watchedListVisible: false })
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Rohan')).toBeInTheDocument())
    expect(screen.queryByText(/private/i)).not.toBeInTheDocument()
    expect(screen.getByText('Interstellar')).toBeInTheDocument()
    expect(screen.getByText(/Hereditary/)).toBeInTheDocument()
  })

  it('shows an empty-state message when the list is visible but nothing public has been watched', async () => {
    getUserProfile.mockResolvedValue({ ...baseProfile, watchedListVisible: true, watched: [] })
    renderWithRouter()

    expect(await screen.findByText(/no public watched movies/i)).toBeInTheDocument()
  })

  it('navigates back when Back is clicked', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Rohan')).toBeInTheDocument())
    // Two Back buttons exist (mobile banner overlay + desktop row) — CSS
    // media queries hide one or the other, invisible to jsdom's layout-less
    // DOM, so either one navigating back is what matters here.
    fireEvent.click(screen.getAllByRole('button', { name: /back/i })[0])
    expect(await screen.findByText('Previous page')).toBeInTheDocument()
  })

  it('shows an error message when loading fails', async () => {
    getUserProfile.mockRejectedValue(new Error('No such user'))
    renderWithRouter('ghost')

    expect(await screen.findByRole('alert')).toHaveTextContent('No such user')
  })

  it('shows the stat row: watched, watchlist, reviews, following, followers counts', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    renderWithRouter()

    const stats = await screen.findByTestId('profile-stats')
    expect(within(stats).getByText('98')).toBeInTheDocument()
    expect(within(stats).getByText('21')).toBeInTheDocument()
    expect(within(stats).getByText('37')).toBeInTheDocument()
    expect(within(stats).getByText('8')).toBeInTheDocument()
    expect(within(stats).getByText('12')).toBeInTheDocument()
  })

  it('shows the joined date derived from joinedAt', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    renderWithRouter()

    expect(await screen.findByText(/joined/i)).toHaveTextContent('Joined Jun 2026')
  })

  it('omits the joined date when joinedAt is null', async () => {
    getUserProfile.mockResolvedValue({ ...baseProfile, joinedAt: null })
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Rohan')).toBeInTheDocument())
    expect(screen.queryByText(/joined/i)).not.toBeInTheDocument()
  })

  it('shows top genres as percentage bars', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    renderWithRouter()

    expect(await screen.findByText('Drama')).toBeInTheDocument()
    expect(screen.getByText('82%')).toBeInTheDocument()
    expect(screen.getByText('Romance')).toBeInTheDocument()
    expect(screen.getByText('74%')).toBeInTheDocument()
  })

  it('shows recent activity entries when the list is visible', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    renderWithRouter()

    expect(await screen.findByText(/Hereditary/)).toBeInTheDocument()
  })

  it('shows a taste-match card with the caller\'s score when viewing someone else', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    renderWithRouter()

    expect(await screen.findByText(/taste match/i)).toBeInTheDocument()
    expect(screen.getByText('87%')).toBeInTheDocument()
  })

  it('omits the taste-match card when no score has been computed for this pair', async () => {
    getUserProfile.mockResolvedValue({ ...baseProfile, tasteMatchScore: null })
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Rohan')).toBeInTheDocument())
    expect(screen.queryByText(/taste match/i)).not.toBeInTheDocument()
  })

  it('shows Overview as the active tab alongside the not-yet-built tabs', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Rohan')).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Watched' })).toHaveAttribute('title', 'Coming soon')
  })

  it('gives the Following state its own accent-outline style, distinct from the muted Requested state', async () => {
    getUserProfile.mockResolvedValue({ ...baseProfile, relationship: 'following' })
    renderWithRouter()

    const button = await screen.findByRole('button', { name: 'Following' })
    expect(button).toHaveClass('border-accent')
    expect(button).toHaveClass('text-accent')
    expect(button).not.toHaveClass('bg-accent')
  })

  it('gives the Requested (pending) state a muted style, distinct from Following', async () => {
    getUserProfile.mockResolvedValue({ ...baseProfile, relationship: 'pending' })
    renderWithRouter()

    const button = await screen.findByRole('button', { name: 'Requested' })
    expect(button).toHaveClass('text-text-muted')
    expect(button).not.toHaveClass('border-accent')
    expect(button).not.toHaveClass('bg-accent')
  })

  it('renders the taste-match score as a proportional progress ring, not a flat circle', async () => {
    getUserProfile.mockResolvedValue({ ...baseProfile, tasteMatchScore: 25 })
    renderWithRouter()

    const ring = await screen.findByTestId('taste-match-progress')
    const offset = Number(ring.getAttribute('stroke-dashoffset'))
    // circumference for r=28 is ~175.93 — a low 25% score should leave most
    // of the ring "empty" (a large offset), unlike a full/flat circle.
    expect(offset).toBeGreaterThan(120)
    expect(offset).toBeLessThan(140)
  })

  it('shows a smaller stroke-dashoffset (more filled ring) for a higher taste-match score', async () => {
    getUserProfile.mockResolvedValue({ ...baseProfile, tasteMatchScore: 90 })
    renderWithRouter()

    const ring = await screen.findByTestId('taste-match-progress')
    const offset = Number(ring.getAttribute('stroke-dashoffset'))
    expect(offset).toBeLessThan(20)
  })

  it('shows a relative "time ago" timestamp on recent activity entries', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    getUserProfile.mockResolvedValue({
      ...baseProfile,
      recentActivity: [{ ...baseProfile.recentActivity[0], createdAt: twoHoursAgo }]
    })
    renderWithRouter()

    expect(await screen.findByText(/2h ago/)).toBeInTheDocument()
  })

  it('does not render the raw favoriteGenres/preferredLanguages text block (superseded by the genre-percentage bars)', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Rohan')).toBeInTheDocument())
    expect(screen.queryByText(/Favorite genres:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Preferred languages:/)).not.toBeInTheDocument()
  })

  it('does not highlight Home (or anything else) in the Sidebar while viewing a profile page — there is no "Profile" nav row anymore', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Rohan')).toBeInTheDocument())
    // Scoped to <aside> — MobileTabBar (below) also renders its own "Home"
    // button, so an unscoped query is now ambiguous between the two.
    const sidebar = within(document.querySelector('aside')!)
    const homeRow = sidebar.getByRole('button', { name: 'Home' })
    expect(homeRow.querySelector('span')).not.toHaveClass('text-accent')
    expect(sidebar.queryByRole('button', { name: 'Profile' })).not.toBeInTheDocument()
  })

  // QA (docs/qa/profile-bugs.md #2): Profile never rendered MobileTabBar, so
  // mobile visitors had no bottom nav at all on this page, unlike Home/Search.
  it('renders the mobile bottom nav (MobileTabBar), matching Home/Search', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    renderWithRouter()

    await waitFor(() => expect(screen.getByText('Rohan')).toBeInTheDocument())
    // Sidebar and MobileTabBar both render a "Coming soon" Inbox row (Profile's
    // own tab row has no Inbox tab, unlike Events/Watched/etc., so this one is
    // unambiguous) — two present means MobileTabBar is actually mounted, not
    // just Sidebar's own.
    expect(screen.getAllByText('Inbox')).toHaveLength(2)
  })

  // QA #3: the button flipped to "Following" immediately, but Followers kept
  // showing its stale pre-follow count until a reload — toggleConnect only
  // ever patched `relationship`, never the stat counters next to it.
  it('updates the Followers count immediately after connecting, not just the button', async () => {
    getUserProfile.mockResolvedValue(baseProfile) // followerCount: 12
    followUser.mockResolvedValue({ status: 'following' })
    renderWithRouter()

    const stats = await screen.findByTestId('profile-stats')
    expect(within(stats).getByText('12')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => expect(within(stats).getByText('13')).toBeInTheDocument())
  })

  it('reverts the Followers count if the follow request fails', async () => {
    getUserProfile.mockResolvedValue(baseProfile) // followerCount: 12
    followUser.mockRejectedValue(new Error('network error'))
    renderWithRouter()

    const stats = await screen.findByTestId('profile-stats')
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(within(stats).getByText('13')).toBeInTheDocument())
    await waitFor(() => expect(within(stats).getByText('12')).toBeInTheDocument())
  })

  it('decrements the Followers count immediately after unfollowing', async () => {
    getUserProfile.mockResolvedValue({ ...baseProfile, relationship: 'following' }) // followerCount: 12
    unfollowUser.mockResolvedValue(undefined)
    renderWithRouter()

    const stats = await screen.findByTestId('profile-stats')
    expect(within(stats).getByText('12')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Following' }))

    await waitFor(() => expect(within(stats).getByText('11')).toBeInTheDocument())
  })

  // QA #4: the disabled "Message" button's SVG was the standard three-node
  // "Share" glyph, not a message/chat-bubble icon — reads as "Share" despite
  // its accessible name and evident intent being "Message".
  it('uses a chat-bubble icon (not the Share glyph) on the disabled Message button', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    renderWithRouter()

    const messageButton = await screen.findByRole('button', { name: 'Message' })
    const path = messageButton.querySelector('svg path')
    expect(path).toHaveAttribute('d', 'M21 11.5a8.4 8.4 0 0 1-8.9 8.4 8.6 8.6 0 0 1-3.6-.8L3 20l1-4.9A8.4 8.4 0 1 1 21 11.5z')
  })

  // QA #5: the Connect/Following button had no in-flight guard, so a fast
  // double-click fired two overlapping follow/unfollow requests.
  it('ignores a second click on Connect while the first request is still in flight', async () => {
    getUserProfile.mockResolvedValue(baseProfile)
    let resolveFollow!: (v: { status: 'following' | 'pending' }) => void
    followUser.mockReturnValue(new Promise((resolve) => { resolveFollow = resolve }))
    renderWithRouter()

    const button = await screen.findByRole('button', { name: 'Connect' })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)

    resolveFollow({ status: 'following' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Following' })).toBeInTheDocument())
    expect(followUser).toHaveBeenCalledTimes(1)
  })
})
