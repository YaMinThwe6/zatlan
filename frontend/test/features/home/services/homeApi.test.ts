import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../../../src/lib/firebase', () => ({
  auth: { currentUser: null },
  googleProvider: {}
}))

const { getUpcomingEvents } = await import('../../../../src/features/home/services/homeApi')
const mockAuth = (await import('../../../../src/lib/firebase')).auth as unknown as {
  currentUser: { getIdToken: () => Promise<string> } | null
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  mockAuth.currentUser = null
})

// Real bug, reported repeatedly before this was traced down: getUpcomingEvents
// never opted into auth at all, so every call — from a signed-in Home page,
// Watch together, or the Events page — went out with no Authorization header.
// Backend's optionalAuth route then had no idea who was asking and always
// answered as if to a guest, so joined/pending came back false regardless of
// the caller's real relationship to each event. Every component consuming
// this already had the right fallback logic (event.joined/event.pending) —
// none of it mattered because the data itself was never personalized.
describe('getUpcomingEvents', () => {
  it('attaches the Bearer token when the caller is signed in', async () => {
    mockAuth.currentUser = { getIdToken: vi.fn().mockResolvedValue('fake-id-token') } as never
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, message: 'OK', statusCode: 200, data: { items: [] } })
    }) as unknown as typeof fetch

    await getUpcomingEvents()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/events/upcoming'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer fake-id-token' }) })
    )
  })

  it('still succeeds with no Authorization header when signed out — the guest Discover teaser depends on this', async () => {
    mockAuth.currentUser = null
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, message: 'OK', statusCode: 200, data: { items: [] } })
    }) as unknown as typeof fetch

    await expect(getUpcomingEvents()).resolves.toEqual({ items: [] })
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.headers.Authorization).toBeUndefined()
  })
})
