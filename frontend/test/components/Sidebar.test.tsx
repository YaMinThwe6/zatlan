import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '../../src/components/Sidebar'

describe('Sidebar', () => {
  it('shows a visible "Coming soon" tag on Inbox and Communities, not just a hover tooltip', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )

    const inboxRow = screen.getByText('Inbox').closest('div')!
    expect(within(inboxRow).getByText('Coming soon')).toBeInTheDocument()

    const communitiesRow = screen.getByText('Communities').closest('div')!
    expect(within(communitiesRow).getByText('Coming soon')).toBeInTheDocument()
  })

  it('does not navigate when a disabled row is clicked', () => {
    render(
      <MemoryRouter>
        <Sidebar active="home" />
      </MemoryRouter>
    )

    // Disabled rows render as a <div>, never a <button> — nothing to click through to.
    expect(screen.queryByRole('button', { name: /communities/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^inbox/i })).not.toBeInTheDocument()
  })
})
