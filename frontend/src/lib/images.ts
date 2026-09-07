// TMDB's own public image CDN — no API key/credentials involved (unlike the
// TMDB *data* API, which stays backend-only per hld.md's "frontend never
// calls TMDB directly" principle), so rendering these directly from the
// browser doesn't cross that line. `poster`/`backdrop` fields from the
// backend are TMDB's raw relative path (e.g. "/abc123.jpg") — this is the
// one place that turns that into an actual loadable URL.
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

// 'w92' is TMDB's small "logo" bucket (provider/network logos), not a poster
// size — this helper just builds a CDN URL from a relative path, so it's
// reused for both.
export type PosterSize = 'w92' | 'w185' | 'w342' | 'w500'

export function posterUrl(path: string | null, size: PosterSize = 'w342'): string | null {
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : null
}

// TMDB's separate widescreen bucket for backdrop_path (movie detail's hero
// image) — different size ladder than posters', since a backdrop is much
// wider than tall.
export type BackdropSize = 'w300' | 'w780' | 'w1280'

export function backdropUrl(path: string | null, size: BackdropSize = 'w1280'): string | null {
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : null
}
