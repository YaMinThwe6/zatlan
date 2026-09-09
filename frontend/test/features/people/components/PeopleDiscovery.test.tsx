import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'

const getTasteMatches = vi.fn()
const followUser = vi.fn()
const unfollowUser = vi.fn()
const getFollowRequests = vi.fn()
const approveFollowRequest = vi.fn()
const denyFollowRequest = vi.fn()
const getMe = vi.fn()
// AppHeader's own dependency — the shared shell every signed-in page renders.
const getNotifications = vi.fn()
vi.mock('../../../../src/features/home/services/homeApi', () => ({
  getTasteMatches,
  followUser,
  unfollowUser,
  getFollowRequests,
  approveFollowRequest,
  denyFollowRequest,
  getNotifications
}))
vi.mock('../../../../src/lib/api', () => ({ getMe }))
vi.mock('../../../../src/lib/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'me' }, loading: false, signInWithGoogle: vi.fn(), signInWithMicrosoft: vi.fn(), signInWithToken: vi.fn(), signOutUser: vi.fn() })
}))

const { PeopleDiscovery } = await import('../../../../src/features/people/components/PeopleDiscovery')

beforeEach(() => {
  // AppHeader's own fetch — not this file's focus.
  getNotifications.mockResolvedValue({ items: [] })
  getTasteMatches.mockResolvedValue({ items: [] })
  getFollowRequests.mockResolvedValue({ items: [] })
})

afterEach(() => {
  getTasteMatches.mockReset()
  followUser.mockReset()
  unfollowUser.mockReset()
  getFollowRequests.mockReset()
  approveFollowRequest.mockReset()
  denyFollowRequest.mockReset()
  getMe.mockReset()
  getNotifications.mockReset()
})

// Awaits the shared shell's own async chain settling (AppHeader awaits getMe
// before its NotificationBell child even mounts, which then awaits
// getNotifications) before returning — otherwise that chain can still be in
// flight when the test ends, firing after afterEach resets the mocks and
// throwing on a now-unconfigured one, intermittently breaking whichever test
// happens to be running when it lands.
async function renderWithRouter(path = '/people') {
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/people" element={<PeopleDiscovery />} />
        <Route path="/profile/:uid" element={<p>Profile page</p>} />
      </Routes>
    </MemoryRouter>
  )
  await waitFor(() => expect(getNotifications).toHaveBeenCalled())
  return result
}

