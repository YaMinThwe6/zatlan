import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { usePersonSuggestions } from '../../home/hooks/usePersonSuggestions'
import { getFollowRequests, approveFollowRequest, denyFollowRequest, type FollowRequest } from '../../home/services/homeApi'
import { PersonSuggestionCard } from '../../../components/PersonSuggestionCard'
import { useAuth } from '../../../lib/AuthContext'
import { Sidebar } from '../../../components/Sidebar'
import { AppHeader } from '../../../components/AppHeader'
import { MobileTabBar } from '../../../components/MobileTabBar'

// The full-page counterpart to Home's "People you might vibe with" widget —
// same usePersonSuggestions pipeline, just a wider limit (30 vs the widget's
// default 10) since this page has room for a real list rather than a rail
// preview. Unlike the widget (which disappears entirely when there are no
// suggestions), this page always shows something explicit: the backend's
// suggested-tier catch-all means an empty result here should only happen
// when there's truly no one else to suggest yet.
const DISCOVERY_LIMIT = 30

type Tab = 'discover' | 'requests'

const tabButtonClass = (active: boolean) =>
  active ? 'border-b-2 border-accent pb-3 text-[12.5px] font-bold text-accent' : 'pb-3 text-[12.5px] font-semibold text-text-muted'

export function PeopleDiscovery() {
  const navigate = useNavigate()
  const { signOutUser } = useAuth()
  const { items, loading, error, toggleConnect } = usePersonSuggestions(DISCOVERY_LIMIT)

  // Deep-linkable from the notification bell (a followRequest notification
  // routes here with ?tab=requests) — same pattern Profile.tsx's own ?tab=
  // deep link uses.
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(searchParams.get('tab') === 'requests' ? 'requests' : 'discover')

  // Real bug (same class as Profile.tsx's own ?tab= fix): a followRequest
  // notification navigates to /people?tab=requests — while already sitting
  // on /people, that's a same-route, query-only navigation, so this
  // component never unmounts and the useState initializer above (which
  // only runs once) never sees the new ?tab=. This keeps `tab` in sync on
  // every subsequent navigation too. Doesn't fight the tab buttons below —
  // those call setTab directly without touching the URL.
  useEffect(() => {
    const urlTab = searchParams.get('tab')
    if (urlTab === 'requests' || urlTab === 'discover') {
      setTab(urlTab)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Moved here from Settings' Privacy section (2026-09-09) — approving/
  // denying who follows you is a people-management action, not a settings
  // toggle; the toggle that gates whether requests exist at all
  // ("Approve followers manually") stays in Settings, this list doesn't.
  const [followRequests, setFollowRequests] = useState<FollowRequest[] | null>(null)
  const [followRequestsLoading, setFollowRequestsLoading] = useState(false)
  // Per-request guard against a rapid double-click firing two overlapping
  // approve/deny calls for the same requester, same pattern used for the
  // event join-request Approve/Deny buttons.
  const [actingOnRequest, setActingOnRequest] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (tab !== 'requests' || followRequests !== null || followRequestsLoading) return
    setFollowRequestsLoading(true)
    getFollowRequests()
      .then((res) => setFollowRequests(res.items))
      .catch(() => {
        // A minor section on a page that already loaded successfully — not
        // worth an error state of its own.
      })
      .finally(() => setFollowRequestsLoading(false))
  }, [tab, followRequests, followRequestsLoading])

  async function handleApprove(requesterUid: string) {
    if (actingOnRequest.has(requesterUid)) return
    setActingOnRequest((prev) => new Set(prev).add(requesterUid))
    try {
      await approveFollowRequest(requesterUid)
      setFollowRequests((prev) => (prev ? prev.filter((r) => r.uid !== requesterUid) : prev))
    } catch {
      // Leaves the request in the list — the next Approve click just retries.
    } finally {
      setActingOnRequest((prev) => {
        const next = new Set(prev)
        next.delete(requesterUid)
        return next
      })
    }
  }

  async function handleDeny(requesterUid: string) {
    if (actingOnRequest.has(requesterUid)) return
    setActingOnRequest((prev) => new Set(prev).add(requesterUid))
    try {
      await denyFollowRequest(requesterUid)
      setFollowRequests((prev) => (prev ? prev.filter((r) => r.uid !== requesterUid) : prev))
    } catch {
      // Leaves the request in the list — the next Deny click just retries.
    } finally {
      setActingOnRequest((prev) => {
        const next = new Set(prev)
        next.delete(requesterUid)
        return next
      })
    }
  }

  return (
    <div className="flex min-h-svh bg-bg text-text lg:h-svh">
      <Sidebar active="people" />

      <main className="min-w-0 flex-1 pb-6 lg:flex lg:flex-col lg:pb-0">
        <AppHeader onSignOut={() => void signOutUser()} />
        <header className="flex items-center gap-3 border-b border-border-soft px-5 py-4 lg:hidden">
          <h1 className="text-[17px] font-bold text-text">People</h1>
        </header>

        <div className="flex gap-5 border-b border-border-soft px-5 pt-3 lg:px-7">
          <button type="button" onClick={() => setTab('discover')} className={tabButtonClass(tab === 'discover')}>
            Discover
          </button>
          <button type="button" onClick={() => setTab('requests')} className={tabButtonClass(tab === 'requests')}>
            Requests
          </button>
        </div>

        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-5 py-6 lg:px-7">
            {tab === 'discover' && (
              <>
                {loading && <p className="text-sm text-text-muted">Loading…</p>}
                {error && (
                  <p role="alert" className="text-sm text-red-400">
                    {error}
                  </p>
                )}
                {!loading && !error && items.length === 0 && <p className="text-sm text-text-muted">No suggestions yet — check back soon.</p>}
                {!loading && !error && items.length > 0 && (
                  <ul className="flex flex-wrap gap-3 lg:flex-col lg:gap-3.5">
                    {items.map((person) => (
                      <PersonSuggestionCard
                        key={person.uid}
                        person={person}
                        onOpenProfile={(uid) => navigate(`/profile/${uid}`)}
                        onToggleConnect={toggleConnect}
                        detailed
                      />
                    ))}
                  </ul>
                )}
              </>
            )}

            {tab === 'requests' && (
              <>
                {followRequestsLoading && followRequests === null && <p className="text-sm text-text-muted">Loading…</p>}
                {followRequests !== null && followRequests.length === 0 && <p className="text-sm text-text-muted">No pending requests.</p>}
                {followRequests !== null && followRequests.length > 0 && (
                  <ul className="flex flex-col gap-2.5">
                    {followRequests.map((request) => (
                      <li
                        key={request.uid}
                        className="flex items-center justify-between gap-2.5 rounded-2xl border border-border-soft bg-surface px-4 py-3"
                      >
                        <button type="button" onClick={() => navigate(`/profile/${request.uid}`)} className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-full border border-[rgba(124,140,166,0.32)] bg-[rgba(124,140,166,0.14)] text-[12px] font-bold text-[#9BABC4]">
                            {request.photoURL ? (
                              <img src={request.photoURL} alt="" className="h-full w-full object-cover" />
                            ) : (
                              request.displayName.charAt(0).toUpperCase()
                            )}
                          </span>
                          <span className="min-w-0 truncate text-[13px] font-semibold text-text">{request.displayName}</span>
                        </button>
                        <div className="flex flex-none gap-2">
                          <button
                            type="button"
                            disabled={actingOnRequest.has(request.uid)}
                            onClick={() => handleApprove(request.uid)}
                            className="rounded-lg bg-accent px-3 py-1.5 text-[11.5px] font-bold text-bg disabled:opacity-60"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={actingOnRequest.has(request.uid)}
                            onClick={() => handleDeny(request.uid)}
                            className="rounded-lg border border-border px-3 py-1.5 text-[11.5px] font-bold text-text disabled:opacity-60"
                          >
                            Deny
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>

        <MobileTabBar active="people" />
      </main>
    </div>
  )
}
