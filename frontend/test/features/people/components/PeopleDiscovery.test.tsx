import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getTasteMatches = vi.fn()
const followUser = vi.fn()
const unfollowUser = vi.fn()
const getMe = vi.fn()
vi.mock('../../../../src/features/home/services/homeApi', () => ({ getTasteMatches, followUser, unfollowUser }))
vi.mock('../../../../src/lib/api', () => ({ getMe }))

const { PeopleDiscovery } = await import('../../../../src/features/people/components/PeopleDiscovery')

afterEach(() => {
  getTasteMatches.mockReset()
  followUser.mockReset()
  unfollowUser.mockReset()
  getMe.mockReset()
})

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/people']}>
      <Routes>
        <Route path="/people" element={<PeopleDiscovery />} />
        <Route path="/profile/:uid" element={<p>Profile page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('PeopleDiscovery', () => {
  it('requests a wider result set than the Home widget default', async () => {
    getMe.mockResolvedValue({ uid: 'me' })
    getTasteMatches.mockResolvedValue({ items: [] })
    renderWithRouter()

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
    renderWithRouter()

    await waitFor(() => expect(screen.getAllByText('Rohan').length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: 'Following' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(followUser).toHaveBeenCalledWith('u1'))
  })

  it('opens a profile when a suggested person is clicked', async () => {
    getMe.mockResolvedValue({ uid: 'me' })
    getTasteMatches.mockResolvedValue({ items: [{ uid: 'u1', displayName: 'Rohan', photoURL: null, score: 84, relationship: 'none', matchReason: 'tasteMatch' }] })
    renderWithRouter()

    await waitFor(() => expect(screen.getAllByText('Rohan').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText('Rohan')[0])
    expect(await screen.findByText('Profile page')).toBeInTheDocument()
  })

  it('shows a friendly empty state instead of a blank page when there is truly no one to suggest', async () => {
    getMe.mockResolvedValue({ uid: 'me' })
    getTasteMatches.mockResolvedValue({ items: [] })
    renderWithRouter()

    expect(await screen.findByText(/no suggestions yet/i)).toBeInTheDocument()
  })
})
