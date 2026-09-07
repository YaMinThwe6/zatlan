import { useEffect, useState } from 'react'
import { getTasteMatches, followUser, unfollowUser, type TasteMatch } from '../services/homeApi'

// Shared by PeopleYouMightVibeWith (Home widget, default small limit) and
// PeopleDiscovery (/people page, larger explicit limit) — same fetch +
// optimistic connect/unfollow toggle either way, just a different `limit`.
export function usePersonSuggestions(limit?: number) {
  const [items, setItems] = useState<TasteMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    // A caller can unmount mid-fetch (e.g. navigating away right after
    // landing) — guard against setting state on an unmounted component when
    // the response lands late.
    let cancelled = false
    setLoading(true)
    getTasteMatches(limit)
      .then((res) => {
        if (!cancelled) setItems(res.items)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load matches')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [limit])

  async function toggleConnect(uid: string) {
    const current = items.find((i) => i.uid === uid)
    if (!current) return

    if (current.relationship === 'none') {
      setItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, relationship: 'pending' } : i)))
      try {
        const { status } = await followUser(uid)
        setItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, relationship: status } : i)))
      } catch (err) {
        setItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, relationship: 'none' } : i)))
        setError(err instanceof Error ? err.message : 'Failed to connect')
      }
    } else {
      const previous = current.relationship
      setItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, relationship: 'none' } : i)))
      try {
        await unfollowUser(uid)
      } catch (err) {
        setItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, relationship: previous } : i)))
        setError(err instanceof Error ? err.message : 'Failed to update')
      }
    }
  }

  return { items, loading, error, toggleConnect }
}
