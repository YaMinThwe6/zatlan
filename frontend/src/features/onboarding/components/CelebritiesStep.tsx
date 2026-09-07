import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getCelebritySuggestions,
  followCelebrity,
  unfollowCelebrity,
  searchPeople,
  type CelebritySuggestion,
  type PersonSummary
} from '../services/onboardingApi'
import { OnboardingShell } from './OnboardingShell'
import { posterUrl } from '../../../lib/images'
import { useInfinitePages } from '../useInfinitePages'

interface Props {
  genres?: string[]
  languages?: string[]
  initialFollowedIds?: string[]
  onContinue: (followedIds: string[]) => void
  onSkip: (followedIds: string[]) => void
  onBack?: (followedIds: string[]) => void
}

// Matches WatchedStep.tsx's own search-as-you-type pacing.
const DEBOUNCE_MS = 1000
const MIN_QUERY_LENGTH = 2

export function CelebritiesStep({ genres = [], languages = [], initialFollowedIds, onContinue, onSkip, onBack }: Props) {
  // Page 1 ranks the caller's own watch history; every page after that falls
  // through to genre/language-based Discovery (onboarding.service.ts) — so
  // this keeps growing on scroll, and isn't a dead end when watch history is
  // thin or empty (Watched is skippable, and used to leave this step with
  // nothing to show at all in that case).
  const fetchPage = useCallback((cursor: string | null) => getCelebritySuggestions(genres, languages, cursor), [genres, languages])
  const {
    items: suggestions,
    loading,
    loadingMore,
    error: loadError,
    hasMore,
    loadMore
  } = useInfinitePages(fetchPage, (p: CelebritySuggestion) => p.personId)
  // Seeded from the wizard's own state (already-followed people persisted
  // server-side via followCelebrity) so re-visiting this step shows the
  // same followed state instead of starting blank.
  const [followedIds, setFollowedIds] = useState<Set<string>>(() => new Set(initialFollowedIds ?? []))
  const [error, setError] = useState('')
  // Same race as WatchedStep.tsx's toggle() had — guards against a rapid
  // second click on the same person before the first follow/unfollow request
  // has resolved, which otherwise fires the opposite call and races it.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PersonSummary[]>([])
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      searchPeople(trimmed)
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

  async function toggle(personId: string) {
    if (pendingIds.has(personId)) return // a toggle for this person is already in flight — ignore the extra click rather than race it

    const wasFollowed = followedIds.has(personId)
    setPendingIds((prev) => new Set(prev).add(personId))
    setFollowedIds((prev) => {
      const next = new Set(prev)
      if (wasFollowed) next.delete(personId)
      else next.add(personId)
      return next
    })
    try {
      if (wasFollowed) await unfollowCelebrity(personId)
      else await followCelebrity(personId)
    } catch (err) {
      // roll back the optimistic toggle on failure
      setFollowedIds((prev) => {
        const next = new Set(prev)
        if (wasFollowed) next.add(personId)
        else next.delete(personId)
        return next
      })
      setError(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(personId)
        return next
      })
    }
  }

  const isSearching = query.trim().length >= MIN_QUERY_LENGTH
  const displayed: (CelebritySuggestion | PersonSummary)[] = isSearching ? results : suggestions

  // Listens on the page itself (not a nested scroll box — a separate inner
  // scroll region is easy to miss entirely, since nobody expects a form to
  // have its own hidden scrollbar) so scrolling normally is what grows the
  // grid. Search results aren't paginated (onboardingApi's searchPeople has
  // no cursor), so this is suppressed while searching.
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
      step={5}
      // Wrapped so Back reports the current selection too, not just
      // Continue/Skip — otherwise clicking Back without confirming first
      // loses whatever was toggled on this visit.
      onBack={onBack ? () => onBack([...followedIds]) : undefined}
      desktopTitle="Follow the people behind the films."
      desktopSubtitle="Actors and directors you follow show up first when they're in something new."
    >
      <div className="flex flex-1 flex-col px-7 pt-8 pb-8">
        <h1 className="font-serif text-[26px] font-semibold text-white">Follow celebrities</h1>
        <p className="mt-2 mb-5 text-[13.5px] text-text-muted">
          Based on what you&rsquo;ve watched — actors, directors, and crew alike (optional)
        </p>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a person…"
          aria-label="Search for a person"
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
        {!loading && !isSearching && suggestions.length === 0 && (
          <p className="text-sm text-text-muted">No suggestions yet — you can follow people from their pages later.</p>
        )}

        <ul className="grid grid-cols-3 gap-x-3 gap-y-5">
          {displayed.map((person) => {
            const isFollowed = followedIds.has(person.personId)
            const isPending = pendingIds.has(person.personId)
            const photo = posterUrl(person.photo, 'w185')
            return (
              <li key={person.personId}>
                <button
                  type="button"
                  aria-pressed={isFollowed}
                  aria-busy={isPending}
                  disabled={isPending}
                  onClick={() => toggle(person.personId)}
                  className={`flex w-full flex-col items-center ${isPending ? 'opacity-60' : ''}`}
                >
                  <div
                    className={`relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-surface-alt ${isFollowed ? 'border-2 border-accent' : 'border border-border'}`}
                  >
                    {photo ? (
                      <img src={photo} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-lg font-semibold text-text-faint">{person.name.charAt(0)}</span>
                    )}
                    {isFollowed && (
                      <span className="absolute right-0 bottom-0 flex h-5 w-5 items-center justify-center rounded-full bg-accent">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0E0D10" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-center text-[11.5px] font-medium text-text-secondary">{person.name}</div>
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
        <button
          type="button"
          onClick={() => onContinue([...followedIds])}
          className="flex w-full items-center justify-center rounded-xl bg-accent py-3.5 text-sm font-bold text-bg"
        >
          Continue
        </button>
        <button
          type="button"
          onClick={() => onSkip([...followedIds])}
          className="mt-4 block w-full text-center text-[13px] font-semibold text-text-muted"
        >
          Skip for now
        </button>
      </div>
    </OnboardingShell>
  )
}