describe('PeopleDiscovery', () => {
  it('requests a wider result set than the Home widget default', async () => {
    getMe.mockResolvedValue({ uid: 'me' })
    await renderWithRouter()

    await waitFor(() => expect(getTasteMatches).toHaveBeenCalledWith(30))
  })

  it('renders each suggested person with a working Connect button', async () => {
    getMe.mockResolvedValue({ uid: 'me' })
    getTasteMatches.mockResolvedValue({
      items: [
        { uid: 'u1', displayName: 'Rohan', photoURL: null, score: 84, relationship: 'none', matchReason: 'tasteMatch' },
        { uid: 'u2', displayName: 'Meera', photoURL: null, score: 40, relationship: 'following', matchReason: 'suggested' }
      ]
    })
    followUser.mockResolvedValue({ status: 'following' })
    await renderWithRouter()

    await waitFor(() => expect(screen.getAllByText('Rohan').length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: 'Following' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(followUser).toHaveBeenCalledWith('u1'))
  })

  it('opens a profile when a suggested person is clicked', async () => {
    getMe.mockResolvedValue({ uid: 'me' })
    getTasteMatches.mockResolvedValue({ items: [{ uid: 'u1', displayName: 'Rohan', photoURL: null, score: 84, relationship: 'none', matchReason: 'tasteMatch' }] })
    await renderWithRouter()

    await waitFor(() => expect(screen.getAllByText('Rohan').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText('Rohan')[0])
    expect(await screen.findByText('Profile page')).toBeInTheDocument()
  })

  it('shows a friendly empty state instead of a blank page when there is truly no one to suggest', async () => {
    getMe.mockResolvedValue({ uid: 'me' })
    await renderWithRouter()

    expect(await screen.findByText(/no suggestions yet/i)).toBeInTheDocument()
  })

  describe('Requests tab', () => {
    it("doesn't fetch pending follow requests until the Requests tab is opened", async () => {
      getMe.mockResolvedValue({ uid: 'me' })
      await renderWithRouter()

      await waitFor(() => expect(getTasteMatches).toHaveBeenCalled())
      expect(getFollowRequests).not.toHaveBeenCalled()
    })

    it('fetches and shows each pending requester, with Approve/Deny', async () => {
      getMe.mockResolvedValue({ uid: 'me' })
      getFollowRequests.mockResolvedValue({ items: [{ uid: 'req-1', displayName: 'Priya', photoURL: null }] })
      await renderWithRouter()

      fireEvent.click(screen.getByRole('button', { name: 'Requests' }))

      await waitFor(() => expect(getFollowRequests).toHaveBeenCalled())
      expect(await screen.findByText('Priya')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument()
    })

    it('shows an empty state when there are no pending requests', async () => {
      getMe.mockResolvedValue({ uid: 'me' })
      await renderWithRouter()

      fireEvent.click(screen.getByRole('button', { name: 'Requests' }))

      expect(await screen.findByText(/no pending requests/i)).toBeInTheDocument()
    })

    it('clicking Approve calls approveFollowRequest and removes that requester from the list', async () => {
      getMe.mockResolvedValue({ uid: 'me' })
      getFollowRequests.mockResolvedValue({ items: [{ uid: 'req-1', displayName: 'Priya', photoURL: null }] })
      approveFollowRequest.mockResolvedValue(undefined)
      await renderWithRouter()

      fireEvent.click(screen.getByRole('button', { name: 'Requests' }))
      await screen.findByText('Priya')
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

      await waitFor(() => expect(approveFollowRequest).toHaveBeenCalledWith('req-1'))
      await waitFor(() => expect(screen.queryByText('Priya')).not.toBeInTheDocument())
    })

    it('clicking Deny calls denyFollowRequest and removes that requester from the list', async () => {
      getMe.mockResolvedValue({ uid: 'me' })
      getFollowRequests.mockResolvedValue({ items: [{ uid: 'req-1', displayName: 'Priya', photoURL: null }] })
      denyFollowRequest.mockResolvedValue(undefined)
      await renderWithRouter()

      fireEvent.click(screen.getByRole('button', { name: 'Requests' }))
      await screen.findByText('Priya')
      fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

      await waitFor(() => expect(denyFollowRequest).toHaveBeenCalledWith('req-1'))
      await waitFor(() => expect(screen.queryByText('Priya')).not.toBeInTheDocument())
    })

    it('opens directly on the Requests tab via ?tab=requests — the notification-bell deep link', async () => {
      getMe.mockResolvedValue({ uid: 'me' })
      getFollowRequests.mockResolvedValue({ items: [{ uid: 'req-1', displayName: 'Priya', photoURL: null }] })
      await renderWithRouter('/people?tab=requests')

      expect(await screen.findByText('Priya')).toBeInTheDocument()
      expect(screen.queryByText(/no suggestions yet/i)).not.toBeInTheDocument() // Discover content isn't showing underneath
    })

    // Real bug (same class as Profile.tsx's ?tab= one): a followRequest
    // notification navigates to /people?tab=requests — while already
    // sitting on /people, that's a same-route, query-only navigation, so
    // this component never unmounts and a useState initializer alone would
    // never see the new ?tab=.
    it('switches to the Requests tab on a same-page ?tab= navigation, not just on first mount', async () => {
      getMe.mockResolvedValue({ uid: 'me' })
      getFollowRequests.mockResolvedValue({ items: [{ uid: 'req-1', displayName: 'Priya', photoURL: null }] })
      render(
        <MemoryRouter initialEntries={['/people']}>
          <Routes>
            <Route
              path="/people"
              element={
                <>
                  <Link to="/people?tab=requests">Go to Requests</Link>
                  <PeopleDiscovery />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      )
      await waitFor(() => expect(getNotifications).toHaveBeenCalled())

      fireEvent.click(screen.getByText('Go to Requests'))

      expect(await screen.findByText('Priya')).toBeInTheDocument()
    })
  })
})
