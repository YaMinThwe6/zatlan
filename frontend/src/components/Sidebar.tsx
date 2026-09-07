import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMe } from '../lib/api'

interface NavItem {
  label: string
  active?: boolean
  disabled?: boolean
  icon: React.ReactNode
  onClick?: () => void
}

function NavRow({ label, active, disabled, icon, onClick }: NavItem) {
  const content = (
    <span
      className={
        active
          ? 'flex items-center gap-2.5 rounded-[10px] bg-[rgba(var(--accent-rgb),0.12)] px-2.5 py-2.5 text-[13px] font-bold text-accent'
          : disabled
            ? 'flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-[13px] font-semibold text-text-faint'
            : 'flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-[13px] font-semibold text-text-secondary'
      }
    >
      {icon}
      {label}
    </span>
  )
  if (disabled) {
    return (
      <div title="Coming soon" className="cursor-default">
        {content}
      </div>
    )
  }
  return (
    <button type="button" onClick={onClick} className="w-full cursor-pointer text-left">
      {content}
    </button>
  )
}

// Desktop-only left nav shell (design canvas's HomeDesktop.dc.html) — the
// mobile bottom-nav (MobileTabBar) stays the nav surface below lg. Shared by
// every top-level signed-in page so they read as one app rather than
// separate screens; `active` highlights the current one. Only Home/Search/
// Profile are wired to real navigation; the rest mirror the same
// "Coming soon" disabled treatment the mobile bottom nav already uses.
export function Sidebar({ active = 'home' }: { active?: 'home' | 'search' | 'events' | 'profile' | 'settings' }) {
  const navigate = useNavigate()
  // Self-sufficient fetch, same pattern as AppHeader's own `getMe()` call —
  // the Profile nav row below needs the caller's own uid to link to
  // "/profile/:uid", which this component otherwise has no reason to know.
  const [myUid, setMyUid] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    getMe()
      .then((me) => {
        if (!cancelled) setMyUid(me.uid)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return (
    <aside className="hidden w-58 flex-none flex-col gap-7 border-r border-border-soft px-4.5 py-6 lg:flex">
      <div>
        <span className="font-serif text-[22px] font-bold text-accent">BINJ</span>
        <p className="mt-1.5 text-[11px] leading-snug text-text-muted">
          Find your movie.
          <br />
          Find your people.
        </p>
      </div>

      <nav className="flex flex-col gap-0.5">
        <NavRow
          label="Home"
          active={active === 'home'}
          onClick={() => navigate('/')}
          icon={
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 11l9-8 9 8" />
              <path d="M5 10v10h14V10" />
            </svg>
          }
        />
        <NavRow
          label="Search"
          active={active === 'search'}
          onClick={() => navigate('/search')}
          icon={
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
          }
        />
        <NavRow
          label="Events"
          active={active === 'events'}
          onClick={() => navigate('/events')}
          icon={
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
          }
        />
        <NavRow
          label="People"
          disabled
          icon={
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
              <circle cx="10" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          }
        />
        <NavRow
          label="Inbox"
          disabled
          icon={
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4 8.6 8.6 0 0 1-3.6-.8L3 20l1-4.9A8.4 8.4 0 1 1 21 11.5z" />
            </svg>
          }
        />
        <NavRow
          label="Profile"
          active={active === 'profile'}
          onClick={myUid ? () => navigate(`/profile/${myUid}`) : undefined}
          icon={
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
            </svg>
          }
        />
      </nav>

      <nav className="flex flex-col gap-0.5">
        <div className="mb-1.5 px-2.5 text-[11px] font-bold tracking-wider text-text-faint uppercase">My Movies</div>
        <NavRow
          label="Watchlist"
          disabled
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
            </svg>
          }
        />
        <NavRow
          label="Watched"
          disabled
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M8.5 12.5l2.3 2.3 4.7-5.1" />
            </svg>
          }
        />
        <NavRow
          label="Ratings & Reviews"
          disabled
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.6 6.1 20.6l1.3-6.6-4.9-4.6 6.6-.8z" />
            </svg>
          }
        />
      </nav>

      <div className="mt-auto flex flex-col gap-0.5 border-t border-border-soft pt-3">
        <NavRow
          label="Settings"
          active={active === 'settings'}
          onClick={() => navigate('/settings')}
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          }
        />
        <NavRow
          label="Our Story"
          onClick={() => navigate('/story')}
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
          }
        />
      </div>
    </aside>
  )
}
