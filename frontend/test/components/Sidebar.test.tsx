import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

const getMe = vi.fn().mockResolvedValue({ uid: 'me-1', displayName: 'Yamin', email: 'yamin@example.com' })
vi.mock('../../src/lib/api', () => ({ getMe }))

const { Sidebar } = await import('../../src/components/Sidebar')

afterEach(() => {
  getMe.mockClear()
})

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={ui} />
        <Route path="/profile/:uid" element={<p>Profile page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('Sidebar', () => {
  it('shows a visible "Coming soon" tag on Inbox and Communities, not just a hover tooltip', () => {
    renderWithRouter(<Sidebar />)

    const inboxRow = screen.getByText('Inbox').closest('div')!
    expect(within(inboxRow).getByText('Coming soon')).toBeInTheDocument()

    const communitiesRow = screen.getByText('Communities').closest('div')!
    expect(within(communitiesRow).getByText('Coming soon')).toBeInTheDocument()
  })

  it('does not navigate when a disabled row is clicked', () => {
    renderWithRouter(<Sidebar active="home" />)

    // Disabled rows render as a <div>, never a <button> — nothing to click through to.
    expect(screen.queryByRole('button', { name: /communities/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^inbox/i })).not.toBeInTheDocument()
  })

  describe('My Movies links', () => {
    it('navigates to the caller\'s own Watchlist tab', async () => {
      renderWithRouter(<Sidebar />)
      fireEvent.click(await screen.findByRole('button', { name: /^watchlist$/i }))
      expect(await screen.findByText('Profile page')).toBeInTheDocument()
    })

    it('navigates to the caller\'s own Watched tab', async () => {
      renderWithRouter(<Sidebar />)
      fireEvent.click(await screen.findByRole('button', { name: /^watched$/i }))
      expect(await screen.findByText('Profile page')).toBeInTheDocument()
    })

    it('navigates to the caller\'s own Reviews tab', async () => {
      renderWithRouter(<Sidebar />)
      fireEvent.click(await screen.findByRole('button', { name: /ratings.*reviews/i }))
      expect(await screen.findByText('Profile page')).toBeInTheDocument()
    })

    it('links to the real profile uid, and the right ?tab= for each row', async () => {
      function LocationProbe() {
        const location = useLocation()
        return <p>{location.pathname + location.search}</p>
      }
      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<Sidebar />} />
            <Route path="/profile/:uid" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      )

      fireEvent.click(await screen.findByRole('button', { name: /^watched$/i }))
      expect(await screen.findByText('/profile/me-1?tab=watched')).toBeInTheDocument()
    })
  })
})
