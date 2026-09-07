import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getTopFollowedPeople, type TopFollowedPerson } from '../services/movieApi'

function followerLabel(count: number): string {
  return count === 1 ? '1 follower' : `${count} followers`
}

// Guest-only right-rail teaser for the "People you might vibe with" feature
// (Home's own PeopleYouMightVibeWith, signed-in only). Used to be a skeleton
// forever — no fetch ever ran, so it read as permanently stuck loading, not
// as an honest "sign in to see this." Now it fetches real top-followed users
// (GET /discover/people) and shows them for real: no fabricated names or
// match percentages (there's no real matching without an account to match
// against — that part hasn't changed), just genuine follower counts as
// social proof, LinkedIn-"who's on the platform"-style. Falls back to the
// original CTA-only state when there's nothing real to show yet, or the
// fetch fails — never an error or fake data in front of a guest.
export function DiscoverPeopleTeaser() {
  const navigate = useNavigate()
  const [items, setItems] = useState<TopFollowedPerson[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getTopFollowedPeople()
      .then((res) => {
        if (!cancelled) setItems(res.items)
      })
      .catch(() => {
        // A guest never sees an error here — same effect as "nothing to show".
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <section>
        <h2 className="mb-3.5 text-[13.5px] font-bold text-text">People you might vibe with</h2>
        <ul className="flex flex-col gap-3.5">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-2.5">
              <div className="h-9.5 w-9.5 flex-none animate-pulse rounded-full bg-surface-alt" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="h-2.5 w-2/3 animate-pulse rounded-full bg-surface-alt" />
                <div className="h-2 w-2/5 animate-pulse rounded-full bg-surface-alt" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    )
  }

  if (items.length === 0) {
    return (
      <section>
        <h2 className="mb-3.5 text-[13.5px] font-bold text-text">People you might vibe with</h2>
        <button
          type="button"
          onClick={() => navigate('/get-started')}
          className="w-full cursor-pointer rounded-[10px] border border-accent py-2.5 text-[12px] font-bold text-accent"
        >
          Sign up / sign in to view
        </button>
      </section>
    )
  }

  return (
    <section>
      <h2 className="mb-3.5 text-[13.5px] font-bold text-text">People you might vibe with</h2>
      <ul className="flex flex-col gap-3.5">
        {items.map((person) => (
          <li key={person.uid} className="flex items-center gap-2.5">
            <div className="flex h-9.5 w-9.5 flex-none items-center justify-center rounded-full border border-[rgba(124,140,166,0.32)] bg-[rgba(124,140,166,0.14)] text-[13px] font-bold text-[#9BABC4]">
              {person.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-bold text-text">{person.displayName}</div>
              <div className="text-[10.5px] text-text-muted">{followerLabel(person.followerCount)}</div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/get-started')}
              className="flex-none rounded-[9px] border border-accent bg-transparent px-3 py-1.5 text-[11px] font-bold text-accent"
            >
              Sign in to connect
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
