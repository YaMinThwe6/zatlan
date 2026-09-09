import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMe, type Me } from '../lib/api'
import { NotificationBell } from './NotificationBell'

interface Props {
  onSignOut: () => void
  // Optional: when a caller already owns a live-updating `me` (e.g. Settings,
  // threaded from App.tsx's own state), pass it here so this header reflects
  // a change — a saved displayName, say — the same render, not just on next
  // mount. QA (docs/qa/settings-bugs.md #1) found this genuinely stale
  // otherwise: AppHeader's own one-time fetch below never observed a caller's
  // state updating, even on the very page that made the change. Omit it (as
  // MovieDetail.tsx/Profile.tsx currently do — neither has `me` in scope from
  // App.tsx) and this falls back to fetching its own copy, unchanged.
  me?: Me
}

// The desktop-only top bar every signed-in page inside the Sidebar shell
// shares — HomeDesktop.dc.html originated this design, and Desktop.dc.html
// (movie detail) reuses the identical bar, not a bespoke one per page.
// (Home.tsx predates this component and still owns its own mobile+desktop
// header inline — a candidate to migrate onto this later, not done here to
// keep this change scoped to what was actually asked.)
export function AppHeader({ onSignOut, me: meProp }: Props) {
  const navigate = useNavigate()
  const [fetchedMe, setFetchedMe] = useState<Me | null>(null)

  useEffect(() => {
    if (meProp) return // caller already supplies a live `me` — nothing to fetch
    let cancelled = false
    getMe()
      .then((res) => {
        if (!cancelled) setFetchedMe(res)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // Only re-runs if a caller starts/stops supplying `me` — not on every
    // change of its value, which would just refetch pointlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!meProp])

  const me = meProp ?? fetchedMe
  if (!me) return null // avoid a flash of an empty avatar/name before this resolves

  const initial = (me.displayName || me.email || '?').charAt(0).toUpperCase()

  return (
    <header className="hidden items-center justify-between border-b border-border-soft px-7 py-4.5 lg:flex">
      <button
        type="button"
        onClick={() => navigate('/search')}
        className="flex max-w-[420px] flex-1 items-center gap-2 rounded-[10px] border border-border-soft bg-surface-alt px-3.5 py-2.5 text-left"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-faint" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <span className="text-[12.5px] text-text-faint">Search movies, people, genres…</span>
      </button>

      <div className="flex items-center gap-3.5 pl-4">
        <NotificationBell />
        {/* Replaces Sidebar's old "Profile" nav row — the avatar/name here
            already showed who's signed in, so this is the entry point to
            their own profile now instead of a separate nav item. */}
        <button type="button" onClick={() => navigate(`/profile/${me.uid}`)} className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(var(--accent-rgb),0.35)] bg-[rgba(var(--accent-rgb),0.16)] text-[13px] font-bold text-accent">
            {initial}
          </div>
          <span className="text-[13px] font-semibold text-text">{me.displayName}</span>
        </button>
        <button type="button" onClick={onSignOut} className="text-[12.5px] font-semibold text-text-muted">
          Sign out
        </button>
      </div>
    </header>
  )
}
