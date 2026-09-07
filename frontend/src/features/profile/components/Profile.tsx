import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getUserProfile, type PublicProfile } from '../services/profileApi'
import { followUser, unfollowUser } from '../../home/services/homeApi'
import { posterUrl } from '../../../lib/images'
import { useAuth } from '../../../lib/AuthContext'
import { Sidebar } from '../../../components/Sidebar'
import { AppHeader } from '../../../components/AppHeader'
import { MobileTabBar } from '../../../components/MobileTabBar'

const COMING_SOON_TABS = ['Watched', 'Watchlist', 'Reviews', 'Events']

function connectLabel(relationship: PublicProfile['relationship']): string {
  if (relationship === 'following') return 'Following'
  if (relationship === 'pending') return 'Requested'
  return 'Connect'
}

function formatWatchedAt(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatJoined(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

// Mirrors the design canvas's "2h ago" / "1d ago" copy on Recent Activity
// (MyProfile.dc.html / OtherUserProfile.dc.html) — falls back to an absolute
// date past a month out, same as most activity feeds, rather than "4w ago"
// drifting indefinitely.
function formatRelativeTime(iso: string | null): string {
  if (!iso) return ''
  const diffMs = Math.max(0, Date.now() - new Date(iso).getTime())
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  return formatWatchedAt(iso)
}

// Taste-match "progress ring" geometry — a real proportional SVG ring
// (design canvas's dc-script draws it via stroke-dasharray/stroke-dashoffset
// on a fixed r=30/36 circle) rather than a flat, score-independent circle.
const TASTE_RING_RADIUS = 28
const TASTE_RING_CIRCUMFERENCE = 2 * Math.PI * TASTE_RING_RADIUS

function tasteMatchRingOffset(score: number): number {
  return TASTE_RING_CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, score)) / 100)
}

// >=70 mirrors the design canvas's "Great match!" copy on both the mobile and
// desktop OtherUserProfile artboards — the only threshold the mockup actually
// shows a value for, so the lower bands are this component's own judgment
// call about a mid/low score, not a value taken from the mockup.
function tasteMatchLabel(score: number): string {
  if (score >= 70) return 'Great match!'
  if (score >= 40) return 'Some overlap'
  return 'Different tastes'
}

function ActivityLine({ item }: { item: PublicProfile['recentActivity'][number] }) {
  const navigate = useNavigate()
  const title = item.movieTitle ?? 'a movie'
  return (
    <li>
      <button type="button" onClick={() => navigate(`/movie/${item.movieId}`)} className="flex w-full items-center gap-3 text-left">
        <div className="h-10 w-10 flex-none overflow-hidden rounded-lg bg-surface-alt">
          {item.moviePoster && <img src={posterUrl(item.moviePoster, 'w92') ?? undefined} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] text-text">
            {item.type === 'watched' ? 'Watched ' : 'Added '}
            <span className="font-bold">{title}</span>
            {item.type === 'watchlist_added' && ' to watchlist'}
          </p>
          <p className="mt-0.5 text-[11px] text-text-muted">{formatRelativeTime(item.createdAt)}</p>
        </div>
      </button>
    </li>
  )
}

