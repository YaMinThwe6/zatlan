import { useCallback, useEffect, useRef, useState } from 'react'
import { getWatchedCandidates, type MovieCandidate } from '../services/onboardingApi'
import { markWatched, unmarkWatched, likeMovie, unlikeMovie, searchMovies, type MovieSummary } from '../../movie/services/movieApi'
import { posterUrl } from '../../../lib/images'
import { OnboardingShell } from './OnboardingShell'
import { useInfinitePages } from '../useInfinitePages'

interface Props {
  genres: string[]
  languages: string[]
  initialWatched?: MovieCandidate[]
  onContinue: (watched: MovieCandidate[]) => void
  onSkip: (watched: MovieCandidate[]) => void
  onBack?: (watched: MovieCandidate[]) => void
}

// Matches MovieSearch.tsx's own search-as-you-type pacing — a real API call
// (movies.service.ts's local-index+TMDB merge), not a cheap local read.
const DEBOUNCE_MS = 1000
const MIN_QUERY_LENGTH = 2

// A search result (MovieSummary) is missing the fields a candidate carries
// (genres/originalLanguage/voteAverage — /onboarding/watched-candidates
// returns those, plain search doesn't) — defaulted here so a movie found
// via search can still be marked watched and included in onContinue's
// payload just like a suggested candidate. voteAverage defaults to 0
// (greeting.ts's "pick the highest-rated watched movie" only degrades if
// every watched movie came from search, never breaks).
function toCandidate(movie: MovieCandidate | MovieSummary): MovieCandidate {
  if ('voteAverage' in movie) return movie
  return { ...movie, genres: [], originalLanguage: null, voteAverage: 0 }
}

