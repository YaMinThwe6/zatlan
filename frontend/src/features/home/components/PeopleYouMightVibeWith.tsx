import { useNavigate } from 'react-router-dom'
import { usePersonSuggestions } from '../hooks/usePersonSuggestions'
import { PersonSuggestionCard } from '../../../components/PersonSuggestionCard'

export function PeopleYouMightVibeWith() {
  const navigate = useNavigate()
  const { items, loading, error, toggleConnect } = usePersonSuggestions()

  if (loading)
    return (
      <section>
        <h2 className="mb-3 px-5 text-[15px] font-bold text-text lg:px-0 lg:text-[13.5px]">People you might vibe with</h2>
        <p className="px-5 text-sm text-text-muted lg:px-0">Loading…</p>
      </section>
    )
  if (error)
    return (
      <section>
        <h2 className="mb-3 px-5 text-[15px] font-bold text-text lg:px-0 lg:text-[13.5px]">People you might vibe with</h2>
        <p role="alert" className="px-5 text-sm text-red-400 lg:px-0">
          {error}
        </p>
      </section>
    )
  if (items.length === 0) return null

  return (
    <section>
      <h2 className="mb-3 px-5 text-[15px] font-bold text-text lg:px-0 lg:text-[13.5px]">People you might vibe with</h2>
      {/* Horizontal card row below lg (main-column context); a compact
          vertical list at lg+ (right-rail context, HomeDesktop.dc.html) —
          one mount, one fetch, purely a CSS layout switch. */}
      <ul className="flex gap-3 overflow-x-auto px-5 pb-1 lg:flex-col lg:gap-3.5 lg:overflow-visible lg:px-0 lg:pb-0">
        {items.map((person) => (
          <PersonSuggestionCard key={person.uid} person={person} onOpenProfile={(uid) => navigate(`/profile/${uid}`)} onToggleConnect={toggleConnect} />
        ))}
      </ul>
    </section>
  )
}
