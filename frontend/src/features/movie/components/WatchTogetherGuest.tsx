import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUpcomingEvents, type UpcomingEvent } from '../../home/services/homeApi'
import { formatEventDate as formatDate } from '../../../lib/eventDate'

interface Props {
  movieId: string
}

// Guest-facing counterpart to WatchTogether (signed-in only). A movie's
// scheduled watch parties are public info — GET /events/upcoming never
// requires a token — only actually joining or hosting is gated. Unlike
// WatchTogether, there's no evergreen "Create a watch party" CTA to fall
// back to when nothing's scheduled (a guest can't host), so this renders
// nothing at all rather than an empty section with nowhere to go.
export function WatchTogetherGuest({ movieId }: Props) {
  const navigate = useNavigate()
  const [items, setItems] = useState<UpcomingEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getUpcomingEvents(movieId)
      .then((res) => {
        if (!cancelled) setItems(res.items)
      })
      .catch(() => {
        // Non-critical section for a guest — fails quietly, same as
        // DiscoverEventsTeaser and DiscoverPeopleTeaser.
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [movieId])

  if (loading || items.length === 0) return null

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13.5px] font-bold text-text">Watch together</h2>
        <span className="text-[11px] font-semibold text-text-muted">{items.length} happening</span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {items.map((event) => (
          <li key={event.eventId} className="flex items-center gap-2.5 rounded-xl border border-border-soft bg-surface p-2.5">
            <div className="h-9.5 w-9.5 flex-none rounded-lg bg-surface-alt" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-bold text-text">{event.title ?? event.movieTitle ?? 'Watch party'}</div>
              <div className="text-[10.5px] text-text-muted">
                {formatDate(event.datetime)} · {event.mode === 'online' ? 'Online' : event.location ? `${event.location.area}, ${event.location.city}` : 'In-person'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/get-started')}
              className="flex-none rounded-lg border border-accent px-3 py-1.5 text-[11px] font-bold text-accent"
            >
              Sign in to join
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
