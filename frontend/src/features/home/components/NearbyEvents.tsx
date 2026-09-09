import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getNearbyEvents, joinEvent, type NearbyEvent } from '../services/homeApi'
import { NearbyEventsMap } from './NearbyEventsMap'
import { mapsConfigured } from '../../../lib/maps'
import { posterUrl } from '../../../lib/images'
import { formatEventDate as formatDate } from '../../../lib/eventDate'

const DEFAULT_RADIUS_KM = 25

type Status = 'idle' | 'locating' | 'loading' | 'loaded' | 'denied' | 'error'

// hld.md §9 — explicit opt-in (button, not auto-requested on mount) rather
// than prompting for location on every Home visit: matches PRD §30.7's
// no-location-without-consent principle, and the browser's own permission
// prompt only fires once findNearby() actually calls getCurrentPosition.
export function NearbyEvents() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>('idle')
  const [items, setItems] = useState<NearbyEvent[]>([])
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null)
  const [error, setError] = useState('')
  const [joinStatus, setJoinStatus] = useState<Record<string, 'joined' | 'pending'>>({})

  function findNearby() {
    if (!navigator.geolocation) {
      setStatus('error')
      setError('Location is not available in this browser')
      return
    }
    setStatus('locating')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setStatus('loading')
        setCenter({ lat: position.coords.latitude, lng: position.coords.longitude })
        getNearbyEvents(position.coords.latitude, position.coords.longitude, DEFAULT_RADIUS_KM)
          .then((res) => {
            setItems(res.items)
            setStatus('loaded')
          })
          .catch((err) => {
            setStatus('error')
            setError(err instanceof Error ? err.message : 'Failed to load nearby events')
          })
      },
      (geoError) => {
        if (geoError.code === geoError.PERMISSION_DENIED) setStatus('denied')
        else {
          setStatus('error')
          setError('Could not determine your location')
        }
      }
    )
  }

  async function handleJoin(eventId: string) {
    try {
      const { status: joined } = await joinEvent(eventId)
      setJoinStatus((prev) => ({ ...prev, [eventId]: joined }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join event')
    }
  }

  return (
    <section className="px-5">
      <h2 className="mb-3 text-[15px] font-bold text-text">Watch parties near you</h2>

      {status === 'idle' && (
        <button type="button" onClick={findNearby} className="rounded-xl border border-border bg-surface-alt px-4 py-2.5 text-[13px] font-bold text-text">
          Find events near me
        </button>
      )}
      {status === 'locating' && <p className="text-sm text-text-muted">Getting your location…</p>}
      {status === 'loading' && <p className="text-sm text-text-muted">Loading…</p>}
      {status === 'denied' && <p className="text-sm text-text-muted">Enable location access to see watch parties near you.</p>}
      {status === 'error' && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {status === 'loaded' && items.length === 0 && <p className="text-sm text-text-muted">No watch parties nearby right now.</p>}

      {status === 'loaded' && mapsConfigured && center && items.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-2xl border border-border-soft">
          <NearbyEventsMap center={center} items={items} joinStatus={joinStatus} onJoin={handleJoin} />
        </div>
      )}

      {status === 'loaded' && items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((event) => {
            // See UpcomingEvents.tsx's identical comment — joinStatus only
            // records a change made this session; event.joined/event.pending
            // are the real, persisted answer, so they're the fallback
            // instead of always starting "un-joined" (which reverted the
            // button on refresh, including a still-pending approval request).
            const joined = joinStatus[event.eventId] ?? (event.joined ? 'joined' : event.pending ? 'pending' : undefined)
            const poster = posterUrl(event.moviePoster)
            return (
              <li key={event.eventId} className="flex items-center gap-3 rounded-2xl border border-border-soft bg-surface p-3">
                <div className="h-14 w-14 flex-none overflow-hidden rounded-[10px] bg-surface-alt">
                  {poster && <img src={poster} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <span
                    className={
                      event.mode === 'online'
                        ? 'inline-block rounded-md bg-[rgba(var(--accent-rgb),0.14)] px-2 py-0.5 text-[9.5px] font-bold text-accent'
                        : 'inline-block rounded-md bg-[rgba(155,171,196,0.14)] px-2 py-0.5 text-[9.5px] font-bold text-[#9BABC4]'
                    }
                  >
                    {event.mode === 'online' ? 'Online' : 'In-person'}
                  </span>
                  <div className="mt-1 truncate text-[13px] font-bold text-text">{event.title ?? event.movieTitle ?? 'Watch party'}</div>
                  <div className="mt-0.5 text-[10.5px] text-text-muted">{formatDate(event.datetime)}</div>
                  <div className="mt-0.5 text-[10.5px] text-text-muted">{event.distanceKm} km away</div>
                </div>
                <div className="flex flex-none flex-col items-end gap-1.5">
                  {joined === 'joined' ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/rooms/${event.roomId}`)}
                      className="rounded-[9px] bg-accent px-4 py-2 text-[12px] font-bold text-bg"
                    >
                      Chat
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={joined === 'pending'}
                      onClick={() => handleJoin(event.eventId)}
                      className="rounded-[9px] bg-accent px-4 py-2 text-[12px] font-bold text-bg disabled:opacity-60"
                    >
                      {joined === 'pending' ? 'Requested' : 'Join'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
