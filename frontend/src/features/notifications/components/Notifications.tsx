import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../lib/AuthContext'
import { getNotifications, markNotificationRead, clearAllNotifications, type NotificationItem } from '../../home/services/homeApi'
import { notificationText, notificationTarget, formatNotificationTime } from '../../../lib/notificationCopy'
import { Sidebar } from '../../../components/Sidebar'
import { AppHeader } from '../../../components/AppHeader'
import { MobileTabBar } from '../../../components/MobileTabBar'

function NotificationRow({ item, onOpen }: { item: NotificationItem; onOpen: (item: NotificationItem) => void }) {
  const initial = (item.fromUserDisplayName || '?').charAt(0).toUpperCase()
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className={
          item.read
            ? 'flex w-full items-start gap-3 rounded-xl px-3.5 py-3 text-left'
            : 'flex w-full items-start gap-3 rounded-xl bg-[rgba(var(--accent-rgb),0.07)] px-3.5 py-3 text-left'
        }
      >
        <div className="h-9 w-9 flex-none overflow-hidden rounded-full border border-[rgba(124,140,166,0.32)] bg-[rgba(124,140,166,0.14)]">
          {item.fromUserPhotoURL ? (
            <img src={item.fromUserPhotoURL} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[12px] font-bold text-[#9BABC4]">{initial}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-text">{notificationText(item)}</p>
          <p className="mt-0.5 text-[11px] text-text-muted">{formatNotificationTime(item.createdAt)}</p>
        </div>
        {!item.read && <span aria-label="Unread" className="mt-1.5 h-2 w-2 flex-none rounded-full bg-accent" />}
      </button>
    </li>
  )
}

// The full notification history — GET /users/me/notifications (7 types
// write to it today: followRequest/followApproved/newFollower from
// follow.service.ts, eventJoinRequest/eventJoinApproved/eventJoinDenied and
// the eventReminder* pair from events.service.ts, chatActive from
// rooms.service.ts). Reached via "View all" on the header's NotificationBell
// dropdown, not via Sidebar/MobileTabBar's "Inbox" — Inbox is a separate,
// still-unbuilt direct-messages feature, deliberately not the same thing as
// this.
export function Notifications() {
  const navigate = useNavigate()
  const { signOutUser } = useAuth()
  const [items, setItems] = useState<NotificationItem[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    getNotifications()
      .then((res) => {
        if (!cancelled) setItems(res.items)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load notifications')
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleOpen(item: NotificationItem) {
    const target = notificationTarget(item)
    if (!item.read) {
      setItems((prev) => (prev ? prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)) : prev))
      markNotificationRead(item.id).catch(() => {
        // Not worth surfacing — the read state already flipped optimistically
        // and a background retry isn't implemented; worst case it stays
        // unread server-side and the badge count is off by one.
      })
    }
    if (target) navigate(target)
  }

  function handleClearAll() {
    setItems((prev) => (prev ? prev.map((n) => ({ ...n, read: true })) : prev))
    clearAllNotifications().catch(() => {
      // Not worth surfacing — worst case a few stay unread server-side.
    })
  }

  const hasUnread = items?.some((n) => !n.read) ?? false

  return (
    <div className="flex min-h-svh bg-bg text-text lg:h-svh">
      <Sidebar />
      <main className="min-w-0 flex-1 lg:flex lg:flex-col">
        <AppHeader onSignOut={() => void signOutUser()} />
        <div className="hidden items-center justify-between border-b border-border-soft px-7 py-4.5 lg:flex">
          <h1 className="text-[18px] font-bold text-text">Notifications</h1>
          {hasUnread && (
            <button type="button" onClick={handleClearAll} className="text-[12px] font-semibold text-text-muted">
              Clear all
            </button>
          )}
        </div>

        <div className="mx-auto w-full max-w-2xl px-5 pt-4.5 pb-10 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-7 lg:pt-6">
          <div className="mb-4 flex items-center justify-between lg:hidden">
            <h1 className="text-[19px] font-bold text-text">Notifications</h1>
            {hasUnread && (
              <button type="button" onClick={handleClearAll} className="text-[12px] font-semibold text-text-muted">
                Clear all
              </button>
            )}
          </div>

          {items === null && !error && <p className="text-sm text-text-muted">Loading…</p>}
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          {items !== null && items.length === 0 && <p className="text-sm text-text-muted">No notifications yet.</p>}
          {items !== null && items.length > 0 && (
            <ul className="flex flex-col gap-1">
              {items.map((item) => (
                <NotificationRow key={item.id} item={item} onOpen={handleOpen} />
              ))}
            </ul>
          )}
        </div>

        <MobileTabBar active="profile" />
      </main>
    </div>
  )
}