export function WatchedStep({ genres, languages, initialWatched, onContinue, onSkip, onBack }: Props) {
  // fetchPage's identity is stable for this step's whole lifetime — genres/
  // languages are the prior steps' already-final selections — so
  // useInfinitePages' mount-once effect never goes stale.
  const fetchPage = useCallback((cursor: string | null) => getWatchedCandidates(genres, languages, cursor), [genres, languages])
  const {
    items: candidates,
    loading,
    loadingMore,
    error: loadError,
    hasMore,
    loadMore
  } = useInfinitePages(fetchPage, (m: MovieCandidate) => m.movieId)
  const [error, setError] = useState('')

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MovieSummary[]>([])
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keyed by movieId, valued with the full candidate shape — not just a
  // Set<movieId> — so a movie marked watched from search results (which
  // aren't in `candidates`) still has something real to hand back via
  // onContinue, not just an id with nothing behind it.
  // Seeded from the wizard's own state (already-toggled movies persisted
  // server-side via markWatched) so re-visiting this step — Back from
  // Celebrities, or forward again after Skip — shows the same checkmarks
  // instead of starting blank.
  const [watchedMovies, setWatchedMovies] = useState<Map<string, MovieCandidate>>(
    () => new Map((initialWatched ?? []).map((m) => [m.movieId, m]))
  )

  // Guards toggle() against a rapid second click on the same movie before its
  // first mark/unmark request pair has resolved — real bug: without this, the
  // second click reads the just-optimistically-updated state and fires the
  // OPPOSITE request pair, racing the first with no ordering guarantee. Which
  // pair the server processes last decides the real backend state, but the UI
  // only reflects whichever toggle() call's own promise settles last — not
  // necessarily the same one — so the checkmark could end up disagreeing with
  // what's actually saved. Only reproduced on a fast double-click/tap on the
  // same card, hence "sometimes, rarely, not always".
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([])
      setSearchStatus('idle')
      return
    }
    debounceTimerRef.current = setTimeout(() => {
      setSearchStatus('loading')
      searchMovies(trimmed)
        .then((res) => {
          setResults(res.items)
          setSearchStatus('idle')
        })
        .catch(() => setSearchStatus('error'))
    }, DEBOUNCE_MS)
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [query])

  async function toggle(movie: MovieCandidate | MovieSummary) {
    const full = toCandidate(movie)
    if (pendingIds.has(full.movieId)) return // a toggle for this movie is already in flight — ignore the extra click rather than race it

    const wasWatched = watchedMovies.has(full.movieId)
    setPendingIds((prev) => new Set(prev).add(full.movieId))
    setWatchedMovies((prev) => {
      const next = new Map(prev)
      if (wasWatched) next.delete(full.movieId)
      else next.set(full.movieId, full)
      return next
    })
    try {
      // This step doubles as "liked" too, not just "watched" — a movie
      // picked here goes on both lists together, not just watched with no
      // opinion attached.
      if (wasWatched) await Promise.all([unmarkWatched(full.movieId), unlikeMovie(full.movieId)])
      else await Promise.all([markWatched(full.movieId), likeMovie(full.movieId)])
    } catch (err) {
      // roll back the optimistic toggle on failure
      setWatchedMovies((prev) => {
        const next = new Map(prev)
        if (wasWatched) next.set(full.movieId, full)
        else next.delete(full.movieId)
        return next
      })
      setError(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(full.movieId)
        return next
      })
    }
  }

  const isSearching = query.trim().length >= MIN_QUERY_LENGTH
  const displayed: (MovieCandidate | MovieSummary)[] = isSearching ? results : candidates

  // Listens on the page itself (not a nested scroll box — a separate inner
  // scroll region is easy to miss entirely, since nobody expects a form to
  // have its own hidden scrollbar) so scrolling normally is what grows the
  // grid. Search results aren't paginated (movieApi's searchMovies has no
  // cursor), so this is suppressed while searching.
  useEffect(() => {
    if (isSearching) return
    function onScroll() {
      const nearBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 300
      if (nearBottom) loadMore()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [isSearching, loadMore])

  return (
    <OnboardingShell
      step={4}
      // Wrapped so Back reports the current selection too, not just
      // Continue/Skip — otherwise clicking Back without confirming first
      // loses whatever was toggled on this visit.
      onBack={onBack ? () => onBack([...watchedMovies.values()]) : undefined}
      desktopTitle="Every rating starts somewhere."
      desktopSubtitle="Tell us what you've already seen and we'll start building your taste profile from day one."
    >
      <div className="flex flex-1 flex-col px-7 pt-8 pb-8">
        <h1 className="font-serif text-[26px] font-semibold text-white">Movies you&rsquo;ve watched and liked</h1>
        <p className="mt-2 mb-5 text-[13.5px] text-text-muted">This helps us build your taste profile (optional)</p>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a movie…"
          aria-label="Search for a movie"
          className="mb-4 rounded-xl border border-border bg-surface-alt px-4 py-3 text-sm text-text outline-none focus:border-accent"
        />

        {loading && !isSearching && <p className="text-sm text-text-muted">Loading…</p>}
        {isSearching && searchStatus === 'loading' && <p className="text-sm text-text-muted">Searching…</p>}
        {isSearching && searchStatus === 'error' && <p role="alert" className="text-sm text-red-400">Search failed</p>}
        {isSearching && searchStatus === 'idle' && results.length === 0 && (
          <p className="text-sm text-text-muted">No results for &ldquo;{query.trim()}&rdquo;.</p>
        )}
        {(error || loadError) && (
          <p role="alert" className="mb-4 text-[13px] text-red-400">
            {error || loadError}
          </p>
        )}

        <ul className="grid grid-cols-3 gap-3">
          {displayed.map((movie) => {
            const isWatched = watchedMovies.has(movie.movieId)
            const isPending = pendingIds.has(movie.movieId)
            const poster = posterUrl(movie.poster)
            return (
              <li key={movie.movieId}>
                <button
                  type="button"
                  aria-pressed={isWatched}
                  aria-busy={isPending}
                  disabled={isPending}
                  onClick={() => toggle(movie)}
                  className={`block w-full text-left ${isPending ? 'opacity-60' : ''}`}
                >
                  <div
                    className={`relative aspect-[2/3] w-full overflow-hidden rounded-[10px] bg-surface-alt ${isWatched ? 'border-2 border-accent' : 'border border-border'}`}
                  >
                    {poster ? (
                      <img src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-text-faint">No poster</div>
                    )}
                    {isWatched && (
                      <span className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0E0D10" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 text-center text-[10.5px] text-text-secondary">
                    {movie.title} {movie.year ? `(${movie.year})` : ''}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
        {!isSearching && loadingMore && <p className="mt-3 text-center text-[11.5px] text-text-muted">Loading more…</p>}
        {!isSearching && !loading && !loadingMore && hasMore && (
          <button type="button" onClick={loadMore} className="mt-3 block w-full text-center text-[11.5px] font-semibold text-accent">
            Load more
          </button>
        )}

        {/* Extra breathing room so the sticky footer below never overlaps
            the last row of the grid, however tall it's grown. */}
        <div className="h-8" />
      </div>

      {/* Sticky to the viewport bottom, not just placed at the end of the
          content — the grid can grow indefinitely now (infinite scroll), so
          a Continue button that simply sits after it would end up scrolled
          far out of reach instead of staying reachable at all times. */}
      <div className="sticky bottom-0 border-t border-border-soft bg-bg/95 px-7 pt-4 pb-6 backdrop-blur-sm">
        <p className="mb-3 text-center text-[11.5px] text-text-muted">{watchedMovies.size} selected</p>
        <button
          type="button"
          onClick={() => onContinue([...watchedMovies.values()])}
          className="flex w-full items-center justify-center rounded-xl bg-accent py-3.5 text-sm font-bold text-bg"
        >
          Continue
        </button>
        <button
          type="button"
          onClick={() => onSkip([...watchedMovies.values()])}
          className="mt-4 block w-full text-center text-[13px] font-semibold text-text-muted"
        >
          Skip for now
        </button>
      </div>
    </OnboardingShell>
  )
}
