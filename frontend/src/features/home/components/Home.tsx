import { useNavigate } from 'react-router-dom'
import type { Me } from '../../../lib/api'
import { GreetingHero } from './GreetingHero'
import { TopPicks } from './TopPicks'
import { PeopleYouMightVibeWith } from './PeopleYouMightVibeWith'
import { BecauseYourFriendsWatched } from './BecauseYourFriendsWatched'
import { UpcomingEvents } from './UpcomingEvents'
import { NearbyEvents } from './NearbyEvents'
import { FriendsAreWatching } from './FriendsAreWatching'
import { Sidebar } from '../../../components/Sidebar'
import { AppHeader } from '../../../components/AppHeader'
import { NotificationBell } from '../../../components/NotificationBell'
import { MobileTabBar } from '../../../components/MobileTabBar'

interface Props {
  me: Me
  onSignOut: () => void
}

export function Home({ me, onSignOut }: Props) {
  const navigate = useNavigate()

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
        {/* Mobile-only header — AppHeader below is the shared desktop bar
            every page reuses (logo lives in Sidebar there, not here), same
            split Settings.tsx/Profile.tsx/Notifications.tsx already use. */}
        <header className="flex items-center justify-between px-5 pt-4.5 lg:hidden">
          <span className="font-serif text-[22px] font-bold text-accent">ZATLAN</span>

          <div className="flex items-center gap-3.5">
            <button
              type="button"
              onClick={() => navigate('/search')}
              aria-label="Search"
              className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-border-soft bg-surface-alt"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
            </button>
            <NotificationBell />
            {/* Real bug: this page has always had its own hand-rolled header
                (predates AppHeader) instead of reusing it, so when
                AppHeader's avatar/name became the entry point to your own
                profile, this copy of the same markup never got that fix —
                the very first page a signed-in user sees had no way to
                reach their profile at all. */}
            <button type="button" onClick={() => navigate(`/profile/${me.uid}`)} aria-label={me.displayName} className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(var(--accent-rgb),0.35)] bg-[rgba(var(--accent-rgb),0.16)] text-[13px] font-bold text-accent">
                {initial}
              </div>
            </button>
            <button type="button" onClick={onSignOut} className="text-[12.5px] font-semibold text-text-muted">
              Sign out
            </button>
          </div>
        </header>

        {/* Desktop-only shared bar — logo/left nav come from Sidebar, this is
            search/notifications/avatar/sign-out, same component every other
            signed-in page renders (Settings.tsx, Profile.tsx, EventsPage.tsx,
            etc.) so the app shell is identical everywhere instead of each
            page hand-rolling its own. */}
        <AppHeader me={me} onSignOut={onSignOut} />

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
