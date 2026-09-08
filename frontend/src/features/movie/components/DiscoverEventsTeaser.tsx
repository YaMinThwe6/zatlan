import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUpcomingEvents, type UpcomingEvent } from '../../home/services/homeApi'
import { formatEventDate as formatDate } from '../../../lib/eventDate'

// Guest-only right-rail teaser on the public Discover page — reuses the same
// GET /events/upcoming Home's own UpcomingEvents calls, safe for a
// signed-out visitor too since that endpoint never returns exact coordinates
// to anyone (events.service.ts's listUpcomingEvents). The event info itself
// is already public and stays visible; only joining is gated.
export function DiscoverEventsTeaser() {
  const navigate = useNavigate()
  const [items, setItems] = useState<UpcomingEvent[]>([])
  const [status, setStatus] = useState<'loading' | 'idle' | 'error'>('loading')

  useEffect(() => {
    getUpcomingEvents()
      .then((res) => {
        setItems(res.items)
        setStatus('idle')
      })
      .catch(() => setStatus('error')) // non-critical section — fails quietly
  }, [])

  if (status === 'loading') {
    return (
      <section>
        <h2 className="mb-3.5 text-[13.5px] font-bold text-text">Upcoming events</h2>
        <p className="text-[12px] text-text-muted">Loading…</p>
      </section>
    )
  }
  if (status === 'error' || items.length === 0) return null

  return (
    <section>
      <h2 className="mb-3.5 text-[13.5px] font-bold text-text">Upcoming events</h2>
      <ul className="flex flex-col gap-3">
        {items.map((event) => (
          <li key={event.eventId} className="rounded-xl border border-border-soft bg-surface p-3">
            <span
              className={
                event.mode === 'online'
                  ? 'inline-block rounded-md bg-[rgba(var(--accent-rgb),0.14)] px-2 py-0.5 text-[9px] font-bold text-accent'
                  : 'inline-block rounded-md bg-[rgba(155,171,196,0.14)] px-2 py-0.5 text-[9px] font-bold text-[#9BABC4]'
              }
            >
              {event.mode === 'online' ? 'Online' : 'In-person'}
            </span>
            <div className="mt-1.5 truncate text-[12.5px] font-bold text-text">{event.title ?? event.movieTitle ?? 'Watch party'}</div>
            <div className="mt-0.5 text-[10.5px] text-text-muted">
              {formatDate(event.datetime)}
              {event.mode === 'in-person' && event.location ? ` · ${event.location.area}, ${event.location.city}` : ''}
            </div>
            <button type="button" onClick={() => navigate('/get-started')} className="mt-2 cursor-pointer text-[10.5px] font-bold text-text-faint underline">
              Sign in to join
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
