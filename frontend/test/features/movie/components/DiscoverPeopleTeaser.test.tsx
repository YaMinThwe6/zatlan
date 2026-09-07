import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getTopFollowedPeople = vi.fn()
vi.mock('../../../../src/features/movie/services/movieApi', () => ({ getTopFollowedPeople }))

const { DiscoverPeopleTeaser } = await import('../../../../src/features/movie/components/DiscoverPeopleTeaser')

afterEach(() => {
  getTopFollowedPeople.mockReset()
})

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<DiscoverPeopleTeaser />} />
        <Route path="/get-started" element={<p>Get started page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('DiscoverPeopleTeaser', () => {
  it('shows a loading skeleton while the fetch is in flight, no fabricated names', () => {
    getTopFollowedPeople.mockReturnValue(new Promise(() => {}))
    renderWithRouter()
    expect(screen.getByText('People you might vibe with')).toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('shows real top-followed users with their real follower counts once loaded', async () => {
    getTopFollowedPeople.mockResolvedValue({
      items: [
        { uid: 'u1', displayName: 'Rohan', photoURL: null, followerCount: 12 },
        { uid: 'u2', displayName: 'Meera', photoURL: null, followerCount: 1 }
      ]
    })
    renderWithRouter()

    expect(await screen.findByText('Rohan')).toBeInTheDocument()
    expect(screen.getByText('12 followers')).toBeInTheDocument()
    expect(screen.getByText('Meera')).toBeInTheDocument()
    expect(screen.getByText('1 follower')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /sign in to connect/i })).toHaveLength(2)
  })

  it('falls back to the honest sign-in CTA when there are no real users to show yet', async () => {
    getTopFollowedPeople.mockResolvedValue({ items: [] })
    renderWithRouter()
    expect(await screen.findByRole('button', { name: /sign up \/ sign in to view/i })).toBeInTheDocument()
  })

  it('falls back to the same CTA if the fetch fails, rather than showing an error to a guest', async () => {
    getTopFollowedPeople.mockRejectedValue(new Error('network error'))
    renderWithRouter()
    expect(await screen.findByRole('button', { name: /sign up \/ sign in to view/i })).toBeInTheDocument()
  })

  it('navigates to Get Started when a person row\'s Sign in to connect is clicked', async () => {
    getTopFollowedPeople.mockResolvedValue({ items: [{ uid: 'u1', displayName: 'Rohan', photoURL: null, followerCount: 5 }] })
    renderWithRouter()

    fireEvent.click(await screen.findByRole('button', { name: /sign in to connect/i }))
    expect(await screen.findByText('Get started page')).toBeInTheDocument()
  })

  it('navigates to Get Started from the empty-state CTA too', async () => {
    getTopFollowedPeople.mockResolvedValue({ items: [] })
    renderWithRouter()

    fireEvent.click(await screen.findByRole('button', { name: /sign up \/ sign in to view/i }))
    await waitFor(() => expect(screen.getByText('Get started page')).toBeInTheDocument())
  })
})
