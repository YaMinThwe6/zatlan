import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Me } from '../../../lib/api'
import {
  getEvent,
  joinEvent,
  leaveEvent,
  deleteEvent,
  getJoinRequests,
  approveJoinRequest,
  denyJoinRequest,
  type EventDetail,
  type EventJoinRequest
} from '../../home/services/homeApi'
import { posterUrl } from '../../../lib/images'
import { formatEventDate } from '../../../lib/eventDate'
import { Sidebar } from '../../../components/Sidebar'
import { MobileTabBar } from '../../../components/MobileTabBar'

interface Props {
  me: Me
}

function formatDate(iso: string | null): string {
  return formatEventDate(iso, { weekday: 'long' })
}

export function EventDetailPage({ me }: Props) {
  const { eventId } = useParams<{ eventId: string }>()
  const navigate = useNavigate()
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [viewerStatus, setViewerStatus] = useState<EventDetail['viewerStatus'] | null>(null)
  const [actionError, setActionError] = useState('')
  const [deleting, setDeleting] = useState(false)
  // The gap this closes: the backend has always had GET/approve/deny
  // endpoints for join requests (events.service.ts), but nothing in the
  // frontend ever called them — a host had no way to act on a request
  // through the UI at all.
  const [joinRequests, setJoinRequests] = useState<EventJoinRequest[]>([])
  // Per-request guard against a rapid double-click firing two overlapping
  // approve/deny calls for the same requester, same pattern used elsewhere
  // in the app (e.g. onboarding's WatchedStep).
  const [actingOn, setActingOn] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!eventId) return
    let cancelled = false
    getEvent(eventId)
      .then((res) => {
        if (cancelled) return
        setEvent(res)
        setViewerStatus(res.viewerStatus)
        // Only the host can even see these (backend 403s anyone else), and
        // an event that never requires approval can never have any.
        if (res.viewerStatus === 'host' && res.requiresApproval) {
          getJoinRequests(eventId)
            .then((r) => {
              if (!cancelled) setJoinRequests(r.items)
            })
            .catch(() => {
              // A minor section on a page that already loaded successfully —
              // not worth blocking or erroring the whole page over.
            })
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load this event')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [eventId])

  async function handleApprove(requesterUid: string) {
    if (!eventId || actingOn.has(requesterUid)) return
    setActionError('')
    setActingOn((prev) => new Set(prev).add(requesterUid))
    try {
      await approveJoinRequest(eventId, requesterUid)
      setJoinRequests((prev) => prev.filter((r) => r.uid !== requesterUid))
      setEvent((prev) => (prev ? { ...prev, participantCount: prev.participantCount + 1 } : prev))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to approve this request')
    } finally {
      setActingOn((prev) => {
        const next = new Set(prev)
        next.delete(requesterUid)
        return next
      })
    }
  }

  async function handleDeny(requesterUid: string) {
    if (!eventId || actingOn.has(requesterUid)) return
    setActionError('')
    setActingOn((prev) => new Set(prev).add(requesterUid))
    try {
      await denyJoinRequest(eventId, requesterUid)
      setJoinRequests((prev) => prev.filter((r) => r.uid !== requesterUid))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to deny this request')
    } finally {
      setActingOn((prev) => {
        const next = new Set(prev)
        next.delete(requesterUid)
        return next
      })
    }
  }

  async function handleJoin() {
    if (!eventId) return
    setActionError('')
    try {
      const { status } = await joinEvent(eventId)
      setViewerStatus(status)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to join')
    }
  }

  async function handleLeave() {
    if (!eventId) return
    setActionError('')
    try {
      await leaveEvent(eventId)
      setViewerStatus('none')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to leave')
    }
  }

  async function handleCancelEvent() {
    if (!eventId) return
    if (!window.confirm('Cancel this event? This cannot be undone.')) return
    setActionError('')
    setDeleting(true)
    try {
      await deleteEvent(eventId)
      navigate('/events')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to cancel this event')
      setDeleting(false)
    }
  }

  return (
    <div className="flex min-h-svh bg-bg text-text lg:h-svh">
      <Sidebar active="events" />

      <main className="min-w-0 flex-1 pb-6 lg:flex lg:flex-col lg:overflow-y-auto lg:pb-10">
        <div className="mx-auto w-full max-w-2xl px-5 pt-4.5 lg:px-7 lg:pt-7">
          <button type="button" onClick={() => navigate('/events')} className="mb-4 text-[12.5px] font-semibold text-text-muted">
            ‹ Back to Events
          </button>

          {loading && <p className="text-sm text-text-muted">Loading…</p>}
          {!loading && (error || !event) && (
            <p role="alert" className="text-sm text-red-400">
              {error || 'Event not found.'}
            </p>
          )}

          {!loading && event && (
            <div className="flex flex-col gap-5">
              <div className="flex gap-4">
                <div className="h-28 w-20 flex-none overflow-hidden rounded-xl bg-surface-alt">
                  {posterUrl(event.moviePoster) && <img src={posterUrl(event.moviePoster)!} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0">
                  <span
                    className={
                      event.mode === 'online'
                        ? 'inline-block rounded-md bg-[rgba(var(--accent-rgb),0.14)] px-2 py-0.5 text-[10px] font-bold text-accent'
                        : 'inline-block rounded-md bg-[rgba(155,171,196,0.14)] px-2 py-0.5 text-[10px] font-bold text-[#9BABC4]'
                    }
                  >
                    {event.mode === 'online' ? 'Online' : 'In-person'}
                  </span>
                  <h1 className="mt-2 font-serif text-[20px] font-bold text-text">{event.title ?? event.movieTitle ?? 'Watch party'}</h1>
                  {event.movieTitle && <p className="mt-1 text-[12px] text-text-muted">{event.movieTitle}</p>}
                </div>
              </div>

              <div className="flex items-center gap-2.5 text-[13px] text-text">
                <span className="text-text-muted">Hosted by</span>
                <span className="font-bold">
                  {event.hostDisplayName}
                  {viewerStatus === 'host' ? ' (you)' : ''}
                </span>
              </div>

              <div className="flex flex-col gap-3 rounded-2xl border border-border-soft bg-surface p-4">
                <div className="text-[13px] font-bold text-text">{formatDate(event.datetime)}</div>
                {event.mode === 'in-person' && event.location && (
                  <div className="text-[12.5px] text-text-muted">
                    {event.location.area}, {event.location.city}
                  </div>
                )}
                <div className="text-[12.5px] text-text-muted">
                  {event.participantCount}/{event.participantLimit} going
                  {event.requiresApproval ? ' · requires host approval' : ''}
                </div>
              </div>

              {viewerStatus === 'host' && joinRequests.length > 0 && (
                <div className="flex flex-col gap-3 rounded-2xl border border-border-soft bg-surface p-4">
                  <h2 className="text-[13px] font-bold text-text">
                    Join requests <span className="text-text-muted">({joinRequests.length})</span>
                  </h2>
                  <ul className="flex flex-col gap-2.5">
                    {joinRequests.map((request) => (
                      <li key={request.uid} className="flex items-center justify-between gap-2.5">
                        <span className="min-w-0 truncate text-[13px] text-text">{request.displayName}</span>
                        <div className="flex flex-none gap-2">
                          <button
                            type="button"
                            disabled={actingOn.has(request.uid)}
                            onClick={() => handleApprove(request.uid)}
                            className="rounded-lg bg-accent px-3 py-1.5 text-[11.5px] font-bold text-bg disabled:opacity-60"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={actingOn.has(request.uid)}
                            onClick={() => handleDeny(request.uid)}
                            className="rounded-lg border border-border px-3 py-1.5 text-[11.5px] font-bold text-text disabled:opacity-60"
                          >
                            Deny
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {actionError && (
                <p role="alert" className="text-[13px] text-red-400">
                  {actionError}
                </p>
              )}

              <div className="flex gap-2.5">
                {viewerStatus === 'host' ? (
                  <button
                    type="button"
                    onClick={handleCancelEvent}
                    disabled={deleting}
                    className="rounded-xl border border-red-400/50 px-5 py-2.5 text-[13px] font-bold text-red-400 disabled:opacity-60"
                  >
                    {deleting ? 'Cancelling…' : 'Cancel event'}
                  </button>
                ) : viewerStatus === 'joined' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => navigate(`/rooms/${event.roomId}`)}
                      className="rounded-xl bg-accent px-5 py-2.5 text-[13px] font-bold text-bg"
                    >
                      Chat
                    </button>
                    <button type="button" onClick={handleLeave} className="rounded-xl border border-border px-5 py-2.5 text-[13px] font-bold text-text">
                      Leave
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={viewerStatus === 'pending'}
                    onClick={handleJoin}
                    className="rounded-xl bg-accent px-5 py-2.5 text-[13px] font-bold text-bg disabled:opacity-60"
                  >
                    {viewerStatus === 'pending' ? 'Requested' : 'Join event'}
                  </button>
                )}
              </div>

              {me.uid === event.hostId && event.visibility === 'private' && event.joinCode && (
                <p className="text-[11.5px] text-text-muted">
                  Invite code: <span className="font-bold text-text">{event.joinCode}</span>
                </p>
              )}
            </div>
          )}
        </div>

        <MobileTabBar active="events" />
      </main>
    </div>
  )
}
