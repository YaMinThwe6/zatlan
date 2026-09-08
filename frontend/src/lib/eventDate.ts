// Shared by every place an event's date/time is rendered — Home's
// UpcomingEvents/NearbyEvents, the guest Discover teaser, WatchTogether,
// the Events page, and its detail page. All of them used to duplicate this
// formatter, each one silently dropping the year — fine while every event
// was necessarily within the next few months, but with no dedicated
// endpoint capping how far out an event can be scheduled, a Dec 31 slot
// reads as "this year" even for one dated a year or more out. The year is
// included only when it isn't the current one, so the common case (an event
// this year) stays exactly as compact as before.
export function formatEventDate(iso: string | null, opts: { weekday?: 'short' | 'long' } = {}): string {
  if (!iso) return ''
  const d = new Date(iso)
  const includeYear = d.getFullYear() !== new Date().getFullYear()
  const datePart = d.toLocaleDateString(undefined, {
    weekday: opts.weekday ?? 'short',
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' as const } : {})
  })
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${datePart} · ${timePart}`
}

export type EventDateGroup = 'this-week' | 'weekend' | 'next-week' | 'later'

function startOfDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d)
  c.setDate(c.getDate() + n)
  return c
}

// The Events page's date-grouping headers ("This week" / "This weekend" /
// "Next week" / "Later"). Weeks run Monday–Sunday; "this week"'s Saturday and
// Sunday are pulled out into their own "weekend" bucket (the two chosen
// buckets from the card-redesign brainstorm), everything Mon–Fri before that
// stays "this week", the following Monday–Sunday is "next week", and
// anything past that is "later".
export function eventDateGroup(iso: string | null, now: Date = new Date()): EventDateGroup {
  if (!iso) return 'later'

  const today = startOfDay(now)
  const isoDayOfWeek = today.getDay() === 0 ? 7 : today.getDay() // Mon=1..Sun=7
  const saturdayThisWeek = addDays(today, 6 - isoDayOfWeek)
  const mondayNextWeek = addDays(today, 8 - isoDayOfWeek)
  const sundayNextWeek = addDays(mondayNextWeek, 6)

  const d = startOfDay(new Date(iso))
  if (d >= mondayNextWeek && d <= sundayNextWeek) return 'next-week'
  if (d >= saturdayThisWeek && d < mondayNextWeek) return 'weekend'
  if (d < saturdayThisWeek) return 'this-week'
  return 'later'
}
