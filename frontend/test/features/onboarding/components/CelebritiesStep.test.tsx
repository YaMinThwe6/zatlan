import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const getCelebritySuggestions = vi.fn()
const followCelebrity = vi.fn()
const unfollowCelebrity = vi.fn()
const searchPeople = vi.fn()

vi.mock('../../../../src/features/onboarding/services/onboardingApi', () => ({ getCelebritySuggestions, followCelebrity, unfollowCelebrity, searchPeople }))

const { CelebritiesStep } = await import('../../../../src/features/onboarding/components/CelebritiesStep')

const suggestions = [
  { personId: 'p1', name: 'Jane Doe', photo: null, appearsIn: 2 },
  { personId: 'p2', name: 'Small Role Actor', photo: null, appearsIn: 1 }
]

afterEach(() => {
  getCelebritySuggestions.mockReset()
  followCelebrity.mockReset()
  unfollowCelebrity.mockReset()
  searchPeople.mockReset()
})

// OnboardingShell renders its children twice — a mobile copy and a desktop
// copy, CSS-toggled per breakpoint (same pattern as Welcome.tsx) — so every
// query here picks [0].
describe('CelebritiesStep', () => {
  it('loads and shows suggestions including minor-role people', async () => {
    getCelebritySuggestions.mockResolvedValue({ items: suggestions })
    render(<CelebritiesStep onContinue={vi.fn()} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Small Role Actor').length).toBeGreaterThan(0)
  })

  it('renders a photo via the TMDB image CDN, not the bare relative path', async () => {
    getCelebritySuggestions.mockResolvedValue({ items: [{ personId: 'p1', name: 'Jane Doe', photo: '/abc123.jpg', appearsIn: 2 }] })
    render(<CelebritiesStep onContinue={vi.fn()} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0))
    const img = document.querySelector('img') as HTMLImageElement
    expect(img.src).toBe('https://image.tmdb.org/t/p/w185/abc123.jpg')
  })

  it('shows an empty-state message when there are no suggestions', async () => {
    getCelebritySuggestions.mockResolvedValue({ items: [] })
    render(<CelebritiesStep onContinue={vi.fn()} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText(/no suggestions yet/i).length).toBeGreaterThan(0))
  })

  it('follows a celebrity on click', async () => {
    getCelebritySuggestions.mockResolvedValue({ items: suggestions })
    followCelebrity.mockResolvedValue(undefined)
    render(<CelebritiesStep onContinue={vi.fn()} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText('Jane Doe')[0])

    await waitFor(() => expect(followCelebrity).toHaveBeenCalledWith('p1'))
  })

  it('ignores a second click on the same person while the first toggle is still in flight — same race WatchedStep had', async () => {
    getCelebritySuggestions.mockResolvedValue({ items: suggestions })
    let resolveFollow!: () => void
    followCelebrity.mockReturnValue(new Promise<void>((resolve) => { resolveFollow = resolve }))
    render(<CelebritiesStep onContinue={vi.fn()} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText('Jane Doe')[0])
    await waitFor(() => expect(followCelebrity).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getAllByText('Jane Doe')[0])
    expect(unfollowCelebrity).not.toHaveBeenCalled()
    expect(followCelebrity).toHaveBeenCalledTimes(1)

    resolveFollow()
  })

  it('calls onContinue/onSkip directly', async () => {
    getCelebritySuggestions.mockResolvedValue({ items: [] })
    const onContinue = vi.fn()
    render(<CelebritiesStep onContinue={onContinue} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText(/no suggestions/i).length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByRole('button', { name: /^continue$/i })[0])
    expect(onContinue).toHaveBeenCalled()
  })

  it('pre-follows people from initialFollowedIds when the step is revisited', async () => {
    getCelebritySuggestions.mockResolvedValue({ items: suggestions })
    render(<CelebritiesStep initialFollowedIds={['p1']} onContinue={vi.fn()} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0))
    expect(screen.getAllByRole('button', { name: /jane doe/i })[0]).toHaveAttribute('aria-pressed', 'true')
  })

  it('auto-continues to genre/language suggestions when watch-history page 1 is empty', async () => {
    getCelebritySuggestions
      .mockResolvedValueOnce({ items: [], nextCursor: '1' })
      .mockResolvedValueOnce({ items: [{ personId: 'p9', name: 'Discovered Person', photo: null, appearsIn: 1 }], nextCursor: null })
    render(<CelebritiesStep onContinue={vi.fn()} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText('Discovered Person').length).toBeGreaterThan(0))
    expect(getCelebritySuggestions).toHaveBeenCalledWith([], [], null)
    expect(getCelebritySuggestions).toHaveBeenCalledWith([], [], '1')
  })

  it('loads more suggestions when scrolled near the bottom, appending rather than replacing', async () => {
    getCelebritySuggestions
      .mockResolvedValueOnce({ items: suggestions, nextCursor: '1' })
      .mockResolvedValueOnce({ items: [{ personId: 'p9', name: 'Discovered Person', photo: null, appearsIn: 1 }], nextCursor: null })
    render(<CelebritiesStep genres={['Drama']} onContinue={vi.fn()} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0))

    // The grid scrolls with the page itself, not a nested box — stub the
    // window/document metrics a real near-bottom scroll would report.
    Object.defineProperty(window, 'scrollY', { value: 1000, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 200, configurable: true })
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 1100, configurable: true })
    fireEvent.scroll(window)

    await waitFor(() => expect(getCelebritySuggestions).toHaveBeenCalledWith(['Drama'], [], '1'))
    await waitFor(() => expect(screen.getAllByText('Discovered Person').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0)
  })

  it('searches for a person beyond the suggestion list and can follow them too', async () => {
    getCelebritySuggestions.mockResolvedValue({ items: suggestions })
    searchPeople.mockResolvedValue({ items: [{ personId: 'p9', name: 'Searched Person', photo: null }] })
    followCelebrity.mockResolvedValue(undefined)
    render(<CelebritiesStep onContinue={vi.fn()} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0))
    fireEvent.change(screen.getAllByLabelText(/search for a person/i)[0], { target: { value: 'searched' } })

    // The component's own debounce (1000ms) is right at waitFor's default
    // timeout — give it real headroom instead of racing it.
    await waitFor(() => expect(searchPeople).toHaveBeenCalledWith('searched'), { timeout: 2000 })
    await waitFor(() => expect(screen.getAllByText('Searched Person').length).toBeGreaterThan(0))
    // The suggestion grid is replaced while searching, not shown alongside it.
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByText('Searched Person')[0])
    await waitFor(() => expect(followCelebrity).toHaveBeenCalledWith('p9'))
  })
})
