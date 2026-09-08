import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const updateMe = vi.fn()
const getMe = vi.fn().mockResolvedValue({ uid: 'caller-1', displayName: 'Ananya Rao', email: 'ananya.rao@gmail.com' })
vi.mock('../../../../src/lib/api', () => ({ updateMe, getMe }))

const checkUsernameAvailable = vi.fn()
vi.mock('../../../../src/features/onboarding/services/onboardingApi', () => ({ checkUsernameAvailable }))

const getNotifications = vi.fn().mockResolvedValue({ items: [] })
vi.mock('../../../../src/features/home/services/homeApi', () => ({ getNotifications }))

const signOutUser = vi.fn()
// Mutable so individual tests can simulate the OTP/custom-token sign-in path
// (Welcome.tsx), which leaves providerData empty unlike a Google/Microsoft
// popup sign-in.
let authProviderData: { providerId: string }[] = [{ providerId: 'google.com' }]
vi.mock('../../../../src/lib/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'caller-1', get providerData() { return authProviderData } },
    loading: false,
    signInWithGoogle: vi.fn(),
    signInWithMicrosoft: vi.fn(),
    signInWithToken: vi.fn(),
    signOutUser
  })
}))

const { Settings } = await import('../../../../src/features/settings/components/Settings')

const baseMe = {
  uid: 'caller-1',
  displayName: 'Ananya Rao',
  username: 'ananya',
  email: 'ananya.rao@gmail.com',
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
  updateMe.mockReset()
  checkUsernameAvailable.mockReset()
  getMe.mockClear()
  getNotifications.mockClear()
  signOutUser.mockReset()
  authProviderData = [{ providerId: 'google.com' }]
})

function renderSettings(me = baseMe, onUpdateMe = vi.fn()) {
  return {
    onUpdateMe,
    ...render(
      <MemoryRouter initialEntries={['/', '/settings']} initialIndex={1}>
        <Routes>
          <Route path="/" element={<p>Previous page</p>} />
          <Route path="/settings" element={<Settings me={me} onUpdateMe={onUpdateMe} />} />
        </Routes>
      </MemoryRouter>
    )
  }
}

