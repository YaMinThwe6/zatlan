import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUpcomingEvents, joinEvent, createEvent, type UpcomingEvent } from '../../home/services/homeApi'

interface Props {
  movieId: string
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

type LocationState = { status: 'idle' | 'locating' | 'captured' | 'error'; area: string; city: string; lat: number | null; lng: number | null }
const EMPTY_LOCATION: LocationState = { status: 'idle', area: '', city: '', lat: null, lng: null }

// "Watch together" — movie detail's right rail (Desktop.dc.html). Unlike
// SimilarPicks or Home's other right-rail sections, this always renders once
// loaded, even with zero events for this movie: "Create a watch party" is an
// evergreen invitation, not a personalized recommendation that looks broken
// when empty — hiding it here would remove the one obvious way to start the
// first one.
export function WatchTogether({ movieId }: Props) {
  const navigate = useNavigate()
  const [items, setItems] = useState<UpcomingEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [joinStatus, setJoinStatus] = useState<Record<string, 'joined' | 'pending'>>({})

  const [formOpen, setFormOpen] = useState(false)
  const [datetime, setDatetime] = useState('')
  const [mode, setMode] = useState<'online' | 'in-person'>('online')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [participantLimit, setParticipantLimit] = useState(10)
  const [requiresApproval, setRequiresApproval] = useState(false)
  const [title, setTitle] = useState('')
  const [location, setLocation] = useState<LocationState>(EMPTY_LOCATION)
  const [formError, setFormError] = useState('')

  function loadEvents() {
    return getUpcomingEvents(movieId)
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load events'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieId])

  async function handleJoin(eventId: string) {
    try {
      const { status } = await joinEvent(eventId)
      setJoinStatus((prev) => ({ ...prev, [eventId]: status }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join event')
    }
  }

  function openForm() {
    setDatetime('')
    setMode('online')
    setVisibility('public')
    setParticipantLimit(10)
    setRequiresApproval(false)
    setTitle('')
    setLocation(EMPTY_LOCATION)
    setFormError('')
    setFormOpen(true)
  }

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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (mode === 'in-person' && (location.lat === null || location.lng === null)) {
      setFormError('Location is required for an in-person watch party — use "Share my location" below.')
      return
    }
    if (mode === 'in-person' && (!location.area.trim() || !location.city.trim())) {
      setFormError('Area and city are required for an in-person watch party.')
      return
    }
    try {
      const created = await createEvent({
        movieId,
        datetime: new Date(datetime).toISOString(),
        mode,
        visibility,
        participantLimit,
        requiresApproval,
        title: title.trim() || null,
        location: mode === 'in-person' && location.lat !== null && location.lng !== null
          ? { area: location.area.trim(), city: location.city.trim(), lat: location.lat, lng: location.lng }
          : null
      })
      setJoinStatus((prev) => ({ ...prev, [created.eventId]: 'joined' })) // creating auto-joins the host
      setFormOpen(false)
      await loadEvents()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create the watch party')
    }
  }

  if (loading) return null

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13.5px] font-bold text-text">Watch together</h2>
        <span className="text-[11px] font-semibold text-text-muted">
          {items.length} happening
        </span>
      </div>

      {error && (
        <p role="alert" className="mb-3 text-[13px] text-red-400">
          {error}
        </p>
      )}

      {items.length > 0 && (
        <ul className="mb-3.5 flex flex-col gap-2.5">
          {items.map((event) => {
            // See Home's UpcomingEvents.tsx for why this falls back to
            // event.joined — joinStatus alone starts empty on every load.
            const status = joinStatus[event.eventId] ?? (event.joined ? 'joined' : undefined)
            return (
              <li key={event.eventId} className="flex items-center gap-2.5 rounded-xl border border-border-soft bg-surface p-2.5">
                <div className="h-9.5 w-9.5 flex-none rounded-lg bg-surface-alt" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-bold text-text">{event.title ?? event.movieTitle ?? 'Watch party'}</div>
                  <div className="text-[10.5px] text-text-muted">
                    {formatDate(event.datetime)} · {event.mode === 'online' ? 'Online' : event.location ? `${event.location.area}, ${event.location.city}` : 'In-person'}
                  </div>
                </div>
                {status === 'joined' ? (
                  <button type="button" onClick={() => navigate(`/rooms/${event.roomId}`)} className="flex-none text-[11px] font-semibold text-accent">
                    Chat
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={status === 'pending'}
                    onClick={() => handleJoin(event.eventId)}
                    className="flex-none rounded-lg bg-accent px-3 py-1.5 text-[11px] font-bold text-bg disabled:opacity-60"
                  >
                    {status === 'pending' ? 'Requested' : 'Join'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {!formOpen ? (
        <button
          type="button"
          onClick={openForm}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-accent py-3 text-[12.5px] font-bold text-accent"
        >
          + Create a watch party
        </button>
      ) : (
        <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-alt p-3.5">
          <div>
            <label htmlFor="watch-together-datetime" className="mb-1 block text-[11px] font-semibold text-text-secondary">
              Date &amp; time
            </label>
            <input
              id="watch-together-datetime"
              type="datetime-local"
              required
              value={datetime}
              onChange={(e) => setDatetime(e.target.value)}
              className="w-full rounded-lg border border-border bg-input px-2.5 py-2 text-[12.5px] text-text outline-none focus:border-accent"
            />
          </div>

          <div>
            <label htmlFor="watch-together-title" className="mb-1 block text-[11px] font-semibold text-text-secondary">
              Title (optional)
            </label>
            <input
              id="watch-together-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Interstellar Night"
              className="w-full rounded-lg border border-border bg-input px-2.5 py-2 text-[12.5px] text-text outline-none focus:border-accent"
            />
          </div>

          <div className="flex gap-2.5">
            <div className="flex-1">
              <label htmlFor="watch-together-mode" className="mb-1 block text-[11px] font-semibold text-text-secondary">
                Mode
              </label>
              <select
                id="watch-together-mode"
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
              <label htmlFor="watch-together-visibility" className="mb-1 block text-[11px] font-semibold text-text-secondary">
                Visibility
              </label>
              <select
                id="watch-together-visibility"
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
              <label htmlFor="watch-together-limit" className="mb-1 block text-[11px] font-semibold text-text-secondary">
                Max people
              </label>
              <input
                id="watch-together-limit"
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
            <button type="submit" className="flex-1 rounded-lg bg-accent py-2.5 text-[12.5px] font-bold text-bg">
              Schedule
            </button>
            <button type="button" onClick={() => setFormOpen(false)} className="text-[12px] font-semibold text-text-muted">
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
