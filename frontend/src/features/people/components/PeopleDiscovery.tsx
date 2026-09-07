import { useNavigate } from 'react-router-dom'
import { usePersonSuggestions } from '../../home/hooks/usePersonSuggestions'
import { PersonSuggestionCard } from '../../../components/PersonSuggestionCard'
import { Sidebar } from '../../../components/Sidebar'
import { MobileTabBar } from '../../../components/MobileTabBar'

// The full-page counterpart to Home's "People you might vibe with" widget —
// same usePersonSuggestions pipeline, just a wider limit (30 vs the widget's
// default 10) since this page has room for a real list rather than a rail
// preview. Unlike the widget (which disappears entirely when there are no
// suggestions), this page always shows something explicit: the backend's
// suggested-tier catch-all means an empty result here should only happen
// when there's truly no one else to suggest yet.
const DISCOVERY_LIMIT = 30

export function PeopleDiscovery() {
  const navigate = useNavigate()
  const { items, loading, error, toggleConnect } = usePersonSuggestions(DISCOVERY_LIMIT)

  return (
    <div className="flex min-h-svh bg-bg text-text lg:h-svh">
      <Sidebar active="people" />

      <main className="min-w-0 flex-1 pb-6 lg:flex lg:flex-col lg:pb-0">
        <header className="flex items-center gap-3 border-b border-border-soft px-5 py-4 lg:px-7">
          <h1 className="text-[17px] font-bold text-text">People</h1>
        </header>

        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-5 py-6 lg:px-7">
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
                  <PersonSuggestionCard key={person.uid} person={person} onOpenProfile={(uid) => navigate(`/profile/${uid}`)} onToggleConnect={toggleConnect} />
                ))}
              </ul>
            )}
          </div>
        </div>

        <MobileTabBar active="people" />
      </main>
    </div>
  )
}
