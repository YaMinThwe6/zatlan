import { useNavigate } from 'react-router-dom'

// Mobile/tablet bottom nav (below lg — the Sidebar owns nav from lg up).
// Shared by the signed-in top-level pages so switching between them keeps the
// same nav surface; `active` marks the current tab. Inbox still mirrors the
// Sidebar's "Coming soon" disabled treatment. 'profile' isn't one of this
// bar's own tabs (Profile has no Home/Search-style icon here, same as
// Sidebar's own nav doesn't duplicate itself) — passing it just means neither
// Home nor Search should show as active, both render as ordinary buttons.
export function MobileTabBar({ active }: { active: 'home' | 'search' | 'events' | 'people' | 'profile' }) {
  const navigate = useNavigate()

  const tab = (on: boolean) =>
    on
      ? 'flex flex-col items-center gap-1 text-[10px] font-bold text-accent'
      : 'flex flex-col items-center gap-1 text-[10px] font-semibold text-text-muted'

  return (
    <>
      <nav className="mt-7 flex items-center justify-around border-t border-border-soft px-2 pt-5 lg:hidden">
        {active === 'home' ? (
          <span className={tab(true)}>Home</span>
        ) : (
          <button type="button" onClick={() => navigate('/')} className={tab(false)}>
            Home
          </button>
        )}
        {active === 'search' ? (
          <span className={tab(true)}>Search</span>
        ) : (
          <button type="button" onClick={() => navigate('/search')} className={tab(false)}>
            Search
          </button>
        )}
        {active === 'events' ? (
          <span className={tab(true)}>Events</span>
        ) : (
          <button type="button" onClick={() => navigate('/events')} className={tab(false)}>
            Events
          </button>
        )}
        {active === 'people' ? (
          <span className={tab(true)}>People</span>
        ) : (
          <button type="button" onClick={() => navigate('/people')} className={tab(false)}>
            People
          </button>
        )}
        <span className="flex flex-col items-center gap-1 text-[10px] font-semibold text-text-faint" title="Coming soon">
          Inbox
        </span>
      </nav>

      <button
        type="button"
        onClick={() => navigate('/story')}
        className="mt-4 block text-center text-[10.5px] font-semibold text-text-faint underline lg:hidden"
      >
        Our Story
      </button>
    </>
  )
}
