import { useNavigate } from 'react-router-dom'

// Standalone "Our Story" page — reachable signed-in (Sidebar/Home) and
// signed-out (MovieSearch's guest footer), since ZATLAN pulls TMDB data/images
// on both sides of that split. Below the product summary, this also carries
// the attribution TMDB's API Terms of Use require: the TMDB logo, displayed
// less prominently than ZATLAN's own branding, plus an exact sentence, placed
// somewhere prominent like an About/Credits section
// (https://www.themoviedb.org/api-terms-of-use). Streaming-provider data is
// sourced from JustWatch via TMDB and gets its own inline credit right next
// to where it's shown too (MovieDetail's "Where can I watch?"), separate
// from the general notice below.
export function About() {
  const navigate = useNavigate()

  return (
    <main className="min-h-svh bg-bg text-text">
      <div className="mx-auto w-full max-w-3xl px-5 py-6 lg:py-10">{/* same container as Discover (MovieSearch.tsx) */}
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="mb-6 flex h-10 w-10 items-center justify-center rounded-full border border-border-soft bg-surface-alt"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <span className="font-serif text-2xl font-bold text-accent">ZATLAN</span>
        <h1 className="mt-1 font-serif text-[22px] font-semibold text-white">Our Story</h1>

        <section className="mt-5">
          <p className="text-[13px] leading-relaxed text-text-secondary">
            Instead of asking "what should I watch?", ZATLAN asks{' '}
            <span className="text-text italic">"I want to watch this movie — who else wants to watch it with me?"</span>
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-text-secondary">
            ZATLAN is a social movie platform: discover films, find people who share your taste, and turn watching into a
            shared experience — rate and review, build a watchlist, match with people nearby who are into the same
            movies, and chat in a room built around a watch event. Movie discovery meets a real social graph, not just
            a recommendation feed.
          </p>
        </section>

        <section className="mt-8 border-t border-border-soft pt-6">
          <h2 className="mb-2.5 text-[13px] font-bold text-text">Movie data</h2>
          {/* Kept visually small/plain — deliberately less prominent than the
              ZATLAN wordmark above, per TMDB's attribution terms. */}
          <img src="/images/tmdb-logo.svg" alt="TMDB" className="h-4 w-auto opacity-80" />
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-text-secondary">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </section>

        <section className="mt-6">
          <h2 className="mb-2.5 text-[13px] font-bold text-text">Streaming availability</h2>
          <p className="text-[12.5px] leading-relaxed text-text-secondary">
            Streaming provider data shown on movie pages ("Where can I watch?") is sourced from JustWatch, via the TMDB API.
          </p>
        </section>
      </div>
    </main>
  )
}
