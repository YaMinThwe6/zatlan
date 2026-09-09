import { useEffect, useState } from 'react'
import { updateMe } from '../../../lib/api'

interface Props {
  greeting: string | null
  displayName?: string
  onComplete: () => void
}

export function SuccessStep({ greeting, displayName, onComplete }: Props) {
  const [error, setError] = useState('')

  useEffect(() => {
    updateMe({ onboardingComplete: true })
      .then(() => onComplete())
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to finish setup'))
    // Runs once on mount to persist onboarding completion, then hands control back to the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="relative flex min-h-svh flex-1 flex-col items-center justify-center overflow-hidden bg-bg px-8 text-center text-text">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(60% 50% at 50% 38%, rgba(var(--accent-rgb), 0.16), transparent 65%)' }}
      />
      <div className="relative flex flex-col items-center">
        <div
          className="mb-7 flex h-24 w-24 items-center justify-center rounded-full border-[2.5px] border-accent shadow-[0_0_32px_rgba(var(--accent-rgb),0.4)]"
        >
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" className="stroke-accent" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h1 className="font-serif text-[25px] font-semibold text-white">
          {displayName ? `Welcome to ZATLAN, ${displayName}!` : 'Welcome to ZATLAN!'}
        </h1>
        <p className="mt-2.5 text-sm text-text-muted">{greeting ?? "Your account is ready."}</p>
        {error && (
          <p role="alert" className="mt-4 text-[13px] text-red-400">
            {error}
          </p>
        )}
      </div>
    </main>
  )
}
