import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatEventDate, eventDateGroup } from '../../src/lib/eventDate'

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
    const result = formatEventDate('2026-12-25T12:00:00.000Z')
    expect(result).not.toContain('2026')
  })

  it('includes the year when the event falls in a later year — the real bug: Dec 31 read as "this year" even a year or more out', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
    const result = formatEventDate('2027-01-15T12:00:00.000Z')
    expect(result).toContain('2027')
  })

  it('includes the year for a past-dated year too, not just future ones', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'))
    const result = formatEventDate('2026-12-25T12:00:00.000Z')
    expect(result).toContain('2026')
  })

  it('respects a "long" weekday option while still applying the same year rule', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
    const result = formatEventDate('2027-01-15T12:00:00.000Z', { weekday: 'long' })
    expect(result).toContain('2027')
  })
})

// "Now" is fixed to Tue Jan 6, 2026 for every case below — the Events page's
// date-grouping headers ("This week" / "This weekend" / "Next week" / "Later").
describe('eventDateGroup', () => {
  const NOW = '2026-01-06T12:00:00.000Z' // Tuesday

  afterEach(() => vi.useRealTimers())

  function group(iso: string | null) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    return eventDateGroup(iso)
  }

  it('groups null as "later" — no date to reason about', () => {
    expect(group(null)).toBe('later')
  })

  it('groups today and the rest of the current week (before Saturday) as "this-week"', () => {
    expect(group('2026-01-06T12:00:00.000Z')).toBe('this-week') // today, Tue
    expect(group('2026-01-08T12:00:00.000Z')).toBe('this-week') // Thu
    expect(group('2026-01-09T12:00:00.000Z')).toBe('this-week') // Fri
  })

  it('groups this Saturday and Sunday as "weekend"', () => {
    expect(group('2026-01-10T12:00:00.000Z')).toBe('weekend') // Sat
    expect(group('2026-01-11T12:00:00.000Z')).toBe('weekend') // Sun
  })

  it('groups the following Monday through Sunday as "next-week"', () => {
    expect(group('2026-01-12T12:00:00.000Z')).toBe('next-week') // Mon
    expect(group('2026-01-18T12:00:00.000Z')).toBe('next-week') // Sun
  })

  it('groups anything beyond next week as "later"', () => {
    expect(group('2026-01-19T12:00:00.000Z')).toBe('later') // Mon, the week after next
    expect(group('2027-06-01T12:00:00.000Z')).toBe('later')
  })
})
