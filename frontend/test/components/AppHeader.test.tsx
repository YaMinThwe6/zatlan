import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getMe = vi.fn()
vi.mock('../../src/lib/api', () => ({ getMe }))

const getNotifications = vi.fn()
vi.mock('../../src/features/home/services/homeApi', () => ({ getNotifications }))

const { AppHeader } = await import('../../src/components/AppHeader')

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
  getMe.mockReset()
  getNotifications.mockReset()
})

function renderWithRouter(onSignOut = vi.fn(), meProp?: typeof me) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<AppHeader onSignOut={onSignOut} me={meProp} />} />
        <Route path="/search" element={<p>Search page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AppHeader', () => {
  it('renders nothing until the profile has loaded', async () => {
    getMe.mockReturnValue(new Promise(() => {})) // never resolves
    getNotifications.mockResolvedValue({ items: [] })
    const { container } = renderWithRouter()

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the signed-in identity and unread notification count once loaded', async () => {
    getMe.mockResolvedValue(me)
    getNotifications.mockResolvedValue({ items: [{ id: 'n1' }, { id: 'n2' }] })
    renderWithRouter()

    expect(await screen.findByText('Arjun')).toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument() // avatar initial
    expect(screen.getByLabelText('2 unread notifications')).toBeInTheDocument()
  })

  it('navigates to Search when the search bar is clicked', async () => {
    getMe.mockResolvedValue(me)
    getNotifications.mockResolvedValue({ items: [] })
    renderWithRouter()

    fireEvent.click(await screen.findByText(/search movies, people, genres/i))
    expect(await screen.findByText('Search page')).toBeInTheDocument()
  })

  it('calls onSignOut when Sign out is clicked', async () => {
    getMe.mockResolvedValue(me)
    getNotifications.mockResolvedValue({ items: [] })
    const onSignOut = vi.fn()
    renderWithRouter(onSignOut)

    fireEvent.click(await screen.findByRole('button', { name: /sign out/i }))
    expect(onSignOut).toHaveBeenCalled()
  })

  it('still renders the identity bar when the notification count fails to load', async () => {
    getMe.mockResolvedValue(me)
    getNotifications.mockRejectedValue(new Error('failed'))
    renderWithRouter()

    expect(await screen.findByText('Arjun')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('0 unread notifications')).toBeInTheDocument())
  })

  // QA (docs/qa/settings-bugs.md #1): AppHeader fetched its own `me` once on
  // mount and never observed a caller's own live-updating state (e.g. after
  // Settings saves a new displayName), so it stayed stale until a reload —
  // even on pages whose own `me` state had already updated correctly.
  it('uses a caller-supplied `me` prop instead of fetching its own, and reflects it updating', async () => {
    getNotifications.mockResolvedValue({ items: [] })
    const { rerender } = render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppHeader onSignOut={vi.fn()} me={me} />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText('Arjun')).toBeInTheDocument()
    expect(getMe).not.toHaveBeenCalled() // a supplied `me` means no independent fetch at all

    rerender(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppHeader onSignOut={vi.fn()} me={{ ...me, displayName: 'Updated Name' }} />} />
        </Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText('Updated Name')).toBeInTheDocument()
  })
})
