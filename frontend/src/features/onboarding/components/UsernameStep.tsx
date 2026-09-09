import { useEffect, useRef, useState } from 'react'
import { checkUsernameAvailable } from '../services/onboardingApi'
import { updateMe } from '../../../lib/api'
import { generateUsernameSuggestions } from '../usernameSuggestions'
import { OnboardingShell } from './OnboardingShell'

const USERNAME_RE = /^[a-z0-9._]{3,30}$/
const DEBOUNCE_MS = 400
const MAX_SUGGESTIONS = 4

interface Props {
  initialDisplayName: string
  initialUsername?: string
  email: string
  onDone: (displayName: string, username: string) => void
}

type AvailabilityState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'

export function UsernameStep({ initialDisplayName, initialUsername, email, onDone }: Props) {
  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [username, setUsername] = useState(initialUsername ?? '')
  const [availability, setAvailability] = useState<AvailabilityState>('idle')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const candidates = generateUsernameSuggestions(initialDisplayName, email)

    Promise.all(
      candidates.map(async (candidate) => {
        try {
          const { available } = await checkUsernameAvailable(candidate)
          return available ? candidate : null
        } catch {
          return null
        }
      })
    ).then((results) => {
      if (cancelled) return
      setSuggestions(results.filter((c): c is string => c !== null).slice(0, MAX_SUGGESTIONS))
      setSuggestionsLoading(false)
    })

    return () => {
      cancelled = true
    }
    // Suggestions are derived once from the name/email this step was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const normalized = username.trim().toLowerCase()
    if (!normalized) {
      setAvailability('idle')
      return
    }
    if (!USERNAME_RE.test(normalized)) {
      setAvailability('invalid')
      return
    }

    setAvailability('checking')
    const thisRequestId = ++requestIdRef.current
    debounceRef.current = setTimeout(async () => {
      try {
        const { available } = await checkUsernameAvailable(normalized)
        if (requestIdRef.current !== thisRequestId) return // stale response, a newer check superseded it
        setAvailability(available ? 'available' : 'taken')
      } catch {
        if (requestIdRef.current !== thisRequestId) return
        setAvailability('idle')
      }
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [username])

  function pickSuggestion(candidate: string) {
    setUsername(candidate)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (availability !== 'available' || !displayName.trim()) return
    setError('')
    setSubmitting(true)
    try {
      const trimmedName = displayName.trim()
      const trimmedUsername = username.trim().toLowerCase()
      await updateMe({ displayName: trimmedName, username: trimmedUsername })
      onDone(trimmedName, trimmedUsername)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = availability === 'available' && displayName.trim().length > 0 && !submitting
  const isAvailable = availability === 'available'

  return (
    <OnboardingShell
      step={1}
      desktopTitle="This is how people find you."
      desktopSubtitle="Your name and username show up on reviews, watch parties and your public profile."
    >
      <form onSubmit={handleSubmit} className="flex flex-1 flex-col px-7 pt-8 pb-10">
        <h1 className="font-serif text-[26px] font-semibold text-white">Create your profile</h1>
        <p className="mt-2 mb-7 text-[13.5px] text-text-muted">This is how people on ZATLAN will find and recognize you.</p>

        {/* Implicit label association (no id/htmlFor) — this step's own
            outer wrapper renders twice at once (a mobile copy and a desktop
            copy, CSS-toggled per breakpoint, per OnboardingShell), and a
            document-wide-unique id would collide between the two copies. */}
        <label className="mb-2 text-xs font-semibold text-text-secondary">
          Full name
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            className="mt-2 mb-5 block w-full rounded-xl border border-border bg-surface-alt px-4 py-3.5 text-sm font-normal text-text outline-none focus:border-accent"
          />
        </label>

        <label className="mb-2 block text-xs font-semibold text-text-secondary">Username</label>
        <div
          className={`flex items-center gap-2 rounded-xl border bg-surface-alt px-4 py-3.5 ${isAvailable ? 'border-[rgba(61,220,132,0.5)]' : 'border-border'}`}
        >
          <span className="text-sm text-text-faint">@</span>
          <input
            aria-label="Username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
            className="flex-1 bg-transparent text-sm text-text outline-none"
          />
          {isAvailable && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3DDC84" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          )}
        </div>

        {availability === 'checking' && <p className="mt-2 text-[11.5px] text-text-muted">Checking…</p>}
        {availability === 'available' && <p className="mt-2 text-[11.5px] text-[#3DDC84]">This username is available</p>}
        {availability === 'taken' && (
          <p role="alert" className="mt-2 text-[11.5px] text-red-400">
            That username is taken
          </p>
        )}
        {availability === 'invalid' && (
          <p role="alert" className="mt-2 text-[11.5px] text-red-400">
            3-30 characters: lowercase letters, numbers, dots, underscores
          </p>
        )}

        {suggestionsLoading && <p className="mt-4 text-[13px] text-text-muted">Finding suggestions…</p>}
        {!suggestionsLoading && suggestions.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[12px] text-text-muted">Suggestions:</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => pickSuggestion(s)}
                  className="rounded-full border border-border bg-surface-alt px-3.5 py-2 text-[12.5px] font-semibold text-text-secondary"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 text-[13px] text-red-400">
            {error}
          </p>
        )}

        {/* A fixed gap, not a flex-1 spacer — see MultiSelectStep.tsx for
            why: flex-1 collapses to nothing once the form is vertically
            centered instead of stretched (OnboardingShell's desktop
            layout), so however many suggestions came back, there's still a
            real gap here rather than the button touching them. */}
        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-8 flex items-center justify-center rounded-xl bg-accent py-3.5 text-sm font-bold text-bg disabled:opacity-40"
        >
          {submitting ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </OnboardingShell>
  )
}
