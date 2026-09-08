import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getNotifications, markNotificationRead, clearAllNotifications, type NotificationItem } from '../features/home/services/homeApi'
import { notificationText, notificationTarget, formatNotificationTime } from '../lib/notificationCopy'

const DROPDOWN_LIMIT = 8

// The bell icon shared by AppHeader (desktop) and Home.tsx's own mobile
// header — previously each hand-rolled its own copy that only ever showed an
// unread count with no click handler at all. Now a single component: click
// opens a compact dropdown of recent notifications, with "View all" (the
// full /notifications page) and "Clear all" (bulk mark-read). Inbox
// (direct messages) is a separate, still-disabled nav item — deliberately
// not the same feature as this.
export function NotificationBell() {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [items, setItems] = useState<NotificationItem[] | null>(null)

  useEffect(() => {
    let cancelled = false
    getNotifications(true)
      .then((res) => {
        if (!cancelled) setUnreadCount(res.items.length)
      })
      .catch(() => {
        if (!cancelled) setUnreadCount(0)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  function toggleOpen() {
    if (!open) {
      getNotifications()
        .then((res) => setItems(res.items.slice(0, DROPDOWN_LIMIT)))
        .catch(() => setItems([]))
    }
    setOpen((prev) => !prev)
  }

  function handleOpenItem(item: NotificationItem) {
    const target = notificationTarget(item)
    if (!item.read) {
      setItems((prev) => (prev ? prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)) : prev))
      setUnreadCount((prev) => Math.max(0, prev - 1))
      markNotificationRead(item.id).catch(() => {
        // Not worth surfacing — read state already flipped optimistically.
      })
    }
    setOpen(false)
    if (target) navigate(target)
  }

  function handleViewAll() {
    setOpen(false)
    navigate('/notifications')
  }

  function handleClearAll() {
    setItems((prev) => (prev ? prev.map((n) => ({ ...n, read: true })) : prev))
    setUnreadCount(0)
    clearAllNotifications().catch(() => {
      // Not worth surfacing — worst case a few stay unread server-side.
    })
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-label={`${unreadCount} unread notifications`}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-[10px] border border-border-soft bg-surface-alt"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent px-1 text-[9.5px] font-bold text-bg">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-20 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border-soft bg-surface shadow-lg"
        >
          <div className="max-h-96 overflow-y-auto p-2">
            {items === null && <p className="px-3 py-4 text-[12.5px] text-text-muted">Loading…</p>}
            {items !== null && items.length === 0 && <p className="px-3 py-4 text-[12.5px] text-text-muted">No notifications yet.</p>}
            {items !== null && items.length > 0 && (
              <ul className="flex flex-col gap-0.5">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => handleOpenItem(item)}
                      className={
                        item.read
                          ? 'flex w-full items-start gap-2 rounded-xl px-2.5 py-2.5 text-left'
                          : 'flex w-full items-start gap-2 rounded-xl bg-[rgba(var(--accent-rgb),0.07)] px-2.5 py-2.5 text-left'
                      }
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] text-text">{notificationText(item)}</p>
                        <p className="mt-0.5 text-[10.5px] text-text-muted">{formatNotificationTime(item.createdAt)}</p>
                      </div>
                      {!item.read && <span aria-label="Unread" className="mt-1.5 h-2 w-2 flex-none rounded-full bg-accent" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-border-soft px-3 py-2.5">
            <button type="button" onClick={handleClearAll} className="text-[11.5px] font-semibold text-text-muted">
              Clear all
            </button>
            <button type="button" onClick={handleViewAll} className="text-[11.5px] font-bold text-accent">
              View all
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
