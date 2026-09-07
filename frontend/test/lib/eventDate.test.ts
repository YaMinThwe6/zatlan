import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatEventDate } from '../../src/lib/eventDate'

afterEach(() => {
  vi.useRealTimers()
})

describe('formatEventDate', () => {
  it('returns an empty string for null', () => {
    expect(formatEventDate(null)).toBe('')
  })

  it('omits the year when the event falls within the current year', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
    const result = formatEventDate('2026-12-25T20:00:00.000Z')
    expect(result).not.toContain('2026')
  })

  it('includes the year when the event falls in a later year — the real bug: Dec 31 read as "this year" even a year or more out', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
    const result = formatEventDate('2027-01-15T20:00:00.000Z')
    expect(result).toContain('2027')
  })

  it('includes the year for a past-dated year too, not just future ones', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'))
    const result = formatEventDate('2026-12-25T20:00:00.000Z')
    expect(result).toContain('2026')
  })

  it('respects a "long" weekday option while still applying the same year rule', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
    const result = formatEventDate('2027-01-15T20:00:00.000Z', { weekday: 'long' })
    expect(result).toContain('2027')
  })
})
