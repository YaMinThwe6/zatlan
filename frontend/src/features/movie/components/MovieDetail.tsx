import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getMovie,
  getMovieStatus,
  getMovieReviews,
  submitReview,
  deleteReview,
  addToWatchlist,
  removeFromWatchlist,
  markWatched,
  unmarkWatched,
  likeMovie,
  unlikeMovie,
  type MovieDetail as MovieDetailData,
  type MovieStatus,
  type Review
} from '../services/movieApi'
import { WatchedByFriends } from './WatchedByFriends'
import { SimilarPicks } from './SimilarPicks'
import { WatchTogether } from './WatchTogether'
import { WatchTogetherGuest } from './WatchTogetherGuest'
import { CreateEventModal } from '../../events/components/CreateEventModal'
import { useAuth } from '../../../lib/AuthContext'
import { posterUrl, backdropUrl } from '../../../lib/images'
import { TrailerEmbed } from './TrailerEmbed'
import { Sidebar } from '../../../components/Sidebar'
import { AppHeader } from '../../../components/AppHeader'
import { MobileTabBar } from '../../../components/MobileTabBar'

const EMPTY_STATUS: MovieStatus = { watchlisted: false, watched: false, liked: false, review: null }

function formatRuntime(minutes: number | null): string {
  if (!minutes) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m (${minutes} min)` : `${minutes} min`
}

function StarIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden="true">
      <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.6 6.1 20.6l1.3-6.6-4.9-4.6 6.6-.8z" />
    </svg>
  )
}

function ActionButton({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick?: () => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className="flex flex-col items-center gap-1.5">
      <span
        className={`flex h-[46px] w-[46px] items-center justify-center rounded-full border ${
          active ? 'border-accent bg-input text-accent' : 'border-border bg-input text-text-secondary'
        }`}
      >
        {icon}
      </span>
      <span className={`text-[10.5px] font-semibold ${active ? 'text-accent' : 'text-text-secondary'}`}>{label}</span>
    </button>
  )
}

export function MovieDetail() {
  // Only ever mounted via the "/movie/:movieId" route (App.tsx), so this
  // segment is always present in practice — the assertion just tells
  // TypeScript what the route already guarantees.
  const { movieId: movieIdParam } = useParams<{ movieId: string }>()
  const movieId = movieIdParam!
  const navigate = useNavigate()
  const { user, signOutUser } = useAuth()
  const isGuest = !user
  const [movie, setMovie] = useState<MovieDetailData | null>(null)
  const [movieError, setMovieError] = useState('')

  const [status, setStatus] = useState<MovieStatus>(EMPTY_STATUS)
  const [statusError, setStatusError] = useState('')
  const [actionError, setActionError] = useState('')
  // WatchedByFriends' empty-state "invite a friend" CTA — opens the same
  // create-a-watch-party flow WatchTogether's own button does, pre-filled
  // with this movie.
  const [createPartyOpen, setCreatePartyOpen] = useState(false)

  const [reviews, setReviews] = useState<Review[]>([])
  const [reviewsError, setReviewsError] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [rating, setRating] = useState(0)
  const [reviewText, setReviewText] = useState('')
  const [isAnonymous, setIsAnonymous] = useState(false)
  const [formError, setFormError] = useState('')

  function loadReviews() {
    return getMovieReviews(movieId)
      .then((res) => setReviews(res.items))
      .catch((err) => setReviewsError(err instanceof Error ? err.message : 'Failed to load reviews'))
  }

  function loadStatus() {
    return getMovieStatus(movieId)
      .then(setStatus)
      .catch((err) => setStatusError(err instanceof Error ? err.message : 'Failed to load status'))
  }

  // Separate from the initial-mount fetch below so submit/delete can refresh
  // just the rating aggregate without re-triggering the "Loading…" full-page
  // state — the movie's own zatlanRating changes every time a review is posted
  // or removed, so it can't just be fetched once on mount.
  function loadMovie() {
    return getMovie(movieId)
      .then(setMovie)
      .catch((err) => setMovieError(err instanceof Error ? err.message : 'Failed to load movie'))
  }

  useEffect(() => {
    loadMovie()
    if (!isGuest) loadStatus() // status/review-ownership is per-caller — nothing to fetch signed out
    loadReviews()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieId])

  async function toggle(kind: 'watchlisted' | 'watched' | 'liked') {
    const previous = status[kind]
    setActionError('')
    setStatus((prev) => ({ ...prev, [kind]: !previous }))
    try {
      if (kind === 'watchlisted') await (previous ? removeFromWatchlist(movieId) : addToWatchlist(movieId))
      else if (kind === 'watched') await (previous ? unmarkWatched(movieId) : markWatched(movieId))
      else await (previous ? unlikeMovie(movieId) : likeMovie(movieId))
    } catch (err) {
      setStatus((prev) => ({ ...prev, [kind]: previous }))
      setActionError(err instanceof Error ? err.message : 'Failed to update')
    }
  }

  function openForm() {
    if (status.review) {
      setRating(status.review.rating)
      setReviewText(status.review.reviewText ?? '')
      setIsAnonymous(status.review.isAnonymous)
    } else {
      setRating(0)
      setReviewText('')
      setIsAnonymous(false)
    }
    setFormError('')
    setFormOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (rating < 1) return
    setFormError('')
    try {
      await submitReview(movieId, { rating, reviewText: reviewText.trim() || null, isAnonymous })
      setFormOpen(false)
      await Promise.all([loadReviews(), loadStatus(), loadMovie()])
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save review')
    }
  }

  async function handleDelete() {
    setFormError('')
    try {
      await deleteReview(movieId)
      setFormOpen(false)
      await Promise.all([loadReviews(), loadStatus(), loadMovie()])
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to delete review')
    }
  }

  if (movieError) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-bg px-6 text-text">
        <button type="button" onClick={() => navigate(-1)} className="self-start text-sm font-semibold text-text-secondary">
          ← Back
        </button>
        <p role="alert" className="text-sm text-red-400">
          {movieError}
        </p>
      </main>
    )
  }

  if (!movie) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-bg text-text">
        <p className="text-sm text-text-muted">Loading…</p>
      </main>
    )
  }

  const zatlanAverage = movie.zatlanRating.count > 0 ? (movie.zatlanRating.sum / movie.zatlanRating.count).toFixed(1) : null
  const poster = posterUrl(movie.poster, 'w500')
  const backdrop = backdropUrl(movie.backdrop, 'w1280')

  const actionBar = isGuest ? (
    <div className="px-5 pt-5 lg:px-0 lg:pt-0">
      <button type="button" onClick={() => navigate('/get-started')} className="w-full rounded-xl bg-accent py-3 text-sm font-bold text-bg lg:w-auto lg:px-8">
        Sign in to save, rate &amp; review
      </button>
    </div>
  ) : (
    <div className="flex justify-around px-4 pt-5 lg:justify-start lg:gap-3 lg:px-0 lg:pt-0">
      <ActionButton
        label="Watchlist"
        active={status.watchlisted}
        onClick={() => toggle('watchlisted')}
        icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
          </svg>
        }
      />
      <ActionButton
        label="Watched"
        active={status.watched}
        onClick={() => toggle('watched')}
        icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M8.5 12.5l2.3 2.3 4.7-5.1" />
          </svg>
        }
      />
      <ActionButton
        label="Like"
        active={status.liked}
        onClick={() => toggle('liked')}
        icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
          </svg>
        }
      />
    </div>
  )

  const content = (
    <div className={isGuest ? 'lg:mx-auto lg:max-w-5xl lg:px-8 lg:pt-8' : 'lg:px-8 lg:pt-8'}>
        {/* Hero backdrop — mobile only; desktop drops the backdrop treatment
            for a plain two-column poster+info row (Desktop.dc.html). */}
        <div
          className="relative h-[224px] w-full overflow-hidden lg:hidden"
          style={{
            background:
              'radial-gradient(120% 90% at 85% 5%, rgba(150,170,200,0.14), transparent 55%), radial-gradient(100% 80% at 5% 95%, rgba(var(--accent-rgb),0.18), transparent 55%), linear-gradient(180deg, #1B1720 0%, #100E12 100%)'
          }}
        >
          <div className="absolute inset-x-0 top-0 h-[90px] bg-gradient-to-b from-black/55 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-[120px] bg-gradient-to-b from-transparent to-bg" />
          <div className="absolute top-4 left-4">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Back"
              className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-white/10 bg-black/55"
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#F3F1ED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Signed-in only: a 320px right rail (Similar taste picks, Watch
            together) alongside the content below — grid-cols-[1fr_320px], same
            shape Home.tsx uses. min-w-0 on the left column matters here for
            the same reason it did on Home: without it, this column refuses to
            shrink below its content's max-content width (the horizontally-
            scrolling Cast row, in this case) and silently pushes the right
            rail off-screen — see Home.tsx's own comment on this exact bug.
            Guests get neither column treatment nor the rail itself; the div
            below is otherwise a no-op wrapper for them (no className, no
            grid). */}
        <div className={isGuest ? undefined : 'lg:grid lg:grid-cols-[1fr_320px] lg:items-start lg:gap-8'}>
        <div className={isGuest ? undefined : 'min-w-0'}>
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="hidden h-10 w-10 items-center justify-center rounded-full border border-border-soft bg-surface-alt lg:mb-6 lg:flex"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        {/* Poster + title glass card, overlapping the hero on mobile; a
            plain two-column row on desktop, with a third widescreen backdrop
            column filling the space that otherwise sat empty next to a
            narrower title block (desktop only — there's no room for it
            alongside the mobile overlap layout). */}
        <div className="relative mx-5 -mt-14 flex items-end gap-3.5 rounded-[20px] border border-white/10 bg-surface/55 p-4 shadow-[0_14px_34px_rgba(0,0,0,0.4)] backdrop-blur-xl lg:mx-0 lg:mt-0 lg:items-stretch lg:gap-6 lg:rounded-none lg:border-none lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
          <div className="h-36 w-[100px] flex-none overflow-hidden rounded-xl bg-surface-alt shadow-[0_6px_16px_rgba(0,0,0,0.4)] lg:h-80 lg:w-55 lg:rounded-2xl">
            <TrailerEmbed trailerKey={movie.trailerKey} posterUrl={poster} className="h-full w-full" />
          </div>
          <div className="min-w-0 flex-1 pb-0.5 lg:flex lg:w-80 lg:flex-none lg:flex-col lg:justify-end lg:pb-1.5">
            <h1 className="font-serif text-[21px] leading-tight font-semibold text-white lg:text-[38px]">{movie.title}</h1>
            <p className="mt-1.5 mb-2.5 text-[11.5px] text-text-secondary lg:mt-2 lg:mb-4 lg:text-sm">
              {movie.year} · {movie.genres.join(', ')} · {formatRuntime(movie.runtime)}
            </p>
            <div className="flex items-center gap-3 text-[13px] font-bold lg:mb-5 lg:gap-8">
              <span className="flex items-center gap-1 text-text lg:flex-col lg:items-start lg:gap-0">
                <span className="flex items-center gap-1">
                  <StarIcon filled className="text-text" />
                  <span className="lg:text-xl">{movie.voteAverage.toFixed(1)}</span>
                </span>
                <span className="hidden text-[11px] font-normal text-text-muted lg:block">TMDB rating</span>
              </span>
              {zatlanAverage ? (
                <span className="flex items-center gap-1 text-accent lg:flex-col lg:items-start lg:gap-0">
                  <span className="flex items-center gap-1">
                    <StarIcon filled className="text-[#FFC107]" />
                    <span className="lg:text-xl">{zatlanAverage}</span>
                  </span>
                  <span className="hidden text-[11px] font-normal text-text-muted lg:block">ZATLAN rating</span>
                </span>
              ) : (
                <span className="text-[11.5px] font-semibold text-text-muted">No ratings yet</span>
              )}
            </div>
            <div className="hidden lg:block">{actionBar}</div>
          </div>
          {backdrop && (
            <div className="hidden overflow-hidden rounded-2xl bg-surface-alt lg:block lg:h-80 lg:flex-1">
              <img src={backdrop} alt="" className="h-full w-full object-cover" />
            </div>
          )}
        </div>

        {statusError && (
          <p role="alert" className="mt-4 px-5 text-[13px] text-red-400 lg:px-0">
            {statusError}
          </p>
        )}
        {actionError && (
          <p role="alert" className="mt-2 px-5 text-[13px] text-red-400 lg:px-0">
            {actionError}
          </p>
        )}

        <div className="lg:hidden">{actionBar}</div>

        <div className="flex flex-col gap-7 px-5 py-7 lg:px-0 lg:pt-9 lg:pb-16">
          {movie.streamingProviders.length > 0 && (
            <section>
              <h2 className="mb-3 text-[15px] font-bold text-text">Where can I watch?</h2>
              <ul className="flex flex-wrap gap-2.5">
                {movie.streamingProviders.map((p, i) => {
                  const logo = posterUrl(p.logo || null, 'w92')
                  return (
                    // TMDB can list the same provider more than once under different
                    // offer types (e.g. "Apple TV Store" as both rent and buy) — name
                    // alone isn't a unique key, so index disambiguates duplicates.
                    <li
                      key={`${p.name}-${i}`}
                      className="flex items-center gap-2 rounded-full border border-border bg-input py-2 pr-3.5 pl-2 text-[12.5px] font-semibold text-text"
                    >
                      {logo && <img src={logo} alt="" className="h-5 w-5 flex-none rounded-[5px] object-cover" />}
                      {p.name}
                    </li>
                  )
                })}
              </ul>
              {/* This data comes from JustWatch via the TMDB API — TMDB requires a
                  reference alongside each place it's shown, not just a one-time
                  credit elsewhere (see /story). */}
              <p className="mt-2.5 text-[10.5px] text-text-faint">Streaming availability data provided by JustWatch.</p>
            </section>
          )}

          <div className="flex flex-col gap-7 lg:flex-row lg:gap-8">
            {!isGuest && (
              <section className="lg:flex-1">
                <WatchedByFriends
                  movieId={movieId}
                  watched={status.watched}
                  onMarkWatched={() => toggle('watched')}
                  onInviteFriend={() => setCreatePartyOpen(true)}
                />
              </section>
            )}
            {isGuest && (
              <section className="lg:flex-1">
                <WatchTogetherGuest movieId={movieId} />
              </section>
            )}
            <section className="lg:flex-1">
              <h2 className="mb-2.5 text-[15px] font-bold text-text">About</h2>
              <p className="text-sm leading-relaxed text-text-secondary">{movie.synopsis}</p>
            </section>
          </div>

          <div className="flex flex-col gap-7 lg:flex-row lg:gap-8">
            {movie.cast.length > 0 && (
              <section className="lg:flex-1">
                <h2 className="mb-3 text-[15px] font-bold text-text">Cast</h2>
                <ul className="flex gap-4 overflow-x-auto pb-0.5 lg:flex-wrap">
                  {movie.cast.map((c) => {
                    const photo = posterUrl(c.photo, 'w185')
                    return (
                      <li key={c.personId} className="w-16 flex-none text-center">
                        <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-[rgba(124,140,166,0.32)] bg-[rgba(124,140,166,0.14)] font-serif text-base text-[#9BABC4]">
                          {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : c.name.charAt(0)}
                        </div>
                        <div className="text-[11px] font-semibold text-text">{c.name}</div>
                        <div className="text-[10px] text-text-muted">{c.character}</div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}

            <section className="lg:flex-1">
              <h2 className="mb-3 text-[15px] font-bold text-text">Reviews</h2>
              {reviewsError && (
                <p role="alert" className="mb-3 text-[13px] text-red-400">
                  {reviewsError}
                </p>
              )}
              <ul className="flex flex-col gap-3">
                {reviews.map((r, i) => (
                  <li key={r.authorId ?? `anon-${i}`} className="rounded-2xl border border-border bg-input p-3.5">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-text">{r.isAnonymous ? 'Anonymous' : r.displayName}</span>
                      <span className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <StarIcon key={n} filled={n <= r.rating} className={n <= r.rating ? 'text-[#FFC107]' : 'text-border'} />
                        ))}
                      </span>
                    </div>
                    {r.reviewText && <p className="text-[13.5px] leading-relaxed text-text-secondary">{r.reviewText}</p>}
                  </li>
                ))}
              </ul>

              {isGuest ? (
                <button type="button" onClick={() => navigate('/get-started')} className="mt-3 w-full rounded-xl border border-border bg-surface-alt py-3 text-[13.5px] font-bold text-text lg:w-auto lg:px-6">
                  Sign in to write a review
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openForm}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 text-[13.5px] font-bold text-bg lg:w-auto lg:px-6"
                >
                  {status.review ? 'Edit your review' : 'Write a review'}
                </button>
              )}

              {!isGuest && formOpen && (
                <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3.5 rounded-2xl border border-border bg-surface-alt p-4">
                  <div role="group" aria-label="Rating" className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        aria-pressed={star <= rating}
                        aria-label={`${star} star${star > 1 ? 's' : ''}`}
                        onClick={() => setRating(star)}
                        className={star <= rating ? 'text-2xl text-accent' : 'text-2xl text-border'}
                      >
                        ★
                      </button>
                    ))}
                  </div>

                  <div>
                    <label htmlFor="review-text" className="mb-1.5 block text-xs font-semibold text-text-secondary">
                      Review
                    </label>
                    <textarea
                      id="review-text"
                      aria-label="Review"
                      value={reviewText}
                      onChange={(e) => setReviewText(e.target.value)}
                      placeholder="Share your thoughts (optional)…"
                      rows={3}
                      className="w-full resize-none rounded-xl border border-border bg-input px-3.5 py-3 text-sm text-text outline-none focus:border-accent"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-[13px] text-text-secondary">
                    <input
                      type="checkbox"
                      aria-label="Post anonymously"
                      checked={isAnonymous}
                      onChange={(e) => setIsAnonymous(e.target.checked)}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    Post anonymously
                  </label>

                  {formError && (
                    <p role="alert" className="text-[13px] text-red-400">
                      {formError}
                    </p>
                  )}

                  <button type="submit" disabled={rating < 1} className="rounded-xl bg-accent py-3 text-sm font-bold text-bg disabled:opacity-40">
                    Post Review
                  </button>
                  {status.review && (
                    <button type="button" onClick={handleDelete} className="text-[13px] font-semibold text-red-400">
                      Delete review
                    </button>
                  )}
                </form>
              )}
            </section>
          </div>
        </div>
        </div>

        {!isGuest && (
          <div className="hidden flex-col gap-7 lg:col-start-2 lg:row-start-1 lg:flex">
            <SimilarPicks movieId={movieId} />
            <WatchTogether movieId={movieId} />
          </div>
        )}
        </div>
    </div>
  )

  // Guests never see the signed-in Sidebar/AppHeader shell — same treatment
  // Home/Search give a signed-out visitor (no nav for pages they can't use).
  if (isGuest) {
    return <main className="min-h-svh bg-bg text-text">{content}</main>
  }

  return (
    // QA (docs/qa/profile-bugs.md #1 — a real bug, not a shell characteristic
    // to match): the outer container only set a *minimum* height, so the inner
    // lg:overflow-y-auto column never had a bounded parent to actually scroll
    // within — the whole page scrolled instead, taking Sidebar/AppHeader with
    // it. lg:h-svh caps the row to the viewport; mobile keeps the old
    // min-h-svh (grows freely with content, no sidebar/overflow-y-auto trick
    // applies below lg anyway). Same fix applied to Home.tsx/Profile.tsx,
    // which share this exact shell shape and had the identical bug.
    <div className="flex min-h-svh bg-bg text-text lg:h-svh">
      <Sidebar />
      <main className="min-w-0 flex-1 lg:flex lg:flex-col">
        <AppHeader onSignOut={() => void signOutUser()} />
        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">{content}</div>
        <MobileTabBar active="profile" />
      </main>
      {createPartyOpen && movie && (
        <CreateEventModal
          initialMovie={{ movieId: movie.movieId, title: movie.title, poster: movie.poster, year: movie.year }}
          onClose={() => setCreatePartyOpen(false)}
          onCreated={(eventId) => {
            setCreatePartyOpen(false)
            navigate(`/events/${eventId}`)
          }}
        />
      )}
    </div>
  )
}
