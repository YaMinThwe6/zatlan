import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Me } from '../../../lib/api'
import { getNotifications } from '../services/homeApi'
import { GreetingHero } from './GreetingHero'
import { TopPicks } from './TopPicks'
import { PeopleYouMightVibeWith } from './PeopleYouMightVibeWith'
import { BecauseYourFriendsWatched } from './BecauseYourFriendsWatched'
import { UpcomingEvents } from './UpcomingEvents'
import { NearbyEvents } from './NearbyEvents'
import { FriendsAreWatching } from './FriendsAreWatching'
import { Sidebar } from '../../../components/Sidebar'
import { MobileTabBar } from '../../../components/MobileTabBar'

interface Props {
  me: Me
  onSignOut: () => void
}

export function Home({ me, onSignOut }: Props) {
  const navigate = useNavigate()
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    getNotifications(true)
      .then((res) => setUnreadCount(res.items.length))
      .catch(() => setUnreadCount(0))
  }, [])

  const initial = (me.displayName || me.email || '?').charAt(0).toUpperCase()

  return (
    // QA (docs/qa/profile-bugs.md #1 — found on Profile, same bug reproduces
    // here since Profile copied this exact shell): the outer container only
    // set a *minimum* height, so the inner lg:overflow-y-auto column never had
    // a bounded parent to actually scroll within — the whole page scrolled
    // instead, taking Sidebar/AppHeader with it. lg:h-svh caps the row to the
    // viewport; mobile keeps the old min-h-svh (grows freely with content,
    // no sidebar/overflow-y-auto trick applies below lg anyway).
    <div className="flex min-h-svh bg-bg text-text lg:h-svh">
      {/* Desktop-only left nav (design canvas's HomeDesktop.dc.html) — the
          mobile bottom nav below still owns navigation under lg. */}
      <Sidebar active="home" />

      <main className="min-w-0 flex-1 pb-6 lg:flex lg:flex-col lg:pb-0">
        <header className="flex items-center justify-between px-5 pt-4.5 lg:border-b lg:border-border-soft lg:px-7 lg:py-4.5">
          <span className="font-serif text-[22px] font-bold text-accent lg:hidden">BINJ</span>

          <button
            type="button"
            onClick={() => navigate('/search')}
            className="hidden max-w-[420px] flex-1 items-center gap-2 rounded-[10px] border border-border-soft bg-surface-alt px-3.5 py-2.5 text-left lg:flex"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-faint" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <span className="text-[12.5px] text-text-faint">Search movies, people, genres…</span>
          </button>

          <div className="flex items-center gap-3.5">
            <button
              type="button"
              onClick={() => navigate('/search')}
              aria-label="Search"
              className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-border-soft bg-surface-alt lg:hidden"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
            </button>
            <button
              type="button"
              aria-label={`${unreadCount} unread notifications`}
              className="relative flex h-9 w-9 items-center justify-center rounded-[10px] border border-border-soft bg-surface-alt"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary" aria-hidden="true">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent px-1 text-[9.5px] font-bold text-bg">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {/* Real bug: this page has always had its own hand-rolled header
                (predates AppHeader) instead of reusing it, so when
                AppHeader's avatar/name became the entry point to your own
                profile, this copy of the same markup never got that fix —
                the very first page a signed-in user sees had no way to
                reach their profile at all. */}
            <button type="button" onClick={() => navigate(`/profile/${me.uid}`)} className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(var(--accent-rgb),0.35)] bg-[rgba(var(--accent-rgb),0.16)] text-[13px] font-bold text-accent">
                {initial}
              </div>
              <span className="hidden text-[13px] font-semibold text-text lg:inline">{me.displayName}</span>
            </button>
            <button type="button" onClick={onSignOut} className="text-[12.5px] font-semibold text-text-muted">
              Sign out
            </button>
          </div>
        </header>

        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <div className="flex flex-col gap-7 pt-4 lg:grid lg:grid-cols-[1fr_320px] lg:items-start lg:gap-8 lg:px-7 lg:pt-7 lg:pb-10">
            {/* min-w-0 overrides a grid item's default min-width:auto — without
                it this column refuses to shrink below the combined max-content
                width of its horizontally-scrolling carousels (TopPicks etc.),
                which silently blows out the 1fr track past the viewport and
                pushes the 320px right rail into an invisible horizontal-scroll
                region (found live: PeopleYouMightVibeWith rendering correctly
                in the DOM but sitting off-screen at x:2048 on a 1440px-wide
                viewport). */}
            <div className="flex min-w-0 flex-col gap-7 lg:col-start-1 lg:gap-8">
              <GreetingHero displayName={me.displayName} />
              <TopPicks />
              <UpcomingEvents />
              <NearbyEvents />
              <FriendsAreWatching />
            </div>
            <div className="flex flex-col gap-7 lg:col-start-2 lg:row-start-1 lg:gap-8">
              <PeopleYouMightVibeWith />
              <BecauseYourFriendsWatched />
            </div>
          </div>
        </div>

        <MobileTabBar active="home" />
      </main>
    </div>
  )
}
