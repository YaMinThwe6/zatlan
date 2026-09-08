import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const getWatchedCandidates = vi.fn()
const markWatched = vi.fn()
const unmarkWatched = vi.fn()
const likeMovie = vi.fn()
const unlikeMovie = vi.fn()
const searchMovies = vi.fn()

vi.mock('../../../../src/features/onboarding/services/onboardingApi', () => ({ getWatchedCandidates }))
vi.mock('../../../../src/features/movie/services/movieApi', () => ({ markWatched, unmarkWatched, likeMovie, unlikeMovie, searchMovies }))

const { WatchedStep } = await import('../../../../src/features/onboarding/components/WatchedStep')

const candidates = [
  { movieId: 'm1', title: 'Movie One', poster: null, year: 2020, genres: ['Drama'], voteAverage: 7 },
  { movieId: 'm2', title: 'Movie Two', poster: null, year: 2021, genres: ['Comedy'], voteAverage: 8 }
]

afterEach(() => {
  getWatchedCandidates.mockReset()
  markWatched.mockReset()
  unmarkWatched.mockReset()
  likeMovie.mockReset()
  unlikeMovie.mockReset()
  searchMovies.mockReset()
})

// OnboardingShell renders its children twice — a mobile copy and a desktop
// copy, CSS-toggled per breakpoint (same pattern as Welcome.tsx) — so every
// query here picks [0].
describe('WatchedStep', () => {
  it('fetches candidates filtered by the chosen genres/languages', async () => {
    getWatchedCandidates.mockResolvedValue({ items: candidates })
    render(<WatchedStep genres={['Drama']} languages={['en']} onContinue={vi.fn()} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText(/Movie One/).length).toBeGreaterThan(0))
    expect(getWatchedCandidates).toHaveBeenCalledWith(['Drama'], ['en'], null)
  })

  it('optimistically marks watched and liked, calling markWatched and likeMovie', async () => {
    getWatchedCandidates.mockResolvedValue({ items: candidates })
    markWatched.mockResolvedValue(undefined)
    likeMovie.mockResolvedValue(undefined)
    render(<WatchedStep genres={[]} languages={[]} onContinue={vi.fn()} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText(/Movie One/).length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText(/Movie One/)[0])

    await waitFor(() => expect(markWatched).toHaveBeenCalledWith('m1'))
    expect(likeMovie).toHaveBeenCalledWith('m1')
    expect(screen.getAllByText('1 selected').length).toBeGreaterThan(0)
  })

  it('unliking follows unmarking watched on a second click', async () => {
    getWatchedCandidates.mockResolvedValue({ items: candidates })
    markWatched.mockResolvedValue(undefined)
    likeMovie.mockResolvedValue(undefined)
    unmarkWatched.mockResolvedValue(undefined)
    unlikeMovie.mockResolvedValue(undefined)
    render(<WatchedStep genres={[]} languages={[]} onContinue={vi.fn()} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText(/Movie One/).length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText(/Movie One/)[0])
    await waitFor(() => expect(markWatched).toHaveBeenCalledWith('m1'))

    fireEvent.click(screen.getAllByText(/Movie One/)[0])
    await waitFor(() => expect(unmarkWatched).toHaveBeenCalledWith('m1'))
    expect(unlikeMovie).toHaveBeenCalledWith('m1')
  })

  it('ignores a second click on the same movie while the first toggle is still in flight — real bug: rapid double-clicks raced two conflicting request pairs and could leave the checkmark disagreeing with the backend', async () => {
    getWatchedCandidates.mockResolvedValue({ items: candidates })
    let resolveMark!: () => void
    markWatched.mockReturnValue(new Promise<void>((resolve) => { resolveMark = resolve }))
    likeMovie.mockResolvedValue(undefined)
    render(<WatchedStep genres={[]} languages={[]} onContinue={vi.fn()} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText(/Movie One/).length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText(/Movie One/)[0])
    await waitFor(() => expect(markWatched).toHaveBeenCalledTimes(1))

    // Second click on the same movie while markWatched('m1') is still
    // pending — must be ignored, not fire an overlapping unmark/unlike pair.
    fireEvent.click(screen.getAllByText(/Movie One/)[0])
    expect(unmarkWatched).not.toHaveBeenCalled()
    expect(markWatched).toHaveBeenCalledTimes(1)

    resolveMark()
    await waitFor(() => expect(screen.getAllByText('1 selected').length).toBeGreaterThan(0))
  })

  it('rolls back the toggle when markWatched fails', async () => {
    getWatchedCandidates.mockResolvedValue({ items: candidates })
    markWatched.mockRejectedValue(new Error('nope'))
    render(<WatchedStep genres={[]} languages={[]} onContinue={vi.fn()} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText(/Movie One/).length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText(/Movie One/)[0])

    await waitFor(() => expect(screen.getAllByRole('alert')[0]).toHaveTextContent('nope'))
    expect(screen.getAllByText('0 selected').length).toBeGreaterThan(0)
  })

  it('passes only the watched movies to onContinue', async () => {
    getWatchedCandidates.mockResolvedValue({ items: candidates })
    markWatched.mockResolvedValue(undefined)
    likeMovie.mockResolvedValue(undefined)
    const onContinue = vi.fn()
    render(<WatchedStep genres={[]} languages={[]} onContinue={onContinue} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText(/Movie One/).length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText(/Movie One/)[0])
    await waitFor(() => expect(markWatched).toHaveBeenCalled())

    fireEvent.click(screen.getAllByRole('button', { name: /^continue$/i })[0])
    expect(onContinue).toHaveBeenCalledWith([candidates[0]])
  })

  it('pre-checks movies from initialWatched when the step is revisited', async () => {
    getWatchedCandidates.mockResolvedValue({ items: candidates })
    render(
      <WatchedStep genres={[]} languages={[]} initialWatched={[candidates[0]]} onContinue={vi.fn()} onSkip={vi.fn()} />
    )

    await waitFor(() => expect(screen.getAllByText('1 selected').length).toBeGreaterThan(0))
  })

  it('loads more candidates when scrolled near the bottom, appending rather than replacing', async () => {
    getWatchedCandidates
      .mockResolvedValueOnce({ items: candidates, nextCursor: '2' })
      .mockResolvedValueOnce({
        items: [{ movieId: 'm3', title: 'Movie Three', poster: null, year: 2022, genres: [], voteAverage: 6 }],
        nextCursor: null
      })
    render(<WatchedStep genres={[]} languages={[]} onContinue={vi.fn()} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText(/Movie One/).length).toBeGreaterThan(0))

    // The grid scrolls with the page itself, not a nested box — stub the
    // window/document metrics a real near-bottom scroll would report.
    Object.defineProperty(window, 'scrollY', { value: 1000, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 200, configurable: true })
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 1100, configurable: true })
    fireEvent.scroll(window)

    await waitFor(() => expect(getWatchedCandidates).toHaveBeenCalledWith([], [], '2'))
    await waitFor(() => expect(screen.getAllByText(/Movie Three/).length).toBeGreaterThan(0))
    // Original candidates are still there too — appended, not replaced.
    expect(screen.getAllByText(/Movie One/).length).toBeGreaterThan(0)
  })

  it('searches for a movie beyond the candidate list and can mark it watched too', async () => {
    getWatchedCandidates.mockResolvedValue({ items: candidates })
    searchMovies.mockResolvedValue({ items: [{ movieId: 'm9', title: 'Searched Movie', poster: null, year: 2019 }] })
    markWatched.mockResolvedValue(undefined)
    likeMovie.mockResolvedValue(undefined)
    const onContinue = vi.fn()
    render(<WatchedStep genres={[]} languages={[]} onContinue={onContinue} onSkip={vi.fn()} />)

    await waitFor(() => expect(screen.getAllByText(/Movie One/).length).toBeGreaterThan(0))
    fireEvent.change(screen.getAllByLabelText(/search for a movie/i)[0], { target: { value: 'searched' } })

    // The component's own debounce (1000ms) is right at waitFor's default
    // timeout — give it real headroom instead of racing it.
    await waitFor(() => expect(searchMovies).toHaveBeenCalledWith('searched'), { timeout: 2000 })
    await waitFor(() => expect(screen.getAllByText(/Searched Movie/).length).toBeGreaterThan(0))
    // The candidate grid is replaced while searching, not shown alongside it.
    expect(screen.queryByText(/Movie One/)).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByText(/Searched Movie/)[0])
    await waitFor(() => expect(markWatched).toHaveBeenCalledWith('m9'))

    fireEvent.click(screen.getAllByRole('button', { name: /^continue$/i })[0])
    expect(onContinue).toHaveBeenCalledWith([{ movieId: 'm9', title: 'Searched Movie', poster: null, year: 2019, genres: [], originalLanguage: null, voteAverage: 0 }])
  })
})
