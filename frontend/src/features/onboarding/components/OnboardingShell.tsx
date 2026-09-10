import type { ReactNode } from 'react'

const TOTAL_STEPS = 6

interface Props {
  step: number // 1-indexed
  onBack?: () => void
  children: ReactNode
  // Left-panel branding copy (desktop only) — per-step, matching the design
  // canvas's Signup*Desktop.dc.html headlines where one exists; falls back
  // to something generic for steps that postdate the original 6-step plan.
  desktopTitle?: string
  desktopSubtitle?: string
}

// Shared header (back arrow + "Step N of 6" + progress bar) across every
// onboarding step (design canvas's SignupDetails/Genres/Watched.dc.html) —
// one place instead of duplicating this scaffold in six components.
//
// Renders `children` twice — a mobile copy and a desktop copy, CSS-toggled
// per breakpoint (same jsdom-dual-render pattern used throughout this app;
// see e.g. Welcome.tsx) — since desktop needs a genuinely different
// structure (a left branding rail beside the form, not just a wider single
// column) rather than one layout reflowing. Safe to duplicate here: the
// step's own state/data-fetching lives in the step component itself (one
// level up, called once), not inside this shared element tree, and none of
// the step components rely on a document-wide-unique id in their own markup
// (UsernameStep uses implicit label association instead, for exactly this
// reason).
export function OnboardingShell({ step, onBack, children, desktopTitle, desktopSubtitle }: Props) {
  const backButton = onBack ? (
    <button
      type="button"
      onClick={onBack}
      aria-label="Back"
      className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-border-soft bg-surface-alt"
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  ) : (
    <span />
  )

  const stepLabel = (
    <span className="text-[11.5px] font-bold tracking-wide text-text-muted">
      Step {step} of {TOTAL_STEPS}
    </span>
  )

  const progressBar = (
    <div className="flex gap-1.5" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={TOTAL_STEPS}>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <div key={i} className={`h-1 flex-1 rounded-full ${i < step ? 'bg-accent' : 'bg-border'}`} />
      ))}
    </div>
  )

  return (
    <main className="flex min-h-svh flex-1 flex-col bg-bg text-text md:h-svh md:min-h-0 md:flex-row">
      {/* MOBILE — unchanged single-column flow. */}
      <div className="flex flex-1 flex-col md:hidden">
        <div className="flex items-center justify-between px-6 pt-5">
          {backButton}
          {stepLabel}
        </div>
        <div className="px-6 pt-4">{progressBar}</div>
        {children}
      </div>

      {/* DESKTOP — split panel (design canvas's SignupDetails/Genres/
          WatchedDesktop.dc.html): a fixed-width branding rail on the left,
          the step's own form centered in the remaining space on the right,
          instead of the same mobile column just floating small in a huge
          dark viewport. */}
      <div className="relative hidden w-[560px] flex-none overflow-hidden md:block">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 60% at 80% 15%, rgba(150,170,200,0.16), transparent 60%), radial-gradient(70% 80% at 15% 90%, rgba(var(--accent-rgb),0.24), transparent 60%), linear-gradient(180deg, #1B1720 0%, #100E12 55%, #0A090B 100%)'
          }}
        />
        <div className="relative flex h-full flex-col justify-between p-12">
          <span className="font-serif text-2xl font-bold text-accent">ZATLAN</span>
          <div>
            <div className="font-serif text-[32px] leading-tight font-semibold text-white">{desktopTitle ?? "Let's set up your profile."}</div>
            <p className="mt-3.5 max-w-[400px] text-sm leading-relaxed text-[#C9C5D1]">
              {desktopSubtitle ?? 'A few quick steps and ZATLAN will know what to recommend.'}
            </p>
          </div>
        </div>
      </div>

      <div className="hidden flex-1 flex-col md:flex">
        <div className="flex flex-none items-center justify-between px-12 pt-8">
          {backButton}
          {stepLabel}
        </div>
        <div className="flex flex-1 items-center justify-center px-12 pb-16">
          <div className="w-full max-w-[480px]">
            <div className="mb-8">{progressBar}</div>
            {children}
          </div>
        </div>
      </div>
    </main>
  )
}
