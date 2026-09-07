import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { TrailerEmbed } = await import('../../../../src/features/movie/components/TrailerEmbed')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TrailerEmbed', () => {
  it('shows the YouTube thumbnail and a play button when a trailer exists, no iframe yet', () => {
    const { container } = render(<TrailerEmbed trailerKey="abc123" posterUrl={null} />)
    expect(container.querySelector('img')).toHaveAttribute('src', expect.stringContaining('abc123'))
    expect(screen.getByRole('button', { name: /play trailer/i })).toBeInTheDocument()
    expect(screen.queryByTitle('Trailer')).not.toBeInTheDocument()
  })

  it('loads the embedded iframe only after the play button is clicked', () => {
    render(<TrailerEmbed trailerKey="abc123" posterUrl={null} />)
    fireEvent.click(screen.getByRole('button', { name: /play trailer/i }))

    const iframe = screen.getByTitle('Trailer')
    expect(iframe).toHaveAttribute('src', expect.stringContaining('youtube.com/embed/abc123'))
    expect(iframe).toHaveAttribute('src', expect.stringContaining('autoplay=1'))
  })

  it('falls back to the poster with no play button when there is no trailer', () => {
    const { container } = render(<TrailerEmbed trailerKey={null} posterUrl="https://image.tmdb.org/t/p/w500/poster.jpg" />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w500/poster.jpg')
    expect(screen.queryByRole('button', { name: /play trailer/i })).not.toBeInTheDocument()
  })

  it('renders nothing visible when there is neither a trailer nor a poster', () => {
    const { container } = render(<TrailerEmbed trailerKey={null} posterUrl={null} />)
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /play trailer/i })).not.toBeInTheDocument()
  })
})
