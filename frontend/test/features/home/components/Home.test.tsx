import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getNotifications = vi.fn()
const getHomeGreeting = vi.fn()
const getRecommendations = vi.fn()
const getTasteMatches = vi.fn()
const getUpcomingEvents = vi.fn()
const getHomeActivity = vi.fn()
const getFriendsRecommendations = vi.fn()

vi.mock('../../../../src/features/home/services/homeApi', () => ({
  getNotifications,
  getHomeGreeting,
  getRecommendations,
  getTasteMatches,
  getUpcomingEvents,
  getHomeActivity,
  getFriendsRecommendations
}))

vi.mock('../../../../src/features/movie/services/movieApi', () => ({
  markWatched: vi.fn(),
  addToWatchlist: vi.fn()
}))

const { Home } = await import('../../../../src/features/home/components/Home')

const me = {
  uid: 'uid-1',
  displayName: 'Arjun',
  username: 'arjun',
  email: 'arjun@example.com',
  photoURL: null,
  listVisible: true,
  followRequiresApproval: false,
  status: 'active' as const,
  favoriteGenres: null,
  preferredLanguages: null,
  onboardingComplete: true,
  notificationPrefs: { emailEnabled: true },
  themePreference: 'dark' as const,
  accentTheme: 'emerald' as const,
  hideFromDiscovery: false,
  isNewUser: false
}

afterEach(() => {
  getNotifications.mockReset()
  getHomeGreeting.mockReset()
  getRecommendations.mockReset()
  getTasteMatches.mockReset()
  getUpcomingEvents.mockReset()
  getHomeActivity.mockReset()
  getFriendsRecommendations.mockReset()
})

function mockAllEmpty() {
  getNotifications.mockResolvedValue({ items: [] })
  getHomeGreeting.mockResolvedValue({ quote: 'Q', attribution: 'A', source: 'random' })
  getRecommendations.mockResolvedValue({ items: [] })
  getTasteMatches.mockResolvedValue({ items: [] })
  getUpcomingEvents.mockResolvedValue({ items: [] })
  getHomeActivity.mockResolvedValue({ items: [] })
  getFriendsRecommendations.mockResolvedValue({ items: [] })
}

function renderWithRouter(onSignOut: () => void) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Home me={me} onSignOut={onSignOut} />} />
        <Route path="/search" element={<p>Search page</p>} />
        <Route path="/story" element={<p>About page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('Home', () => {
  it('shows the unread notification count as a badge', async () => {
    mockAllEmpty()
    getNotifications.mockResolvedValue({ items: [{ id: 'n1' }, { id: 'n2' }] })
    renderWithRouter(vi.fn())

    await waitFor(() => expect(getNotifications).toHaveBeenCalledWith(true))
    expect(await screen.findByText('2')).toBeInTheDocument()
  })

  it('navigates to Search when the Search button is clicked', async () => {
    mockAllEmpty()
    renderWithRouter(vi.fn())

    fireEvent.click(screen.getAllByRole('button', { name: /^search$/i })[0])
    expect(await screen.findByText('Search page')).toBeInTheDocument()
  })

  it('calls onSignOut when Sign out is clicked', async () => {
    mockAllEmpty()
    const onSignOut = vi.fn()
    renderWithRouter(onSignOut)

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(onSignOut).toHaveBeenCalled()
  })

  it('offers an Our Story link, both in the desktop sidebar and the mobile footer', async () => {
    mockAllEmpty()
    renderWithRouter(vi.fn())

    fireEvent.click(screen.getAllByRole('button', { name: /our story/i })[0])
    expect(await screen.findByText('About page')).toBeInTheDocument()
  })
})
