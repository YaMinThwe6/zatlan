import { describe, it, expect, vi, afterEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const signInWithGoogle = vi.fn()
const signInWithMicrosoft = vi.fn()
const signInWithToken = vi.fn()

vi.mock('../../../../src/lib/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    signInWithGoogle,
    signInWithMicrosoft,
    signInWithToken,
    signOutUser: vi.fn()
  })
}))

const { Welcome } = await import('../../../../src/features/auth/components/Welcome')

// Welcome now navigates for real between its own sub-routes (splash ->
// /get-started/signup or /login -> /get-started/verify), not just internal
// state — registers the same four paths App.tsx does, all pointing at the
// same <Welcome /> component instance, matching how it's actually reached.
function render() {
  return rtlRender(
    <MemoryRouter initialEntries={['/get-started']}>
      <Routes>
        <Route path="/get-started" element={<Welcome />} />
        <Route path="/get-started/signup" element={<Welcome />} />
        <Route path="/get-started/login" element={<Welcome />} />
        <Route path="/get-started/verify" element={<Welcome />} />
        <Route path="/" element={<p>Discover page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
  signInWithGoogle.mockClear()
  signInWithMicrosoft.mockClear()
  signInWithToken.mockClear()
})

describe('Welcome — splash', () => {
  it('shows the logo, tagline, Get Started, and a Log in link', () => {
    render()
    // Mobile and desktop each render their own copy of the wordmark/tagline,
    // toggled by CSS breakpoint (md:hidden / hidden md:block) — both exist in
    // the DOM regardless of viewport since jsdom doesn't evaluate media
    // queries, so at least one match is what a real viewport would show.
    expect(screen.getAllByText('ZATLAN').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/stories are better together/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /^get started$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /already have an account/i })).toBeInTheDocument()
  })

  it('opens the sign-in form with signup framing when Get Started is clicked', () => {
    render()
    fireEvent.click(screen.getByRole('button', { name: /^get started$/i }))
    expect(screen.getAllByText(/create your account/i).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /continue with google/i }).length).toBeGreaterThan(0)
  })

  it('opens the same sign-in form with login framing when "Log in" is clicked', () => {
    render()
    fireEvent.click(screen.getByRole('button', { name: /already have an account/i }))
    expect(screen.getAllByText(/welcome back/i).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /continue with google/i }).length).toBeGreaterThan(0)
  })
})

describe('Welcome — per-stage URLs', () => {
  it('Back from the signup form returns to the splash', () => {
    render()
    fireEvent.click(screen.getByRole('button', { name: /^get started$/i }))
    expect(screen.getAllByText(/create your account/i).length).toBeGreaterThan(0)

    fireEvent.click(screen.getAllByRole('button', { name: /^back$/i })[0])
    expect(screen.getByRole('button', { name: /^get started$/i })).toBeInTheDocument()
    expect(screen.queryByText(/create your account/i)).not.toBeInTheDocument()
  })

  it('Back from verify returns to the form it came from, framing intact', async () => {
    globalThis.fetch = vi.fn((url: string) => {
      if (url.includes('/auth/email/start')) {
        return Promise.resolve({ ok: true, status: 204, json: async () => undefined })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    render()
    fireEvent.click(screen.getByRole('button', { name: /already have an account/i })) // login framing
    fireEvent.change(screen.getAllByLabelText(/email address/i)[0], { target: { value: 'a@example.com' } })
    fireEvent.click(screen.getAllByRole('button', { name: /send me a code/i })[0])

    await waitFor(() => expect(screen.getAllByText(/check your email/i).length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByRole('button', { name: /^back$/i })[0])

    expect(screen.getAllByText(/welcome back/i).length).toBeGreaterThan(0) // still login framing, not reset to signup
  })

  it('a direct load of /get-started/verify with an email in the URL shows it and can resend', async () => {
    globalThis.fetch = vi.fn((url: string) => {
      if (url.includes('/auth/email/start')) {
        return Promise.resolve({ ok: true, status: 204, json: async () => undefined })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    rtlRender(
      <MemoryRouter initialEntries={['/get-started/verify?email=a%40example.com&intent=login']}>
        <Routes>
          <Route path="/get-started/verify" element={<Welcome />} />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getAllByText('a@example.com').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: /resend code/i })[0])
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/email/start'),
        expect.objectContaining({ body: JSON.stringify({ email: 'a@example.com' }) })
      )
    )
  })
})

describe('Welcome — OAuth providers', () => {
  it('calls signInWithGoogle when "Continue with Google" is clicked', () => {
    render()
    fireEvent.click(screen.getByRole('button', { name: /^get started$/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /continue with google/i })[0])
    expect(signInWithGoogle).toHaveBeenCalledTimes(1)
  })

  it('calls signInWithMicrosoft when "Continue with Microsoft" is clicked', () => {
    render()
    fireEvent.click(screen.getByRole('button', { name: /^get started$/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /continue with microsoft/i })[0])
    expect(signInWithMicrosoft).toHaveBeenCalledTimes(1)
  })
})

describe('Welcome — Email + OTP flow', () => {
  it('walks through send-code then verify-code, then signs in with the returned custom token', async () => {
    globalThis.fetch = vi.fn((url: string) => {
      if (url.includes('/auth/email/start')) {
        return Promise.resolve({ ok: true, status: 204, json: async () => undefined })
      }
      if (url.includes('/auth/email/verify')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, message: 'OK', statusCode: 200, data: { customToken: 'fake-custom-token' } }),
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    render()
    fireEvent.click(screen.getByRole('button', { name: /^get started$/i }))

    fireEvent.change(screen.getAllByLabelText(/email address/i)[0], {
      target: { value: 'a@example.com' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /send me a code/i })[0])

    await waitFor(() =>
      expect(screen.getAllByLabelText(/verification code/i).length).toBeGreaterThan(0)
    )
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/email/start'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'a@example.com' }) })
    )

    fireEvent.change(screen.getAllByLabelText(/verification code/i)[0], {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /verify & continue/i })[0])

    await waitFor(() => expect(signInWithToken).toHaveBeenCalledWith('fake-custom-token'))
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/email/verify'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'a@example.com', code: '123456' }) })
    )
  })

  it('shows an error message when verification fails', async () => {
    globalThis.fetch = vi.fn((url: string) => {
      if (url.includes('/auth/email/start')) {
        return Promise.resolve({ ok: true, status: 204, json: async () => undefined })
      }
      if (url.includes('/auth/email/verify')) {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ success: false, message: 'Incorrect code', code: 'INVALID_CODE', statusCode: 400 }),
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    render()
    fireEvent.click(screen.getByRole('button', { name: /^get started$/i }))

    fireEvent.change(screen.getAllByLabelText(/email address/i)[0], { target: { value: 'a@example.com' } })
    fireEvent.click(screen.getAllByRole('button', { name: /send me a code/i })[0])

    await waitFor(() => screen.getAllByLabelText(/verification code/i)[0])
    fireEvent.change(screen.getAllByLabelText(/verification code/i)[0], { target: { value: '000000' } })
    fireEvent.click(screen.getAllByRole('button', { name: /verify & continue/i })[0])

    await waitFor(() => expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Incorrect code'))
    expect(signInWithToken).not.toHaveBeenCalled()
  })
})
