import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { getMe, type Me } from './lib/api'
import { useAuth } from './lib/AuthContext'
import { applyAccentTheme } from './lib/theme'
import { Welcome } from './features/auth/components/Welcome'
import { OnboardingWizard } from './features/onboarding/components/OnboardingWizard'
import { Home } from './features/home/components/Home'
import { MovieSearch } from './features/movie/components/MovieSearch'
import { MovieDetail } from './features/movie/components/MovieDetail'
import { Profile } from './features/profile/components/Profile'
import { PeopleDiscovery } from './features/people/components/PeopleDiscovery'
import { Settings } from './features/settings/components/Settings'
import { RoomChat } from './features/chat/components/RoomChat'
import { About } from './features/about/components/About'
import './App.css'

function App() {
  const { user, loading: authLoading, signOutUser } = useAuth()
  const [me, setMe] = useState<Me | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!user) {
      setMe(null)
      return
    }
    getMe()
      .then(setMe)
      .catch((err) => setErrorMessage(err instanceof Error ? err.message : 'Failed to load profile'))
  }, [user])

  useEffect(() => {
    applyAccentTheme(me?.accentTheme)
  }, [me?.accentTheme])

  if (authLoading) {
    return (
      <main className="app">
        <p>Loading…</p>
      </main>
    )
  }

  // Root "/" for a signed-out visitor is public movie discovery, not an auth
  // wall — Welcome (/get-started) only opens once they actually choose to
  // sign in (Get Started, Log in, or an auth-gated action on a movie's page).
  if (!user) {
    return (
      <Routes>
        <Route path="/get-started" element={<Welcome />} />
        <Route path="/get-started/signup" element={<Welcome />} />
        <Route path="/get-started/login" element={<Welcome />} />
        <Route path="/get-started/verify" element={<Welcome />} />
        <Route path="/movie/:movieId" element={<MovieDetail />} />
        <Route path="/story" element={<About />} />
        <Route path="*" element={<MovieSearch />} />
      </Routes>
    )
  }

  if (me && (me.isNewUser || !me.onboardingComplete)) {
    return (
      <OnboardingWizard
        initialDisplayName={me.displayName || user.displayName || ''}
        email={me.email || user.email || ''}
        // isNewUser is server-computed true only on the one bootstrap GET
        // /users/me right after account creation (see users.service.ts) —
        // nothing ever naturally resets it to false client-side afterward,
        // so without setting it here too, the gate above (isNewUser ||
        // !onboardingComplete) never releases even once onboarding finishes.
        onComplete={() => setMe({ ...me, onboardingComplete: true, isNewUser: false })}
      />
    )
  }

  if (errorMessage && !me) {
    return (
      <main className="app">
        <p role="alert">{errorMessage}</p>
      </main>
    )
  }

  if (!me) {
    return (
      <main className="app">
        <p>Loading…</p>
      </main>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<Home me={me} onSignOut={() => void signOutUser()} />} />
      <Route path="/search" element={<MovieSearch />} />
      <Route path="/movie/:movieId" element={<MovieDetail />} />
      <Route path="/people" element={<PeopleDiscovery />} />
      <Route path="/profile/:uid" element={<Profile />} />
      <Route path="/settings" element={<Settings me={me} onUpdateMe={setMe} />} />
      <Route path="/rooms/:roomId" element={<RoomChat />} />
      <Route path="/story" element={<About />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
