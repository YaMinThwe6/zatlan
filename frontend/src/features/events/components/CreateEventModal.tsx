import { useEffect, useState, type FormEvent } from 'react'
import { searchMovies, type MovieSummary } from '../../movie/services/movieApi'
import { createEvent } from '../../home/services/homeApi'
import { posterUrl } from '../../../lib/images'

interface Props {
  onClose: () => void
  onCreated: (eventId: string) => void
}

type LocationState = { status: 'idle' | 'locating' | 'captured' | 'error'; area: string; city: string; lat: number | null; lng: number | null }
const EMPTY_LOCATION: LocationState = { status: 'idle', area: '', city: '', lat: null, lng: null }

// Movie-first, then the same shape of form WatchTogether.tsx already uses on
// a movie's own detail page — this is the standalone entry point for someone
// starting from Events rather than from a movie they're already looking at.
export function CreateEventModal({ onClose, onCreated }: Props) {
  const [movie, setMovie] = useState<MovieSummary | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MovieSummary[]>([])
  const [searching, setSearching] = useState(false)

  const [datetime, setDatetime] = useState('')
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<'online' | 'in-person'>('online')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [participantLimit, setParticipantLimit] = useState(10)
  const [requiresApproval, setRequiresApproval] = useState(false)
  const [location, setLocation] = useState<LocationState>(EMPTY_LOCATION)
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(() => {
      searchMovies(query)
        .then((res) => {
          if (!cancelled) setResults(res.items)
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  function captureLocation() {
    if (!navigator.geolocation) {
      setLocation((prev) => ({ ...prev, status: 'error' }))
      return
    }
    setLocation((prev) => ({ ...prev, status: 'locating' }))
    navigator.geolocation.getCurrentPosition(
      (position) => setLocation((prev) => ({ ...prev, status: 'captured', lat: position.coords.latitude, lng: position.coords.longitude })),
      () => setLocation((prev) => ({ ...prev, status: 'error' }))
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!movie) return
    setFormError('')
    if (mode === 'in-person' && (location.lat === null || location.lng === null)) {
      setFormError('Location is required for an in-person watch party — use "Share my location" below.')
      return
    }
    if (mode === 'in-person' && (!location.area.trim() || !location.city.trim())) {
      setFormError('Area and city are required for an in-person watch party.')
      return
    }
    setSubmitting(true)
    try {
      const created = await createEvent({
        movieId: movie.movieId,
        datetime: new Date(datetime).toISOString(),
        mode,
        visibility,
        participantLimit,
        requiresApproval,
        title: title.trim() || null,
        location:
          mode === 'in-person' && location.lat !== null && location.lng !== null
            ? { area: location.area.trim(), city: location.city.trim(), lat: location.lat, lng: location.lng }
            : null
      })
      onCreated(created.eventId)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create the watch party')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Host a watch party"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-text">Host a watch party</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[13px] font-semibold text-text-muted">
            ✕
          </button>
        </div>

        {!movie ? (
          <div className="flex flex-col gap-2.5">
            <label htmlFor="create-event-movie-search" className="text-[11px] font-semibold text-text-secondary">
              Which movie?
            </label>
            <input
              id="create-event-movie-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search movies…"
              autoFocus
              className="w-full rounded-lg border border-border bg-input px-2.5 py-2 text-[13px] text-text outline-none focus:border-accent"
            />
            {searching && <p className="text-[12px] text-text-muted">Searching…</p>}
            {!searching && query.trim() && results.length === 0 && <p className="text-[12px] text-text-muted">No movies found.</p>}
            <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
              {results.map((m) => {
                const poster = posterUrl(m.poster)
                return (
                  <li key={m.movieId}>
                    <button
                      type="button"
                      onClick={() => setMovie(m)}
                      className="flex w-full items-center gap-2.5 rounded-lg border border-border-soft p-2 text-left"
                    >
                      <div className="h-12 w-9 flex-none overflow-hidden rounded-md bg-surface-alt">
                        {poster && <img src={poster} alt="" className="h-full w-full object-cover" />}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-bold text-text">{m.title}</div>
                        {m.year && <div className="text-[10.5px] text-text-muted">{m.year}</div>}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5 rounded-lg border border-border-soft p-2">
              <div className="h-12 w-9 flex-none overflow-hidden rounded-md bg-surface-alt">
                {posterUrl(movie.poster) && <img src={posterUrl(movie.poster)!} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-text">{movie.title}</div>
              <button type="button" onClick={() => setMovie(null)} className="flex-none text-[11px] font-semibold text-accent">
                Change
              </button>
            </div>

            <div>
              <label htmlFor="create-event-datetime" className="mb-1 block text-[11px] font-semibold text-text-secondary">
                Date &amp; time
              </label>
              <input
                id="create-event-datetime"
                type="datetime-local"
                required
                value={datetime}
                onChange={(e) => setDatetime(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-2.5 py-2 text-[12.5px] text-text outline-none focus:border-accent"
              />
            </div>

            <div>
              <label htmlFor="create-event-title" className="mb-1 block text-[11px] font-semibold text-text-secondary">
                Title (optional)
              </label>
              <input
                id="create-event-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Interstellar Night"
                className="w-full rounded-lg border border-border bg-input px-2.5 py-2 text-[12.5px] text-text outline-none focus:border-accent"
              />
            </div>

            <div className="flex gap-2.5">
              <div className="flex-1">
                <label htmlFor="create-event-mode" className="mb-1 block text-[11px] font-semibold text-text-secondary">
                  Mode
                </label>
                <select
                  id="create-event-mode"
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value as 'online' | 'in-person')
                    setLocation(EMPTY_LOCATION)
                  }}
                  className="w-full rounded-lg border border-border bg-input px-2.5 py-2 text-[12.5px] text-text outline-none focus:border-accent"
                >
                  <option value="online">Online</option>
                  <option value="in-person">In-person</option>
                </select>
              </div>
              <div className="flex-1">
                <label htmlFor="create-event-visibility" className="mb-1 block text-[11px] font-semibold text-text-secondary">
                  Visibility
                </label>
                <select
                  id="create-event-visibility"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
                  className="w-full rounded-lg border border-border bg-input px-2.5 py-2 text-[12.5px] text-text outline-none focus:border-accent"
                >
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </div>
            </div>

            {mode === 'in-person' && (
              <div className="flex flex-col gap-2 rounded-lg border border-border-soft p-2.5">
                <div className="flex gap-2">
                  <input
                    type="text"
                    aria-label="Area"
                    value={location.area}
                    onChange={(e) => setLocation((prev) => ({ ...prev, area: e.target.value }))}
                    placeholder="Area"
                    className="w-full rounded-lg border border-border bg-input px-2.5 py-2 text-[12.5px] text-text outline-none focus:border-accent"
                  />
                  <input
                    type="text"
                    aria-label="City"
                    value={location.city}
                    onChange={(e) => setLocation((prev) => ({ ...prev, city: e.target.value }))}
                    placeholder="City"
                    className="w-full rounded-lg border border-border bg-input px-2.5 py-2 text-[12.5px] text-text outline-none focus:border-accent"
                  />
                </div>
                <button type="button" onClick={captureLocation} className="text-left text-[11px] font-semibold text-accent">
                  {location.status === 'captured' ? 'Location captured ✓' : location.status === 'locating' ? 'Locating…' : 'Share my location'}
                </button>
                {location.status === 'error' && <p className="text-[11px] text-red-400">Couldn&apos;t get your location — check browser permissions.</p>}
              </div>
            )}

            <div className="flex gap-2.5">
              <div className="flex-1">
                <label htmlFor="create-event-limit" className="mb-1 block text-[11px] font-semibold text-text-secondary">
                  Max people
                </label>
                <input
                  id="create-event-limit"
                  type="number"
                  min={1}
                  value={participantLimit}
                  onChange={(e) => setParticipantLimit(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full rounded-lg border border-border bg-input px-2.5 py-2 text-[12.5px] text-text outline-none focus:border-accent"
                />
              </div>
              <label className="mt-auto mb-2 flex items-center gap-1.5 text-[11.5px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={requiresApproval}
                  onChange={(e) => setRequiresApproval(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                Approve requests
              </label>
            </div>

            {formError && (
              <p role="alert" className="text-[12px] text-red-400">
                {formError}
              </p>
            )}

            <div className="flex gap-2">
              <button type="submit" disabled={submitting} className="flex-1 rounded-lg bg-accent py-2.5 text-[12.5px] font-bold text-bg disabled:opacity-60">
                {submitting ? 'Scheduling…' : 'Schedule'}
              </button>
              <button type="button" onClick={onClose} className="text-[12px] font-semibold text-text-muted">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
