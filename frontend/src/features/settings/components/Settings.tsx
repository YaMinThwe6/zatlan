import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateMe, type Me } from '../../../lib/api'
import { checkUsernameAvailable } from '../../onboarding/services/onboardingApi'
import { useAuth } from '../../../lib/AuthContext'
import { Sidebar } from '../../../components/Sidebar'
import { AppHeader } from '../../../components/AppHeader'
import { MobileTabBar } from '../../../components/MobileTabBar'

const USERNAME_RE = /^[a-z0-9._]{3,30}$/
const DEBOUNCE_MS = 400

// Settings.dc.html / SettingsDesktop.dc.html's own dc-script defines these
// six accents with these exact hex values — same six accentTheme values
// index.css's :root[data-accent=...] blocks already implement (lib/theme.ts).
const ACCENT_SWATCHES: { key: Me['accentTheme']; label: string; hex: string }[] = [
  { key: 'emerald', label: 'Emerald', hex: '#00C896' },
  { key: 'cyan', label: 'Cyan', hex: '#00E5FF' },
  { key: 'purple', label: 'Purple', hex: '#A855F7' },
  { key: 'pink', label: 'Pink', hex: '#FF7AC2' },
  { key: 'amber', label: 'Amber', hex: '#FFB020' },
  { key: 'red', label: 'Red', hex: '#FF385C' }
]

type AvailabilityState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'

interface Props {
  me: Me
  // App.tsx owns the single `me` state Home/AppHeader/theme.ts's applyAccentTheme
  // effect all read from — every save here threads the server's response back
  // through this rather than keeping a disconnected local copy, so an accent
  // change (for instance) actually re-triggers App's effect instead of only
  // looking changed on this page and reverting elsewhere.
  onUpdateMe: (me: Me) => void
}

function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative h-6 w-10.5 flex-none rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-border'}`}
    >
      <span
        className={`absolute top-0.75 h-4.5 w-4.5 rounded-full transition-all ${checked ? 'right-0.75 bg-bg' : 'left-0.75 bg-text-faint'}`}
      />
    </button>
  )
}

// Always returns a label — Welcome.tsx's OTP-then-signInWithToken flow (the
// only sign-in path besides Google/Microsoft popups) leaves Firebase's
// providerData empty even though it's a real signed-in account, so this
// falls back to EMAIL rather than the badge just disappearing (design
// review: the mockup's Account row always shows a provider badge).
function providerLabel(providerId: string | undefined): string {
  if (providerId === 'google.com') return 'GOOGLE'
  if (providerId === 'microsoft.com') return 'MICROSOFT'
  return 'EMAIL'
}