// hld.md §5c — the destination "people who watched this"/"taste match" cards
// now link to, and the frontend's read of the same privacy-filtered public
// profile the backend computes (api-contracts.md §11b). Follow/unfollow
// reuses homeApi's calls rather than re-implementing them — same backend
// endpoints as PeopleYouMightVibeWith's Connect button.
//
// Matches the design canvas's MyProfile/MyProfileDesktop and
// OtherUserProfile/OtherUserProfileDesktop artboards. Only ever mounted
// signed-in (App.tsx has no "/profile/:uid" route in the guest table), so —
// like MovieDetail's signed-in branch — this always renders the desktop
// Sidebar+AppHeader shell, no guest path to gate on.
//
// A few artboard elements are deliberately not implemented here because no
// real data or feature exists behind them yet (no placeholders standing in
// for unbuilt systems): the identity quote/About bio and social links (no
// bio field exists anywhere in the app), location (never collected), Top
// Movies and the self "Taste Profile" donut (no rating-ranked list or
// taste-profile algorithm exists), Upcoming Events (this page doesn't own
// that data), and the blocked-account scenario (no blocking feature exists
// in this codebase). Edit Profile and the message/compose action are shown
// disabled with "Coming soon", the same treatment Sidebar's own
// not-yet-built nav rows already use, rather than wiring a button to nothing.
export function Profile() {
  // Only ever mounted via the "/profile/:uid" route (App.tsx), so this
  // segment is always present in practice — the assertion just tells
  // TypeScript what the route already guarantees.
  const { uid: uidParam } = useParams<{ uid: string }>()
  const uid = uidParam!
  const navigate = useNavigate()
  const { signOutUser } = useAuth()
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [error, setError] = useState('')
  // QA (docs/qa/profile-bugs.md #5): Connect/Following had no in-flight guard,
  // so a fast double-click fired two overlapping follow/unfollow requests.
  const [connectPending, setConnectPending] = useState(false)

  useEffect(() => {
    setProfile(null)
    setError('')
    getUserProfile(uid)
      .then(setProfile)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load profile'))
  }, [uid])

  async function toggleConnect() {
    if (!profile || connectPending) return
    const previous = profile.relationship
    setConnectPending(true)

    // QA #3: the button flipped state immediately but Followers kept showing
    // its stale count until a reload — patch the counter optimistically too,
    // right alongside relationship, not just the button label.
    if (previous === 'none') {
      setProfile({ ...profile, relationship: 'pending', followerCount: profile.followerCount + 1 })
      try {
        const { status } = await followUser(uid)
        setProfile((prev) => (prev ? { ...prev, relationship: status } : prev))
      } catch (err) {
        setProfile((prev) => (prev ? { ...prev, relationship: 'none', followerCount: prev.followerCount - 1 } : prev))
        setError(err instanceof Error ? err.message : 'Failed to connect')
      }
    } else {
      setProfile({ ...profile, relationship: 'none', followerCount: Math.max(0, profile.followerCount - 1) })
      try {
        await unfollowUser(uid)
      } catch (err) {
        setProfile((prev) => (prev ? { ...prev, relationship: previous, followerCount: prev.followerCount + 1 } : prev))
        setError(err instanceof Error ? err.message : 'Failed to update')
      }
    }
    setConnectPending(false)
  }

  if (error && !profile) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-bg px-6 text-text">
        <button type="button" onClick={() => navigate(-1)} className="self-start text-sm font-semibold text-text-secondary">
          ← Back
        </button>
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      </main>
    )
  }

  if (!profile) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-bg text-text">
        <p className="text-sm text-text-muted">Loading…</p>
      </main>
    )
  }

  const isSelf = profile.relationship === 'self'
  const connectButton = connectLabel(profile.relationship)
  const showTasteMatch = !isSelf && profile.tasteMatchScore !== null
  const joined = formatJoined(profile.joinedAt)

  const content = (
    <div className="lg:mx-auto lg:max-w-5xl lg:px-8 lg:pt-8">
      {/* banner */}
      <div
        className="relative h-24 w-full overflow-hidden lg:h-45 lg:rounded-2xl"
        style={{
          background:
            'radial-gradient(120% 90% at 85% 5%, rgba(150,170,200,0.14), transparent 55%), radial-gradient(100% 80% at 15% 95%, rgba(var(--accent-rgb),0.2), transparent 55%), linear-gradient(180deg, #1B1720 0%, #100E12 100%)'
        }}
      >
        <div className="absolute top-4 left-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-white/10 bg-black/55 lg:hidden"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#F3F1ED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Back"
        className="hidden h-10 w-10 items-center justify-center rounded-full border border-border-soft bg-surface-alt lg:mt-6 lg:flex"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      {/* identity — centered stack on mobile, a left-aligned row on desktop */}
      <div className="-mt-13 flex flex-col items-center px-6 text-center lg:mt-6 lg:flex-row lg:items-end lg:justify-between lg:px-0 lg:text-left">
        <div className="flex flex-col items-center text-center lg:flex-row lg:items-end lg:gap-5 lg:text-left">
          <div className="flex h-[104px] w-[104px] flex-none items-center justify-center overflow-hidden rounded-full border-4 border-bg bg-[rgba(var(--accent-rgb),0.16)] lg:h-30 lg:w-30">
            {profile.photoURL ? (
              <img src={profile.photoURL} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="font-serif text-[32px] font-semibold text-accent lg:text-[38px]">{profile.displayName.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="lg:pb-1.5">
            <h1 className="mt-3.5 font-serif text-[23px] font-semibold text-white lg:mt-0 lg:text-[27px]">{profile.displayName}</h1>
            {profile.username && <p className="mt-0.5 text-[12.5px] text-text-muted lg:text-[13px]">@{profile.username}</p>}
            {joined && <p className="mt-1.5 text-[11.5px] text-text-muted lg:text-[12px]">Joined {joined}</p>}
          </div>
        </div>

        <div className="mt-4.5 flex items-center gap-2.5 lg:mt-0">
          {isSelf ? (
            <button type="button" disabled title="Coming soon" className="min-w-[150px] cursor-default rounded-xl border border-border bg-surface-alt px-6 py-3 text-[13.5px] font-bold text-text-faint">
              Edit Profile
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={toggleConnect}
                disabled={connectPending}
                className={
                  connectButton === 'Connect'
                    ? 'min-w-[150px] rounded-xl bg-accent px-6 py-3 text-[13.5px] font-bold text-bg disabled:opacity-70'
                    : connectButton === 'Following'
                      ? 'min-w-[150px] rounded-xl border border-accent bg-transparent px-6 py-3 text-[13.5px] font-bold text-accent disabled:opacity-70'
                      : 'min-w-[150px] rounded-xl border border-border bg-surface-alt px-6 py-3 text-[13.5px] font-bold text-text-muted disabled:opacity-70'
                }
              >
                {connectButton}
              </button>
              <button
                type="button"
                disabled
                title="Coming soon"
                aria-label="Message"
                className="flex h-11 w-11 flex-none cursor-default items-center justify-center rounded-xl border border-border bg-input text-text-faint"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {/* QA #4: this was the Share glyph, not a message/chat icon —
                      same chat-bubble path Sidebar's own Inbox row uses. */}
                  <path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4 8.6 8.6 0 0 1-3.6-.8L3 20l1-4.9A8.4 8.4 0 1 1 21 11.5z" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* stats */}
      <div data-testid="profile-stats" className="mt-5 flex w-full border-t border-b border-border-soft px-6 py-3.5 lg:mt-6 lg:w-auto lg:gap-11 lg:border-none lg:px-0 lg:py-0">
        {(
          [
            ['Watched', profile.watchedCount],
            ['Watchlist', profile.watchlistCount],
            ['Reviews', profile.reviewCount],
            ['Following', profile.followingCount],
            ['Followers', profile.followerCount]
          ] as const
        ).map(([label, value], i) => (
          <div key={label} className={i === 0 ? 'flex-1 lg:flex-none' : 'flex-1 border-l border-border-soft lg:flex-none lg:border-none'}>
            <div className="text-[15px] font-bold text-text lg:text-[19px]">{value}</div>
            <div className="mt-0.5 text-[9.5px] text-text-muted lg:text-[11px]">{label}</div>
          </div>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-4 px-6 text-center text-[13px] text-red-400 lg:px-0 lg:text-left">
          {error}
        </p>
      )}

      {/* tabs — only Overview has content behind it; the rest mirror Sidebar's
          own "Coming soon" disabled treatment for features not built yet. */}
      <div role="tablist" aria-label="Profile sections" className="mt-5 flex w-full gap-4 border-b border-border-soft px-6 lg:mt-6 lg:w-auto lg:gap-7 lg:px-0">
        <button type="button" role="tab" aria-selected="true" className="cursor-default border-b-2 border-accent pb-2.5 text-[12.5px] font-bold text-accent lg:pb-3 lg:text-[13.5px]">
          Overview
        </button>
        {COMING_SOON_TABS.map((label) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected="false"
            disabled
            title="Coming soon"
            className="cursor-default pb-2.5 text-[12.5px] font-semibold text-text-muted lg:pb-3 lg:text-[13.5px]"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="lg:grid lg:grid-cols-2 lg:gap-8 lg:pt-6">
        {profile.topGenres.length > 0 && (
          <section className="px-6 pt-6 text-left lg:px-0 lg:pt-0">
            <h2 className="mb-1 text-[13.5px] font-bold text-text">Favorite Genres</h2>
            <p className="mb-3 text-[10.5px] text-text-faint">Based on {profile.watchedCount} watched movies</p>
            <div className="flex flex-col gap-2.5">
              {profile.topGenres.map((g) => (
                <div key={g.genre} className="flex justify-between text-[12.5px]">
                  <span className="text-text-secondary">{g.genre}</span>
                  <span className="font-bold text-accent">{g.percent}%</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {showTasteMatch && (
          <section className="mx-6 mt-6 rounded-2xl border border-border-soft bg-surface-alt p-5 text-left lg:mx-0">
            <h2 className="mb-3.5 text-[14px] font-bold text-text">Taste Match with you</h2>
            <div className="flex items-center gap-4">
              <svg width="72" height="72" viewBox="0 0 72 72" className="flex-none">
                <circle cx="36" cy="36" r={TASTE_RING_RADIUS} fill="none" strokeWidth="7" className="stroke-border-soft" />
                <circle
                  data-testid="taste-match-progress"
                  cx="36"
                  cy="36"
                  r={TASTE_RING_RADIUS}
                  fill="none"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={TASTE_RING_CIRCUMFERENCE}
                  strokeDashoffset={tasteMatchRingOffset(profile.tasteMatchScore!)}
                  transform="rotate(-90 36 36)"
                  className="stroke-accent"
                />
                <text x="36" y="41" textAnchor="middle" className="fill-text text-[15px] font-extrabold">
                  {profile.tasteMatchScore}%
                </text>
              </svg>
              <p className="text-[12px] font-bold text-accent">{tasteMatchLabel(profile.tasteMatchScore!)}</p>
            </div>
          </section>
        )}
      </div>

      <section className="px-6 py-7 lg:px-0">
        <h2 className="mb-3 text-[15px] font-bold text-text">Recently watched</h2>
        {/* QA (docs/qa/settings-bugs.md #2): watchedListVisible reports whether
            OTHERS can see this list — the backend already returns the owner's
            own data regardless of it, so self needs the same "|| isSelf" here
            or the owner would see the "private" message on their own list. */}
        {!profile.watchedListVisible && !isSelf && <p className="text-sm text-text-muted">This user's watched list is private.</p>}
        {(profile.watchedListVisible || isSelf) && profile.watched.length === 0 && <p className="text-sm text-text-muted">No public watched movies yet.</p>}
        {(profile.watchedListVisible || isSelf) && profile.watched.length > 0 && (
          <ul className="flex flex-col gap-3 lg:grid lg:grid-cols-6 lg:gap-4">
            {profile.watched.map((entry) => {
              const poster = posterUrl(entry.poster, 'w185')
              return (
                <li key={entry.movieId}>
                  <button type="button" onClick={() => navigate(`/movie/${entry.movieId}`)} className="flex w-full items-center gap-3 text-left lg:block">
                    <div className="h-12 w-9 flex-none overflow-hidden rounded-md bg-surface-alt lg:h-auto lg:w-full lg:aspect-[2/3] lg:rounded-xl">
                      {poster && <img src={poster} alt="" className="h-full w-full object-cover" />}
                    </div>
                    <div className="min-w-0 flex-1 lg:mt-2">
                      <span className="block truncate text-[13px] font-medium text-text lg:text-[12px]">{entry.title ?? 'Untitled'}</span>
                      <span className="text-[11px] text-text-muted">{formatWatchedAt(entry.watchedAt)}</span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {(profile.watchedListVisible || isSelf) && profile.recentActivity.length > 0 && (
        <section className="px-6 pb-9 lg:px-0">
          <h2 className="mb-3 text-[14px] font-bold text-text">Recent Activity</h2>
          <ul className="flex flex-col gap-3.5">
            {profile.recentActivity.map((item) => (
              <ActivityLine key={item.activityId} item={item} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )

  return (
    // QA (docs/qa/profile-bugs.md #1): the shell's outer container only set a
    // *minimum* height, so the inner lg:overflow-y-auto column never had a
    // bounded parent to actually scroll within — the browser scrolled <body>
    // instead, taking Sidebar/AppHeader with it. lg:h-svh caps the row to the
    // viewport (mobile keeps the old min-h-svh, which is what lets it grow
    // freely with content there — no sidebar/overflow-y-auto trick applies
    // below lg anyway). Same fix applied to Home.tsx/MovieDetail.tsx, which
    // share this exact shell shape and had the identical bug.
    <div className="flex min-h-svh bg-bg text-text lg:h-svh">
      <Sidebar active="profile" />
      <main className="min-w-0 flex-1 lg:flex lg:flex-col">
        <AppHeader onSignOut={() => void signOutUser()} />
        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">{content}</div>
        <MobileTabBar active="profile" />
      </main>
    </div>
  )
}
