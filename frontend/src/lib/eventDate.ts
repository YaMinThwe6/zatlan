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
