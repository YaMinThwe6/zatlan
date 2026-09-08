import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUpcomingEvents, joinEvent, type UpcomingEvent } from '../services/homeApi'
import { posterUrl } from '../../../lib/images'
import { formatEventDate as formatDate } from '../../../lib/eventDate'

export function UpcomingEvents() {
  const navigate = useNavigate()
  const [items, setItems] = useState<UpcomingEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [joinStatus, setJoinStatus] = useState<Record<string, 'joined' | 'pending'>>({})

  useEffect(() => {
    getUpcomingEvents()
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load events'))
      .finally(() => setLoading(false))
  }, [])

  async function handleJoin(eventId: string) {
    try {
      const { status } = await joinEvent(eventId)
      setJoinStatus((prev) => ({ ...prev, [eventId]: status }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join event')
    }
  }

  if (loading)
    return (
      <section className="px-5">
        <h2 className="mb-3 text-[15px] font-bold text-text">Upcoming watch events</h2>
        <p className="text-sm text-text-muted">Loading…</p>
      </section>
    )
  if (error)
    return (
      <section className="px-5">
        <h2 className="mb-3 text-[15px] font-bold text-text">Upcoming watch events</h2>
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      </section>
    )

  return (
    <section className="px-5">
      <h2 className="mb-3 text-[15px] font-bold text-text">Upcoming watch events</h2>
      {items.length === 0 && <p className="text-sm text-text-muted">No public events coming up yet — be the first to host one.</p>}
      <ul className="flex flex-col gap-3">
        {items.map((event) => {
          // joinStatus only ever records a change made THIS session (via
          // handleJoin) — event.joined/event.pending are the real, persisted
          // answer from the backend, so they're the fallback rather than
          // always starting "un-joined" until clicked. Without this, the
          // button reverted to "Join" on every refresh — even for an event
          // already joined (or one's own hosted event, always auto-joined),
          // or for an approval-required event with a request still pending.
          const status = joinStatus[event.eventId] ?? (event.joined ? 'joined' : event.pending ? 'pending' : undefined)
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
                {event.mode === 'in-person' && event.location && (
                  <div className="mt-0.5 text-[10.5px] text-text-muted">
                    {event.location.area}, {event.location.city}
                  </div>
                )}
                <div className="mt-0.5 text-[10.5px] text-text-muted">
                  {event.participantCount}/{event.participantLimit} going
                </div>
              </div>
              <div className="flex flex-none flex-col items-end gap-1.5">
                {status === 'joined' ? (
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
                    disabled={status === 'pending'}
                    onClick={() => handleJoin(event.eventId)}
                    className="rounded-[9px] bg-accent px-4 py-2 text-[12px] font-bold text-bg disabled:opacity-60"
                  >
                    {status === 'pending' ? 'Requested' : 'Join'}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