describe('Settings', () => {
  it('renders the signed-in shell: Sidebar (Settings highlighted), AppHeader, MobileTabBar', async () => {
    renderSettings()

    expect(screen.getByText('BINJ')).toBeInTheDocument() // Sidebar's own logo mark
    // Settings supplies `me` directly to AppHeader (no independent fetch, see
    // AppHeader's own comment on that), and Sidebar has no self-fetch of its
    // own at all — so the signal this shell actually rendered is the
    // identity bar's content, not a getMe() call.
    await waitFor(() => expect(screen.getByText('Ananya Rao')).toBeInTheDocument())
    const sidebar = within(document.querySelector('aside')!)
    const settingsRow = sidebar.getByText('Settings').closest('button')
    expect(settingsRow?.querySelector('span')).toHaveClass('text-accent')
    // Mobile bottom nav renders too — the mockup's mobile Settings screen keeps it.
    expect(screen.getAllByText('Home').length).toBeGreaterThan(0)
  })

  it('shows the current display name and username', () => {
    renderSettings()

    expect(screen.getByDisplayValue('Ananya Rao')).toBeInTheDocument()
    expect(screen.getByDisplayValue('ananya')).toBeInTheDocument()
  })

  it('saves a changed display name and threads the server response back via onUpdateMe', async () => {
    const updated = { ...baseMe, displayName: 'Ananya R.' }
    updateMe.mockResolvedValue(updated)
    const { onUpdateMe } = renderSettings()

    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Ananya R.' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ displayName: 'Ananya R.' }))
    await waitFor(() => expect(onUpdateMe).toHaveBeenCalledWith(updated))
  })

  it('checks username availability (debounced) and blocks Save while taken', async () => {
    checkUsernameAvailable.mockResolvedValue({ available: false })
    renderSettings()

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'newname' } })
    expect(await screen.findByText(/checking/i)).toBeInTheDocument()

    await waitFor(() => expect(checkUsernameAvailable).toHaveBeenCalledWith('newname'))
    expect(await screen.findByText(/taken/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('allows saving once the new username is confirmed available', async () => {
    checkUsernameAvailable.mockResolvedValue({ available: true })
    const updated = { ...baseMe, username: 'newname' }
    updateMe.mockResolvedValue(updated)
    const { onUpdateMe } = renderSettings()

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'newname' } })
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled())

    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ displayName: 'Ananya Rao', username: 'newname' }))
    await waitFor(() => expect(onUpdateMe).toHaveBeenCalledWith(updated))
  })

  it('does not re-check availability when the username is left unchanged', async () => {
    renderSettings()

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'other' } })
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'ananya' } })

    await new Promise((r) => setTimeout(r, 500))
    expect(checkUsernameAvailable).not.toHaveBeenCalled()
  })

  it('renders all six accent swatches, with the current theme marked selected', () => {
    renderSettings()

    for (const label of ['Emerald', 'Cyan', 'Purple', 'Pink', 'Amber', 'Red']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Emerald' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Cyan' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('picks a new accent theme, saves it, and threads it back via onUpdateMe', async () => {
    const updated = { ...baseMe, accentTheme: 'cyan' as const }
    updateMe.mockResolvedValue(updated)
    const { onUpdateMe } = renderSettings()

    fireEvent.click(screen.getByRole('button', { name: 'Cyan' }))

    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ accentTheme: 'cyan' }))
    await waitFor(() => expect(onUpdateMe).toHaveBeenCalledWith(updated))
  })

  it('toggles "Show my watched list" optimistically and persists it', async () => {
    const updated = { ...baseMe, listVisible: false }
    updateMe.mockResolvedValue(updated)
    const { onUpdateMe } = renderSettings()

    const toggle = screen.getByRole('switch', { name: /show my watched list/i })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)

    expect(onUpdateMe).toHaveBeenCalledWith(expect.objectContaining({ listVisible: false })) // optimistic
    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ listVisible: false }))
    await waitFor(() => expect(onUpdateMe).toHaveBeenCalledWith(updated))
  })

  it('reverts the toggle if saving it fails', async () => {
    updateMe.mockRejectedValue(new Error('network error'))
    const { onUpdateMe } = renderSettings()

    fireEvent.click(screen.getByRole('switch', { name: /show my watched list/i }))

    await waitFor(() => expect(onUpdateMe).toHaveBeenLastCalledWith(expect.objectContaining({ listVisible: true })))
  })

  it('toggles "Approve followers manually"', async () => {
    const updated = { ...baseMe, followRequiresApproval: true }
    updateMe.mockResolvedValue(updated)
    const { onUpdateMe } = renderSettings()

    fireEvent.click(screen.getByRole('switch', { name: /approve followers manually/i }))

    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ followRequiresApproval: true }))
    await waitFor(() => expect(onUpdateMe).toHaveBeenCalledWith(updated))
  })

  it('toggles "Hide me from public Discover suggestions"', async () => {
    const updated = { ...baseMe, hideFromDiscovery: true }
    updateMe.mockResolvedValue(updated)
    const { onUpdateMe } = renderSettings()

    const toggle = screen.getByRole('switch', { name: /hide me from public discover suggestions/i })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)

    expect(onUpdateMe).toHaveBeenCalledWith(expect.objectContaining({ hideFromDiscovery: true })) // optimistic
    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ hideFromDiscovery: true }))
    await waitFor(() => expect(onUpdateMe).toHaveBeenCalledWith(updated))
  })

  it('toggles "Email me about activity"', async () => {
    const updated = { ...baseMe, notificationPrefs: { emailEnabled: false } }
    updateMe.mockResolvedValue(updated)
    const { onUpdateMe } = renderSettings()

    fireEvent.click(screen.getByRole('switch', { name: /email me about activity/i }))

    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ notificationPrefs: { emailEnabled: false } }))
    await waitFor(() => expect(onUpdateMe).toHaveBeenCalledWith(updated))
  })

  it('shows the signed-in email and calls signOutUser when Sign out is clicked', () => {
    renderSettings()

    expect(screen.getByText('ananya.rao@gmail.com')).toBeInTheDocument()
    expect(screen.getByText('GOOGLE')).toBeInTheDocument()
    // Two "Sign out" buttons render now that AppHeader gets a live `me` prop
    // (docs/qa/settings-bugs.md #1) and no longer waits on its own async
    // fetch to appear: AppHeader's own top-bar one, and this page's Account
    // section one. Both call the same signOutUser — the second is Settings'.
    const signOutButtons = screen.getAllByRole('button', { name: /sign out/i })
    expect(signOutButtons).toHaveLength(2)
    fireEvent.click(signOutButtons[1])
    expect(signOutUser).toHaveBeenCalled()
  })

  it('falls back to an EMAIL provider badge when Firebase providerData is empty (the OTP/custom-token sign-in path)', () => {
    authProviderData = []
    renderSettings()

    expect(screen.getByText('EMAIL')).toBeInTheDocument()
    expect(screen.getByText(/signed in with email as/i)).toBeInTheDocument()
  })

  it('renders Delete account disabled with "Coming soon", not wired to anything', () => {
    renderSettings()

    const deleteButton = screen.getByRole('button', { name: /delete account/i })
    expect(deleteButton).toBeDisabled()
    expect(deleteButton).toHaveAttribute('title', 'Coming soon')
  })

  it('navigates back when the mobile Back button is clicked', async () => {
    renderSettings()

    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(await screen.findByText('Previous page')).toBeInTheDocument()
  })
})
