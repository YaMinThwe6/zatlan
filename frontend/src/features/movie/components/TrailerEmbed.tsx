import { useState } from 'react'

interface Props {
  trailerKey: string | null
  posterUrl: string | null
  className?: string
}

// Click-to-load YouTube embed for the movie detail hero's trailer slot —
// shows YouTube's own thumbnail with a play button overlay first, and only
// mounts the real <iframe> (and everything YouTube loads with it) once
// someone actually clicks play, rather than eagerly embedding on every
// page load. Falls back to the plain poster when the movie has no trailer
// at all (not every TMDB entry has one) — never a broken/empty box.
export function TrailerEmbed({ trailerKey, posterUrl, className }: Props) {
  const [playing, setPlaying] = useState(false)

  if (playing && trailerKey) {
    return (
      <iframe
        className={className}
        src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1`}
        title="Trailer"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    )
  }

  const thumbnail = trailerKey ? `https://img.youtube.com/vi/${trailerKey}/hqdefault.jpg` : posterUrl
  if (!thumbnail) return null

  return (
    <div className={`relative ${className ?? ''}`}>
      {/* "poster" class only when genuinely showing the poster fallback (no
          trailer) — a stable hook other code/tests can key on, same as
          before this component existed. Not applied to the YouTube
          thumbnail, a different thing wearing the same img tag. */}
      <img src={thumbnail} alt="" className={trailerKey ? 'h-full w-full object-cover' : 'poster h-full w-full object-cover'} />
      {trailerKey && (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label="Play trailer"
          className="absolute inset-0 flex items-center justify-center bg-black/25 transition hover:bg-black/40"
        >
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-black/60 backdrop-blur-sm lg:h-16 lg:w-16">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white" aria-hidden="true" className="ml-0.5 lg:h-6 lg:w-6">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </button>
      )}
    </div>
  )
}
