import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  searchMovies,
  getRecentMovies,
  discoverMovies,
  getMovieStatuses,
  type MovieSummary,
  type MovieStatusLite
} from '../services/movieApi'
import { posterUrl } from '../../../lib/images'
import { useAuth } from '../../../lib/AuthContext'
import { Sidebar } from '../../../components/Sidebar'
import { AppHeader } from '../../../components/AppHeader'
import { MobileTabBar } from '../../../components/MobileTabBar'
import { matchFacet, type FacetMatch } from '../genreLanguageMatch'
import { DiscoverPeopleTeaser } from './DiscoverPeopleTeaser'
import { DiscoverEventsTeaser } from './DiscoverEventsTeaser'

// Every search now hits live TMDB (movies.service.ts's local-index+TMDB
// merge, hld.md §18) rather than only ever reading a local Firestore index —
// a real external API call, not a cheap local read, so this fires on a full
// pause rather than a quick typing lull.
const DEBOUNCE_MS = 1000
const MIN_QUERY_LENGTH = 2 // below this, a query is mostly noise against a broad catalog

function StatusBadge({ status }: { status?: MovieStatusLite }) {
  if (!status) return null
  const label = status.watched ? 'Watched' : status.watchlisted ? 'Watchlist' : null
  if (!label && !status.liked) return null
  return (
    <div className="pointer-events-none absolute inset-x-1.5 top-1.5 flex items-start justify-between">
      {label ? (
        <span className="rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
          {status.watched ? '✓ ' : '+ '}
          {label}
        </span>
      ) : (
        <span />
      )}
      {status.liked && (
        <span className="rounded-md bg-black/75 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm" aria-label="Liked">
          ♥
        </span>
      )}
    </div>
  )
}

function MovieCard({ movie, status, onOpen }: { movie: MovieSummary; status?: MovieStatusLite; onOpen: () => void }) {
  const poster = posterUrl(movie.poster)
  return (
    <li>
      <button type="button" onClick={onOpen} className="w-full cursor-pointer overflow-hidden rounded-xl border border-border bg-surface text-left">
        <div className="relative aspect-[2/3] w-full bg-surface-alt">
          {poster ? (
            <img src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[11px] text-text-faint">No poster</div>
          )}
          <StatusBadge status={status} />
        </div>
        <div className="p-3">
          <div className="text-[13px] font-semibold text-text">{movie.title}</div>
          {movie.year && <div className="mt-0.5 text-[11.5px] text-text-muted">({movie.year})</div>}
        </div>
      </button>
    </li>
  )
}

