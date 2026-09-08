import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUpcomingEvents, getHostedEvents, joinEvent, type UpcomingEvent } from '../../home/services/homeApi'
import { Sidebar } from '../../../components/Sidebar'
import { MobileTabBar } from '../../../components/MobileTabBar'
import { posterUrl } from '../../../lib/images'
import { formatEventDate as formatDate, eventDateGroup, type EventDateGroup } from '../../../lib/eventDate'
import { CreateEventModal } from './CreateEventModal'

type Tab = 'upcoming' | 'hosting'
type ModeFilter = 'all' | 'online' | 'in-person'
type SortOrder = 'soonest' | 'popular'

const GROUP_ORDER: EventDateGroup[] = ['this-week', 'weekend', 'next-week', 'later']
const GROUP_LABELS: Record<EventDateGroup, string> = {
  'this-week': 'This week',
  weekend: 'This weekend',
  'next-week': 'Next week',
  later: 'Later'
}

// The Events page's own list of "which of my hosted events has this browser
// already asked to join" is intentionally local-only, same as Home's
// UpcomingEvents/NearbyEvents — the backend already reflects join state on
// re-fetch, this is just optimistic UI while that round-trip is in flight.
export function EventsPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('upcoming')
  const [items, setItems] = useState<UpcomingEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [joinStatus, setJoinStatus] = useState<Record<string, 'joined' | 'pending'>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all')
  const [sort, setSort] = useState<SortOrder>('soonest')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    // The previous tab's rows must not linger through the switch — left in
    // place, a slow or failed fetch shows them under the new tab's own
    // action label (e.g. "Upcoming" rows rendered with "Manage", the
    // Hosting tab's label) instead of the empty/error state they should see.
    setItems([])
    const fetcher = tab === 'upcoming' ? getUpcomingEvents() : getHostedEvents()
    fetcher
      .then((res) => {
        if (!cancelled) setItems(res.items)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load events')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tab])

  async function handleJoin(eventId: string) {
    try {
      const { status } = await joinEvent(eventId)
      setJoinStatus((prev) => ({ ...prev, [eventId]: status }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join event')
    }
  }

  function handleCreated(eventId: string) {
    setCreateOpen(false)
    navigate(`/events/${eventId}`)
  }

  // Client-side, over whatever the current tab already fetched — the list
  // isn't paginated, so there's nothing a server round-trip would buy here.
  const groupedItems = useMemo(() => {
    const filtered = items.filter((event) => modeFilter === 'all' || event.mode === modeFilter)
    const sorted = [...filtered].sort((a, b) =>
      sort === 'popular'
        ? b.participantCount - a.participantCount
        : new Date(a.datetime ?? 0).getTime() - new Date(b.datetime ?? 0).getTime()
    )
    const byGroup = new Map<EventDateGroup, UpcomingEvent[]>()
    for (const event of sorted) {
      const group = eventDateGroup(event.datetime)
      byGroup.set(group, [...(byGroup.get(group) ?? []), event])
    }
    return GROUP_ORDER.map((group) => ({ group, events: byGroup.get(group) ?? [] })).filter(({ events: g }) => g.length > 0)
  }, [items, modeFilter, sort])

  const tabButtonClass = (on: boolean) =>
    on
      ? 'border-b-2 border-accent pb-3 text-[12.5px] font-bold text-accent'
      : 'pb-3 text-[12.5px] font-semibold text-text-muted'

  return (
    <div className="flex min-h-svh bg-bg text-text lg:h-svh">
      <Sidebar active="events" />

      <main className="min-w-0 flex-1 pb-6 lg:flex lg:flex-col lg:pb-0">
        <header className="flex items-center justify-between px-5 pt-4.5 lg:border-b lg:border-border-soft lg:px-7 lg:py-4.5">
          <div>
            <h1 className="text-[19px] font-bold text-text lg:text-[18px]">Events</h1>
            <p className="hidden text-[11.5px] text-text-muted lg:mt-0.5 lg:block">Watch parties near you &amp; online</p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-[10px] bg-accent px-3.5 py-2.5 text-[12px] font-bold text-bg lg:px-4"
          >
            + Host a watch party
          </button>
        </header>

        <div className="flex gap-5 border-b border-border-soft px-5 pt-3 lg:px-7">
          <button type="button" onClick={() => setTab('upcoming')} className={tabButtonClass(tab === 'upcoming')}>
            Upcoming
          </button>
          <button type="button" onClick={() => setTab('hosting')} className={tabButtonClass(tab === 'hosting')}>
            Hosting
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5 px-5 py-3 lg:px-7">
          <div className="flex gap-2">
            {(['all', 'online', 'in-person'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={modeFilter === option}
                onClick={() => setModeFilter(option)}
                className={
                  modeFilter === option
                    ? 'rounded-full bg-accent px-3 py-1.5 text-[11.5px] font-bold text-bg'
                    : 'rounded-full border border-border-soft px-3 py-1.5 text-[11.5px] font-semibold text-text-secondary'
                }
              >
                {option === 'all' ? 'All' : option === 'online' ? 'Online' : 'In-person'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-text-secondary">
            Sort
            <select
              aria-label="Sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOrder)}
              className="rounded-lg border border-border-soft bg-surface-alt px-2 py-1.5 text-[11.5px] text-text outline-none focus:border-accent"
            >
              <option value="soonest">Soonest</option>
              <option value="popular">Most popular</option>
            </select>
          </label>
        </div>

        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <div className="flex flex-col gap-3 px-5 py-4 lg:px-7">
            {loading && <p className="text-sm text-text-muted">Loading…</p>}
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
            {!loading && !error && items.length === 0 && (
              <p className="text-sm text-text-muted">
                {tab === 'upcoming' ? 'No public events coming up yet — be the first to host one.' : "You're not hosting any upcoming events."}
              </p>
            )}
            {!loading && !error && items.length > 0 && groupedItems.length === 0 && (
              <p className="text-sm text-text-muted">No events match this filter.</p>
            )}

            {!loading &&
              groupedItems.map(({ group, events }) => (
                <div key={group} className="flex flex-col gap-3">
                  <h2 className="text-[12px] font-bold tracking-wide text-text-muted uppercase">{GROUP_LABELS[group]}</h2>
                  {events.map((event) => {
                    // See Home's UpcomingEvents.tsx for why this falls back to
                    // event.joined — joinStatus alone starts empty on every load,
                    // including for the caller's own event mixed into "Upcoming".
                    const status = joinStatus[event.eventId] ?? (event.joined ? 'joined' : undefined)
                    const poster = posterUrl(event.moviePoster)
                    return (
                      <div
                        key={event.eventId}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open ${event.title ?? event.movieTitle ?? 'watch party'}`}
                        onClick={() => navigate(`/events/${event.eventId}`)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            navigate(`/events/${event.eventId}`)
                          }
                        }}
                        className="flex cursor-pointer items-center gap-3.5 rounded-2xl border border-border-soft bg-surface p-3.5 text-left"
                      >
                        <div className="h-15 w-15 flex-none overflow-hidden rounded-[11px] bg-surface-alt">
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
                          <div className="mt-1.5 truncate text-[13.5px] font-bold text-text">{event.title ?? event.movieTitle ?? 'Watch party'}</div>
                          {tab === 'upcoming' && (
                            <div className="mt-0.5 truncate text-[10.5px] text-text-muted">Hosted by {event.hostDisplayName}</div>
                          )}
                          <div className="mt-0.5 text-[11px] text-text-muted">
                            {formatDate(event.datetime)}
                            {event.mode === 'in-person' && event.location ? ` · ${event.location.area}, ${event.location.city}` : ''}
                          </div>
                          <div className="mt-0.5 text-[10.5px] text-text-muted">
                            {event.participantCount}/{event.participantLimit} going
                          </div>
                        </div>
                        {tab === 'upcoming' &&
                          (status === 'joined' ? (
                            <span className="flex-none rounded-[9px] border border-border bg-surface-alt px-4 py-2 text-[12px] font-bold text-text">Joined</span>
                          ) : (
                            <button
                              type="button"
                              disabled={status === 'pending'}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleJoin(event.eventId)
                              }}
                              className="flex-none rounded-[9px] bg-accent px-4 py-2 text-[12px] font-bold text-bg disabled:opacity-60"
                            >
                              {status === 'pending' ? 'Requested' : 'Join'}
                            </button>
                          ))}
                        {tab === 'hosting' && (
                          <span className="flex-none rounded-[9px] border border-border bg-surface-alt px-4 py-2 text-[12px] font-bold text-text">Manage</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
          </div>
        </div>

        <MobileTabBar active="events" />
      </main>

      {createOpen && <CreateEventModal onClose={() => setCreateOpen(false)} onCreated={handleCreated} />}
    </div>
  )
}
