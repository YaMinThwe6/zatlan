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

  describe('detailed variant (People Discovery page)', () => {
    it('does not render matchReason text, genre tags, or follower count without the detailed prop — Home\'s compact rail widget', () => {
      render(
        <PersonSuggestionCard
          person={person({ matchReason: 'genreOverlap', favoriteGenres: ['Sci-Fi', 'Drama'], followerCount: 128 })}
          onOpenProfile={vi.fn()}
          onToggleConnect={vi.fn()}
        />
      )
      expect(screen.queryByText(/favorite genres/i)).not.toBeInTheDocument()
      expect(screen.queryByText('Sci-Fi')).not.toBeInTheDocument()
      expect(screen.queryByText(/128/)).not.toBeInTheDocument()
    })

    it('renders a readable reason for each matchReason value', () => {
      const { rerender } = render(
        <PersonSuggestionCard detailed person={person({ matchReason: 'tasteMatch' })} onOpenProfile={vi.fn()} onToggleConnect={vi.fn()} />
      )
      expect(screen.getByText(/similar taste in movies/i)).toBeInTheDocument()

      rerender(<PersonSuggestionCard detailed person={person({ matchReason: 'genreOverlap' })} onOpenProfile={vi.fn()} onToggleConnect={vi.fn()} />)
      expect(screen.getByText(/shares your favorite genres/i)).toBeInTheDocument()

      rerender(<PersonSuggestionCard detailed person={person({ matchReason: 'languageOverlap' })} onOpenProfile={vi.fn()} onToggleConnect={vi.fn()} />)
      expect(screen.getByText(/language/i)).toBeInTheDocument()

      rerender(<PersonSuggestionCard detailed person={person({ matchReason: 'suggested' })} onOpenProfile={vi.fn()} onToggleConnect={vi.fn()} />)
      expect(screen.getByText(/suggested for you/i)).toBeInTheDocument()
    })

    it('renders up to 3 favorite-genre tags', () => {
      render(
        <PersonSuggestionCard
          detailed
          person={person({ favoriteGenres: ['Sci-Fi', 'Drama', 'Thriller', 'Comedy'] })}
          onOpenProfile={vi.fn()}
          onToggleConnect={vi.fn()}
        />
      )
      expect(screen.getByText('Sci-Fi')).toBeInTheDocument()
      expect(screen.getByText('Drama')).toBeInTheDocument()
      expect(screen.getByText('Thriller')).toBeInTheDocument()
      expect(screen.queryByText('Comedy')).not.toBeInTheDocument()
    })

    it('renders follower count when there is at least one follower', () => {
      render(<PersonSuggestionCard detailed person={person({ followerCount: 128 })} onOpenProfile={vi.fn()} onToggleConnect={vi.fn()} />)
      expect(screen.getByText(/128/)).toBeInTheDocument()
      expect(screen.getByText(/follower/i)).toBeInTheDocument()
    })

    it('omits the follower count line when there are none, rather than showing "0 followers"', () => {
      render(<PersonSuggestionCard detailed person={person({ followerCount: 0 })} onOpenProfile={vi.fn()} onToggleConnect={vi.fn()} />)
      expect(screen.queryByText(/follower/i)).not.toBeInTheDocument()
    })

    it('tolerates missing favoriteGenres/followerCount from an older cached response instead of crashing', () => {
      const incomplete = { ...person(), favoriteGenres: undefined, followerCount: undefined } as unknown as ReturnType<typeof person>
      expect(() =>
        render(<PersonSuggestionCard detailed person={incomplete} onOpenProfile={vi.fn()} onToggleConnect={vi.fn()} />)
      ).not.toThrow()
    })
  })
})
