import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PersonSuggestionCard } from '../../src/components/PersonSuggestionCard'
import type { TasteMatch } from '../../src/features/home/services/homeApi'

function person(overrides: Partial<TasteMatch> = {}): TasteMatch {
  return {
    uid: 'u1',
    displayName: 'Rohan',
    photoURL: null,
    score: 84,
    relationship: 'none',
    matchReason: 'tasteMatch',
    favoriteGenres: [],
    followerCount: 0,
    ...overrides
  }
}

describe('PersonSuggestionCard', () => {
  it('shows Connect for relationship "none"', () => {
    render(<PersonSuggestionCard person={person()} onOpenProfile={vi.fn()} onToggleConnect={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })

  it('shows Following for relationship "following"', () => {
    render(<PersonSuggestionCard person={person({ relationship: 'following' })} onOpenProfile={vi.fn()} onToggleConnect={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Following' })).toBeInTheDocument()
  })

  it('shows Requested for relationship "pending"', () => {
    render(<PersonSuggestionCard person={person({ relationship: 'pending' })} onOpenProfile={vi.fn()} onToggleConnect={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Requested' })).toBeInTheDocument()
  })

  it('calls onToggleConnect with the uid when the connect button is clicked', () => {
    const onToggleConnect = vi.fn()
    render(<PersonSuggestionCard person={person({ uid: 'u42' })} onOpenProfile={vi.fn()} onToggleConnect={onToggleConnect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onToggleConnect).toHaveBeenCalledWith('u42')
  })

  it('calls onOpenProfile with the uid when the name is clicked, without triggering onToggleConnect', () => {
    const onOpenProfile = vi.fn()
    const onToggleConnect = vi.fn()
    render(<PersonSuggestionCard person={person({ uid: 'u42' })} onOpenProfile={onOpenProfile} onToggleConnect={onToggleConnect} />)
    fireEvent.click(screen.getAllByText('Rohan')[0])
    expect(onOpenProfile).toHaveBeenCalledWith('u42')
    expect(onToggleConnect).not.toHaveBeenCalled()
  })
})
