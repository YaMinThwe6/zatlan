import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MobileTabBar } from '../../src/components/MobileTabBar'

function renderAt(active: 'home' | 'search' | 'events' | 'profile') {
  return render(
    <MemoryRouter initialEntries={['/start']}>
      <Routes>
        <Route path="/start" element={<MobileTabBar active={active} />} />
        <Route path="/" element={<p>Home page</p>} />
        <Route path="/search" element={<p>Search page</p>} />
        <Route path="/events" element={<p>Events page</p>} />
        <Route path="/story" element={<p>About page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('MobileTabBar', () => {
  it('renders the active tab as static text and the others as navigation', () => {
    renderAt('search')
    expect(screen.queryByRole('button', { name: /^search$/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^home$/i }))
    expect(screen.getByText('Home page')).toBeInTheDocument()
  })

  it('navigates to Search from the Home tab', () => {
    renderAt('home')
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }))
    expect(screen.getByText('Search page')).toBeInTheDocument()
  })

  it('links to Our Story', () => {
    renderAt('home')
    fireEvent.click(screen.getByRole('button', { name: /our story/i }))
    expect(screen.getByText('About page')).toBeInTheDocument()
  })

  it('shows People / Inbox as coming-soon, non-interactive', () => {
    renderAt('home')
    for (const label of ['People', 'Inbox']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${label}$`, 'i') })).not.toBeInTheDocument()
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('navigates to Events from the Home tab', () => {
    renderAt('home')
    fireEvent.click(screen.getByRole('button', { name: /^events$/i }))
    expect(screen.getByText('Events page')).toBeInTheDocument()
  })

  it('renders the Events tab as static text, not a button, when already on Events', () => {
    renderAt('events')
    expect(screen.queryByRole('button', { name: /^events$/i })).not.toBeInTheDocument()
    expect(screen.getByText('Events')).toBeInTheDocument()
  })

  // Profile.tsx renders this bar too, but Profile has no icon of its own here
  // (unlike Sidebar, which does have a Profile row) — active="profile" should
  // just leave both Home and Search as ordinary clickable, non-highlighted tabs.
  it('highlights neither Home nor Search when active is "profile"', () => {
    renderAt('profile')
    expect(screen.getByRole('button', { name: /^home$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^search$/i })).toBeInTheDocument()
  })
})