function PosterSkeletonGrid({ count = 10 }: { count?: number }) {
  return (
    <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i}>
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="aspect-[2/3] w-full animate-pulse bg-surface-alt" />
            <div className="space-y-2 p-3">
              <div className="h-2.5 w-3/4 animate-pulse rounded-full bg-surface-alt" />
              <div className="h-2 w-2/5 animate-pulse rounded-full bg-surface-alt" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

// Reached at "/" for a signed-out visitor (public Discover, hld.md §3) or at
// "/search" for a signed-in one. Signed-in, it sits inside the same app shell
// as Home (Sidebar + MobileTabBar); guest, it keeps the standalone Discover
// header and the sign-up teasers. Search itself — the box, the results grid,
// the "Browse Korean films" facet chip — is shared between the two.
export function MovieSearch() {
  const navigate = useNavigate()
  const { user, signOutUser } = useAuth()
  const isGuest = !user
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MovieSummary[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  // "Recently released" — the default, browse-without-a-query view (api-contracts.md
  // §1's GET /movies/recent), shown below the search bar until the caller actually
  // searches for something.
  const [recent, setRecent] = useState<MovieSummary[]>([])
  const [recentStatus, setRecentStatus] = useState<'loading' | 'idle' | 'error'>('loading')

  // The caller's watchlist/watched/liked relationship to whatever movies are
  // currently on screen — signed-in only, one batch request per visible set,
  // merged in so a movie already looked up isn't re-fetched.
  const [statusMap, setStatusMap] = useState<Record<string, MovieStatusLite>>({})

  // Browse-by-facet: null = normal search/recent view; set = the discover grid
  // for a genre or language the query named (and the user tapped the chip for).
  const [browseFacet, setBrowseFacet] = useState<FacetMatch | null>(null)
  const [browseItems, setBrowseItems] = useState<MovieSummary[]>([])
  const [browsePage, setBrowsePage] = useState(0)
  const [browseTotalPages, setBrowseTotalPages] = useState(0)
  const [browseStatus, setBrowseStatus] = useState<'idle' | 'loading' | 'loadingMore' | 'error'>('idle')

  useEffect(() => {
    getRecentMovies()
      .then((res) => {
        setRecent(res.items)
        setRecentStatus('idle')
      })
      .catch(() => setRecentStatus('error')) // non-critical section — fails quietly, search still works
  }, [])

  // Bumped on every search kickoff so a slow, superseded response can't
  // overwrite a newer one that already came back — a real risk once search
  // fires per keystroke instead of once per submit.
  const requestIdRef = useRef(0)

  async function runSearch(q: string) {
    const trimmed = q.trim()
    if (!trimmed) return
    const thisRequestId = ++requestIdRef.current
    setStatus('loading')
    try {
      const { items } = await searchMovies(trimmed)
      if (requestIdRef.current !== thisRequestId) return // a newer search already superseded this one
      setResults(items)
      setHasSearched(true)
      setStatus('idle')
    } catch (err) {
      if (requestIdRef.current !== thisRequestId) return
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : 'Search failed')
    }
  }

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Search-as-you-type, debounced. (Editing the query also drops out of any
  // facet-browse view — handled in the input's onChange, not here, so the
  // reset stays out of an effect body.)
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)

    const trimmed = query.trim()
    if (trimmed.length === 0) {
      requestIdRef.current++ // invalidate any in-flight search — its result should never land now
      setHasSearched(false)
      setResults([])
      setStatus('idle')
      return
    }
    if (trimmed.length < MIN_QUERY_LENGTH) return

    debounceTimerRef.current = setTimeout(() => {
      void runSearch(trimmed)
    }, DEBOUNCE_MS)
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [query])

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    // An explicit submit (Enter/Search button) shouldn't leave a debounced
    // call still pending to fire again a moment later.
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    await runSearch(query)
  }

  // A genre/language the current query names — drives the "Browse …" chip.
  const facet = useMemo(() => matchFacet(query), [query])

  async function loadBrowse(target: FacetMatch, page: number) {
    setBrowseStatus(page <= 1 ? 'loading' : 'loadingMore')
    try {
      const res = await discoverMovies({
        genre: target.kind === 'genre' ? target.value : null,
        language: target.kind === 'language' ? target.value : null,
        page
      })
      // TMDB's discover paging can repeat a title — across consecutive pages
      // as popularity shifts, and occasionally within one page — so dedupe by
      // movieId on merge to keep React keys unique.
      setBrowseItems((prev) => {
        const merged = page <= 1 ? [] : [...prev]
        const seen = new Set(merged.map((m) => m.movieId))
        for (const m of res.items) {
          if (seen.has(m.movieId)) continue
          seen.add(m.movieId)
          merged.push(m)
        }
        return merged
      })
      setBrowsePage(res.page)
      setBrowseTotalPages(res.totalPages)
      setBrowseStatus('idle')
    } catch {
      setBrowseStatus('error')
    }
  }

  function startBrowse(target: FacetMatch) {
    setBrowseFacet(target)
    setBrowseItems([])
    setBrowsePage(0)
    setBrowseTotalPages(0)
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    requestIdRef.current++ // don't let a pending text search land on top of the browse view
    void loadBrowse(target, 1)
  }

  function exitBrowse() {
    setBrowseFacet(null)
    setQuery('')
  }

  // Which movies are on screen right now, for the badge lookup.
  const visibleMovies = browseFacet ? browseItems : hasSearched ? results : recent
  const visibleIds = visibleMovies.map((m) => m.movieId).join(',')

  useEffect(() => {
    if (isGuest || !visibleIds) return
    const missing = visibleIds.split(',').filter((id) => !(id in statusMap))
    if (missing.length === 0) return
    getMovieStatuses(missing)
      .then((res) => setStatusMap((prev) => ({ ...prev, ...res.items })))
      .catch(() => {}) // badges are additive polish — a failure just leaves cards unbadged
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIds, isGuest])

  const resultNoun = results.length === 1 ? 'result' : 'results'

  const searchPanel = (
    <>
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setBrowseFacet(null) // editing the query leaves any facet-browse view
          }}
          placeholder="Search movies, genres, languages…"
          aria-label="Search for a movie"
          className="flex-1 rounded-xl border border-border bg-surface-alt px-4 py-3 text-sm text-text outline-none focus:border-accent"
        />
        <button type="submit" className="cursor-pointer rounded-xl bg-accent px-5 py-3 text-sm font-bold text-bg">
          Search
        </button>
      </form>

      {facet && !browseFacet && status !== 'loading' && (
        <button
          type="button"
          onClick={() => startBrowse(facet)}
          className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-accent/60 bg-[rgba(var(--accent-rgb),0.1)] px-3.5 py-1.5 text-[12.5px] font-semibold text-accent"
        >
          {facet.chipLabel}
          <span aria-hidden="true">→</span>
        </button>
      )}

      {status === 'error' && (
        <p role="alert" className="mt-6 text-sm text-red-400">
          {errorMessage}
        </p>
      )}

      {browseFacet ? (
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-text">{browseFacet.headingLabel}</h2>
            <button type="button" onClick={exitBrowse} className="cursor-pointer text-[12.5px] font-semibold text-text-muted">
              ← Back to search
            </button>
          </div>

          {browseStatus === 'loading' && <PosterSkeletonGrid />}
          {browseStatus === 'error' && (
            <p role="alert" className="mt-6 text-sm text-red-400">
              Couldn't load {browseFacet.headingLabel} right now.
            </p>
          )}

          {browseItems.length > 0 && (
            <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {browseItems.map((movie) => (
                <MovieCard key={movie.movieId} movie={movie} status={statusMap[movie.movieId]} onOpen={() => navigate(`/movie/${movie.movieId}`)} />
              ))}
            </ul>
          )}

          {browseStatus === 'idle' && browseItems.length === 0 && (
            <p className="mt-8 text-center text-sm text-text-muted">Nothing to show for {browseFacet.headingLabel}.</p>
          )}

          {browsePage > 0 && browsePage < browseTotalPages && browseStatus !== 'loading' && (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => void loadBrowse(browseFacet, browsePage + 1)}
                disabled={browseStatus === 'loadingMore'}
                className="cursor-pointer rounded-xl border border-border bg-surface px-5 py-2.5 text-[13px] font-semibold text-text-secondary disabled:opacity-60"
              >
                {browseStatus === 'loadingMore' ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </section>
      ) : status === 'loading' ? (
        <PosterSkeletonGrid />
      ) : hasSearched ? (
        <>
          <p className="mt-6 text-[12.5px] text-text-muted">
            {results.length} {resultNoun} for “{query.trim()}”
          </p>
          {results.length === 0 ? (
            <p className="mt-8 text-center text-sm text-text-muted">No results for "{query}".</p>
          ) : (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {results.map((movie) => (
                <MovieCard key={movie.movieId} movie={movie} status={statusMap[movie.movieId]} onOpen={() => navigate(`/movie/${movie.movieId}`)} />
              ))}
            </ul>
          )}
        </>
      ) : (
        <section className="mt-8">
          <h2 className="text-[15px] font-semibold text-text">Recently released</h2>
          {recentStatus === 'loading' && <PosterSkeletonGrid />}
          {recentStatus === 'error' && <p className="mt-3 text-sm text-text-muted">Couldn't load recent releases right now.</p>}
          {recentStatus === 'idle' && recent.length === 0 && <p className="mt-3 text-sm text-text-muted">Nothing new to show right now.</p>}
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {recent.map((movie) => (
              <MovieCard key={movie.movieId} movie={movie} status={statusMap[movie.movieId]} onOpen={() => navigate(`/movie/${movie.movieId}`)} />
            ))}
          </ul>
        </section>
      )}
    </>
  )

  if (isGuest) {
    return (
      <main className="flex min-h-svh flex-1 flex-col bg-bg text-text">
        <header className="flex items-center justify-between border-b border-border-soft px-5 py-4">
          <span className="font-serif text-lg font-bold text-accent">BINJ</span>
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => navigate('/story')} className="cursor-pointer text-[13px] font-semibold text-text-secondary">
              Our Story
            </button>
            <button type="button" onClick={() => navigate('/get-started')} className="cursor-pointer rounded-lg bg-accent px-4 py-2 text-[13px] font-bold text-bg">
              Get Started
            </button>
          </div>
        </header>

        <div className="flex flex-1">
          <div className="mx-auto w-full max-w-3xl flex-1 px-5 py-6">
            <div className="mb-6">
              <h1 className="font-serif text-[26px] font-semibold text-white">Discover movies</h1>
              <p className="mt-1 text-[13.5px] text-text-muted">Search, browse, and see what BINJ's community thinks — sign in to rate, save, and connect.</p>
            </div>
            {searchPanel}
          </div>

          {/* Desktop-only, guest-only right rail — teases the signed-in-only
              People/Events features rather than leaving the wide desktop
              layout empty next to a narrow centered column. */}
          <aside className="hidden w-80 flex-none flex-col gap-7 border-l border-border-soft px-5.5 py-6 lg:flex">
            <DiscoverPeopleTeaser />
            <DiscoverEventsTeaser />
          </aside>
        </div>
      </main>
    )
  }

  return (
    // lg:h-svh (not just min-h-svh) so the inner lg:overflow-y-auto column has
    // a viewport-bounded parent to scroll within — otherwise the whole page
    // scrolls and takes the Sidebar with it. Same shared-shell fix as
    // Home/MovieDetail/Profile (docs/qa/profile-bugs.md #1); mobile keeps
    // min-h-svh and grows freely.
    <div className="flex min-h-svh bg-bg text-text lg:h-svh">
      <Sidebar active="search" />

      <main className="min-w-0 flex-1 pb-6 lg:flex lg:flex-col lg:pb-0">
        <AppHeader onSignOut={() => void signOutUser()} />
        <header className="flex items-center gap-3 border-b border-border-soft px-5 py-4 lg:hidden">
          <button type="button" onClick={() => navigate('/')} className="cursor-pointer text-sm font-semibold text-text-secondary">
            ← Home
          </button>
          <h1 className="text-[15px] font-bold text-text">Search</h1>
        </header>

        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-5 py-6 lg:px-7">{searchPanel}</div>
        </div>

        <MobileTabBar active="search" />
      </main>
    </div>
  )
}