// Matches the design canvas's Settings.dc.html (mobile) and
// SettingsDesktop.dc.html (desktop) artboards: Profile (display name +
// username with an availability check), Appearance (six accent swatches),
// Privacy (watched-list visibility + follow-approval toggles), Notifications
// (email-activity toggle), and Account (signed-in email/provider + Sign out),
// plus a quiet Delete account link. One responsive tree (Profile.tsx's own
// approach) rather than two parallel mobile/desktop copies — Tailwind's lg:
// prefixes reflow layout, spacing and the card-vs-flat section styling.
//
// Desktop's settings sub-nav in the mockup is a static list with "Profile"
// permanently highlighted (every section actually renders in one flowing
// panel below it, not a per-tab view) — reproduced here as anchor links to
// each section's id, "Profile" kept as the shown-active row since the mockup
// never depicts any other state for it.
export function Settings({ me, onUpdateMe }: Props) {
  const navigate = useNavigate()
  const { user, signOutUser } = useAuth()

  const [displayName, setDisplayName] = useState(me.displayName)
  const [username, setUsername] = useState(me.username ?? '')
  const [availability, setAvailability] = useState<AvailabilityState>('idle')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileSaved, setProfileSaved] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  const normalizedUsername = username.trim().toLowerCase()
  const usernameChanged = normalizedUsername !== (me.username ?? '')

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!usernameChanged) {
      setAvailability('idle')
      return
    }
    if (!normalizedUsername) {
      setAvailability('idle')
      return
    }
    if (!USERNAME_RE.test(normalizedUsername)) {
      setAvailability('invalid')
      return
    }

    setAvailability('checking')
    const thisRequestId = ++requestIdRef.current
    debounceRef.current = setTimeout(async () => {
      try {
        const { available } = await checkUsernameAvailable(normalizedUsername)
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
    // normalizedUsername/usernameChanged are both derived from `username` each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username])

  const canSaveProfile = !savingProfile && displayName.trim().length > 0 && (!usernameChanged || availability === 'available')

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!canSaveProfile) return
    setProfileError('')
    setSavingProfile(true)
    setProfileSaved(false)
    try {
      const patch: Partial<Pick<Me, 'displayName' | 'username'>> = { displayName: displayName.trim() }
      if (usernameChanged) patch.username = normalizedUsername
      const updated = await updateMe(patch)
      onUpdateMe(updated)
      setProfileSaved(true)
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSavingProfile(false)
    }
  }

  async function handlePickAccent(accentTheme: Me['accentTheme']) {
    if (accentTheme === me.accentTheme) return
    try {
      const updated = await updateMe({ accentTheme })
      onUpdateMe(updated)
    } catch {
      // No destructive local state to revert — the swatch simply doesn't move.
    }
  }

  async function togglePrivacyField(field: 'listVisible' | 'followRequiresApproval' | 'hideFromDiscovery') {
    const next = !me[field]
    onUpdateMe({ ...me, [field]: next }) // optimistic, same pattern as Profile.tsx's toggleConnect
    try {
      const updated = await updateMe({ [field]: next })
      onUpdateMe(updated)
    } catch {
      onUpdateMe({ ...me, [field]: !next })
    }
  }

  async function toggleEmailNotifications() {
    const next = !me.notificationPrefs.emailEnabled
    onUpdateMe({ ...me, notificationPrefs: { emailEnabled: next } })
    try {
      const updated = await updateMe({ notificationPrefs: { emailEnabled: next } })
      onUpdateMe(updated)
    } catch {
      onUpdateMe({ ...me, notificationPrefs: { emailEnabled: !next } })
    }
  }

  const provider = providerLabel(user?.providerData?.[0]?.providerId)

  const content = (
    <div className="mx-auto w-full max-w-155 px-5 pt-4.5 pb-10 lg:px-0 lg:pt-7.5 lg:pb-12">
      {/* mobile-only header — desktop gets its title from the panel heading below */}
      <div className="mb-6 flex items-center gap-3 lg:hidden">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="flex h-9.5 w-9.5 items-center justify-center rounded-full border border-border-soft bg-surface-alt"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="text-[19px] font-bold text-text">Settings</h1>
      </div>

      {/* PROFILE — a compact card with stacked rows on mobile (matches
          Settings.dc.html's Profile card, same treatment Privacy/Notifications
          use below), a plain side-by-side input-box pair on desktop (matches
          SettingsDesktop.dc.html). One set of inputs, not two — Tailwind's
          lg: prefixes reflow the same elements rather than rendering a second
          copy, so getByLabelText et al still resolve to a single node. */}
      <section id="settings-profile">
        <h2 className="mb-1 text-[15px] font-bold text-text">Profile</h2>
        <p className="mb-4 text-[11.5px] text-text-muted">This is how you appear across BINJ.</p>
        <form
          onSubmit={handleSaveProfile}
          className="overflow-hidden rounded-2xl border border-border-soft bg-surface lg:flex lg:gap-4 lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent"
        >
          <label className="block border-b border-border-soft px-4.5 py-3.5 lg:flex-1 lg:border-0 lg:px-0 lg:py-0">
            <span className="block text-[10.5px] font-semibold text-text-muted lg:mb-1.5 lg:text-[11px]">Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1.5 block w-full bg-transparent text-[13.5px] font-semibold text-text outline-none lg:mt-0 lg:rounded-[10px] lg:border lg:border-border lg:bg-surface-alt lg:px-3.5 lg:py-2.75 lg:text-[13px] lg:font-medium lg:focus:border-accent"
            />
          </label>
          <label className="block px-4.5 py-3.5 lg:flex-1 lg:px-0 lg:py-0">
            <span className="block text-[10.5px] font-semibold text-text-muted lg:mb-1.5 lg:text-[11px]">Username</span>
            <span
              className={`mt-1.5 flex items-center gap-1.5 lg:mt-0 lg:rounded-[10px] lg:border lg:bg-surface-alt lg:px-3.5 lg:py-2.75 ${availability === 'available' ? 'lg:border-accent' : 'lg:border-border'}`}
            >
              <span className="text-[13.5px] text-text-faint lg:text-[13px]">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="flex-1 bg-transparent text-[13.5px] font-semibold text-text outline-none lg:text-[13px] lg:font-medium"
              />
            </span>
          </label>
        </form>

        <div className="mt-3 min-h-4.5">
          {availability === 'checking' && <p className="text-[11.5px] text-text-muted">Checking…</p>}
          {availability === 'available' && <p className="text-[11.5px] text-accent">This username is available</p>}
          {availability === 'taken' && (
            <p role="alert" className="text-[11.5px] text-red-400">
              That username is taken
            </p>
          )}
          {availability === 'invalid' && (
            <p role="alert" className="text-[11.5px] text-red-400">
              3-30 characters: lowercase letters, numbers, dots, underscores
            </p>
          )}
        </div>

        {profileError && (
          <p role="alert" className="mt-2 text-[11.5px] text-red-400">
            {profileError}
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSaveProfile}
            disabled={!canSaveProfile}
            className="rounded-xl bg-accent px-5 py-2.5 text-[12.5px] font-bold text-bg disabled:opacity-40"
          >
            {savingProfile ? 'Saving…' : 'Save changes'}
          </button>
          {profileSaved && !savingProfile && <span className="text-[11.5px] text-accent">Saved</span>}
        </div>
      </section>

      <div className="my-7 h-px bg-border-soft" />

      {/* APPEARANCE */}
      <section id="settings-appearance">
        <h2 className="mb-1 text-[15px] font-bold text-text">Appearance</h2>
        <p className="mb-4 text-[11.5px] text-text-muted">Accent colour tints highlights, buttons and links across BINJ.</p>
        {/* Card-wrapped on mobile, matching Privacy/Notifications below (and
            Settings.dc.html's own Appearance card) — flattens on desktop,
            matching SettingsDesktop.dc.html's bare swatch row. */}
        <div className="rounded-2xl border border-border-soft bg-surface p-4 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
          <div className="flex gap-4 overflow-x-auto pb-1">
            {ACCENT_SWATCHES.map((s) => {
              const selected = s.key === me.accentTheme
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => handlePickAccent(s.key)}
                  aria-pressed={selected}
                  aria-label={s.label}
                  className="flex flex-none flex-col items-center gap-1.5"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full p-0.75" style={{ border: selected ? `2px solid ${s.hex}` : '2px solid transparent' }}>
                    <span className="h-full w-full rounded-full" style={{ background: s.hex }} />
                  </span>
                  <span className="text-[10px] font-semibold text-text-secondary">{s.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      <div className="my-7 h-px bg-border-soft" />

      {/* PRIVACY */}
      <section id="settings-privacy">
        <h2 className="mb-1 text-[15px] font-bold text-text">Privacy</h2>
        <p className="mb-4 text-[11.5px] text-text-muted">Control what visitors see and how people connect with you.</p>
        <div className="overflow-hidden rounded-2xl border border-border-soft bg-surface">
          <div className="flex items-center gap-3.5 border-b border-border-soft px-4.5 py-4">
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-text">Show my watched list</p>
              <p className="mt-0.5 text-[11px] text-text-muted">Anyone who visits your profile can see it.</p>
            </div>
            <ToggleSwitch checked={me.listVisible} onChange={() => togglePrivacyField('listVisible')} label="Show my watched list" />
          </div>
          <div className="flex items-center gap-3.5 border-b border-border-soft px-4.5 py-4">
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-text">Approve followers manually</p>
              <p className="mt-0.5 text-[11px] text-text-muted">People send a request instead of following instantly.</p>
            </div>
            <ToggleSwitch checked={me.followRequiresApproval} onChange={() => togglePrivacyField('followRequiresApproval')} label="Approve followers manually" />
          </div>
          <div className="flex items-center gap-3.5 px-4.5 py-4">
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-text">Hide me from public Discover suggestions</p>
              <p className="mt-0.5 text-[11px] text-text-muted">Keeps you out of "People you might vibe with" for visitors who haven't signed in yet.</p>
            </div>
            <ToggleSwitch
              checked={me.hideFromDiscovery}
              onChange={() => togglePrivacyField('hideFromDiscovery')}
              label="Hide me from public Discover suggestions"
            />
          </div>
        </div>
      </section>

      <div className="my-7 h-px bg-border-soft" />

      {/* NOTIFICATIONS */}
      <section id="settings-notifications">
        <h2 className="mb-1 text-[15px] font-bold text-text">Notifications</h2>
        <p className="mb-4 text-[11.5px] text-text-muted">BINJ always shows in-app notifications. Email is optional.</p>
        <div className="overflow-hidden rounded-2xl border border-border-soft bg-surface">
          <div className="flex items-center gap-3.5 px-4.5 py-4">
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-text">Email me about activity</p>
              <p className="mt-0.5 text-[11px] text-text-muted">Event reminders, new followers and room replies.</p>
            </div>
            <ToggleSwitch checked={me.notificationPrefs.emailEnabled} onChange={toggleEmailNotifications} label="Email me about activity" />
          </div>
        </div>
      </section>

      <div className="my-7 h-px bg-border-soft" />

      {/* ACCOUNT */}
      <section id="settings-account">
        <h2 className="mb-1 text-[15px] font-bold text-text">Account</h2>
        <p className="mb-4 text-[11.5px] text-text-muted">
          Signed in with {provider === 'GOOGLE' ? 'Google' : provider === 'MICROSOFT' ? 'Microsoft' : 'email'} as {me.email}.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-9 rounded-[10px] border border-border bg-surface-alt px-4.5 py-2.75">
            <span className="text-[12.5px] font-semibold text-text">{me.email}</span>
            <span className="text-[10px] font-bold text-text-muted">{provider}</span>
          </div>
          <button type="button" onClick={() => void signOutUser()} className="flex items-center gap-2 rounded-[10px] border border-border bg-surface-alt px-4.5 py-2.75 text-[12.5px] font-bold text-red-400">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            Sign out
          </button>
        </div>

        <button type="button" disabled title="Coming soon" className="mt-5 cursor-default text-[11px] font-semibold text-text-faint">
          Delete account
        </button>
      </section>
    </div>
  )

  return (
    <div className="flex min-h-svh bg-bg text-text lg:h-svh">
      <Sidebar active="settings" />
      <main className="min-w-0 flex-1 lg:flex lg:flex-col">
        {/* QA (docs/qa/settings-bugs.md #1): passing our own live `me` here
            (rather than letting AppHeader fetch its own once on mount) is
            what makes a saved displayName/etc. show up in the header
            immediately instead of only after a reload. */}
        <AppHeader onSignOut={() => void signOutUser()} me={me} />
        {/* Desktop-only page title — SettingsDesktop.dc.html's own content top
            bar shows "Settings" here; AppHeader above is the shared
            search/notifications/avatar bar every page reuses and has no page
            title of its own, and the mobile header's <h1> is lg:hidden. */}
        <div className="hidden items-center border-b border-border-soft px-7 py-4.5 lg:flex">
          <h1 className="text-[18px] font-bold text-text">Settings</h1>
        </div>
        <div className="lg:flex lg:min-h-0 lg:flex-1 lg:overflow-hidden">
          {/* desktop settings sub-nav — a static section index, not a scroll-spy;
              the mockup never shows any row but Profile as active. */}
          <nav aria-label="Settings sections" className="hidden w-53 flex-none flex-col gap-0.75 border-r border-border-soft px-3.5 py-5.5 lg:flex">
            <a href="#settings-profile" className="rounded-[9px] bg-[rgba(var(--accent-rgb),0.12)] px-3 py-2.25 text-[12.5px] font-bold text-accent">
              Profile
            </a>
            <a href="#settings-appearance" className="px-3 py-2.25 text-[12.5px] font-semibold text-text-secondary">
              Appearance
            </a>
            <a href="#settings-privacy" className="px-3 py-2.25 text-[12.5px] font-semibold text-text-secondary">
              Privacy
            </a>
            <a href="#settings-notifications" className="px-3 py-2.25 text-[12.5px] font-semibold text-text-secondary">
              Notifications
            </a>
            <a href="#settings-account" className="px-3 py-2.25 text-[12.5px] font-semibold text-text-secondary">
              Account
            </a>
          </nav>
          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">{content}</div>
        </div>
        <MobileTabBar active="profile" />
      </main>
    </div>
  )
}
