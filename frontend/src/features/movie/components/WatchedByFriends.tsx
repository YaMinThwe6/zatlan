import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMovieWatchedBy, type WatchedByEntry } from '../services/movieApi'

interface Props {
  movieId: string
  // Whether the caller has watched this movie themself — decides which of
  // the two empty-state invites below to show (mark it watched vs. invite a
  // friend), so the slot is never just apologizing for being empty.
  watched: boolean
  onMarkWatched: () => void
  onInviteFriend: () => void
}

// hld.md §5a — only people the caller follows, never a global "everyone who
// watched this" list.
//
// This section used to return null outright when there was nothing to show
// (caller follows no one, none of them watched it, or privacy hides it) —
// but the wrapping column in MovieDetail.tsx renders regardless, so that
// left a genuinely empty column next to "About" rather than nothing at all.
// Rather than just closing that gap or apologizing for the emptiness, this
// turns it into the one useful thing to do next: mark it watched yourself
// (the more common case — most movies won't already be watched by anyone
// you follow), or, if you've already seen it, invite someone to a watch
// party. Loading/error still render nothing — this is a minor social
// section, not worth an error state of its own.
export function WatchedByFriends({ movieId, watched, onMarkWatched, onInviteFriend }: Props) {
  const navigate = useNavigate()
  const [items, setItems] = useState<WatchedByEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getMovieWatchedBy(movieId)
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [movieId])

  if (loading || error) return null

  if (items.length === 0) {
    return (
      <section>
        <h2 className="mb-3 text-[15px] font-bold text-text">People you follow who watched this</h2>
        {watched ? (
          <>
            <p className="mb-3 text-[13px] text-text-secondary">You&rsquo;ve watched this — none of your friends have yet. Invite one to a watch party?</p>
            <button type="button" onClick={onInviteFriend} className="rounded-lg border border-accent px-3.5 py-2 text-[12px] font-bold text-accent">
              Invite a friend
            </button>
          </>
        ) : (
          <>
            <p className="mb-3 text-[13px] text-text-secondary">None of your friends have watched this yet — be the first.</p>
            <button type="button" onClick={onMarkWatched} className="rounded-lg bg-accent px-3.5 py-2 text-[12px] font-bold text-bg">
              Mark as watched
            </button>
          </>
        )}
      </section>
    )
  }

  return (
    <section>
      <h2 className="mb-3 text-[15px] font-bold text-text">People you follow who watched this</h2>
      <ul className="flex gap-4 overflow-x-auto pb-0.5">
        {items.map((person) => (
          <li key={person.uid} className="w-16 flex-none text-center">
            <button type="button" onClick={() => navigate(`/profile/${person.uid}`)} className="flex w-full flex-col items-center gap-1.5">
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[rgba(124,140,166,0.32)] bg-[rgba(124,140,166,0.14)] text-[13px] font-bold text-[#9BABC4]">
                {person.displayName.charAt(0)}
              </span>
              <span className="text-[11px] font-semibold text-text">{person.displayName}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
