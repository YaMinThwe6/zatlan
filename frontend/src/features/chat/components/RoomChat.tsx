import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sendMessage, deleteMessage, subscribeToMessages, type RoomMessage } from '../services/roomApi'
import { reportContent, type CreateReportResult } from '../../../lib/api'
import { useAuth } from '../../../lib/AuthContext'
import { Sidebar } from '../../../components/Sidebar'
import { AppHeader } from '../../../components/AppHeader'
import { MobileTabBar } from '../../../components/MobileTabBar'

function formatTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function describeReportResult(result: CreateReportResult): string {
  if (result.status === 'pending') return 'Reported — awaiting review.'
  if (result.status === 'error') return "Reported — couldn't be reviewed automatically, please try again."
  const flaggedNote = result.decision?.flaggedForReview ? ' (low confidence — flagged for human review.)' : ''
  if (result.status === 'dismissed') return `Reported — no violation found. ${result.decision?.rationale ?? ''}${flaggedNote}`.trim()
  return `Reported — action taken. ${result.decision?.rationale ?? ''}${flaggedNote}`.trim()
}

// hld.md §16 — messages arrive in real time via subscribeToMessages'
// Firestore onSnapshot listener, not polling; sending/deleting still goes
// through the backend (write path stays validated server-side).
export function RoomChat() {
  // Only ever mounted via the "/rooms/:roomId" route (App.tsx), so this
  // segment is always present in practice — the assertion just tells
  // TypeScript what the route already guarantees. currentUid comes straight
  // from the Firebase Auth user rather than a passed prop — its uid is the
  // same id BINJ's own profile is keyed by (hld.md §13).
  const { roomId: roomIdParam } = useParams<{ roomId: string }>()
  const roomId = roomIdParam!
  const navigate = useNavigate()
  const { user, signOutUser } = useAuth()
  const currentUid = user!.uid
  const [messages, setMessages] = useState<RoomMessage[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [reportSubmitting, setReportSubmitting] = useState(false)
  const [reportResults, setReportResults] = useState<Record<string, CreateReportResult>>({})

  useEffect(() => {
    setConnected(false)
    const unsubscribe = subscribeToMessages(roomId, (msgs) => {
      setMessages(msgs)
      setConnected(true)
    })
    return unsubscribe
  }, [roomId])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    setSending(true)
    setError('')
    try {
      await sendMessage(roomId, text)
      setDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  async function handleDelete(messageId: string) {
    try {
      await deleteMessage(roomId, messageId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete message')
    }
  }

  async function handleSubmitReport(e: React.FormEvent, messageId: string) {
    e.preventDefault()
    const reason = reportReason.trim()
    if (!reason) return
    setReportSubmitting(true)
    setError('')
    try {
      const result = await reportContent({ targetType: 'message', targetId: messageId, roomId, reason })
      setReportResults((prev) => ({ ...prev, [messageId]: result }))
      setReportingMessageId(null)
      setReportReason('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report')
    } finally {
      setReportSubmitting(false)
    }
  }

  const visibleMessages = messages.filter((m) => !m.deleted)

  return (
    <div className="flex min-h-svh bg-bg text-text lg:h-svh">
      <Sidebar />
      <main className="min-w-0 flex-1 lg:flex lg:flex-col">
        <AppHeader onSignOut={() => void signOutUser()} />

        {/* No design-canvas reference exists for this screen (it was built
            free-form, unlike the auth/onboarding/movie/profile screens) — a
            simple centered, width-capped column rather than a bespoke desktop
            layout, so the chat surface doesn't stretch edge-to-edge on a wide
            viewport. */}
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col lg:min-h-0 lg:border-x lg:border-border-soft">
          <header className="flex items-center gap-3 border-b border-border-soft px-4 py-3.5">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Back"
              className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-border-soft bg-surface-alt"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <h1 className="text-[15px] font-bold text-text">Room chat</h1>
          </header>

          {!connected && <p className="px-4 py-2 text-[12.5px] text-text-muted">Connecting…</p>}
          {error && (
            <p role="alert" className="px-4 py-2 text-[13px] text-red-400">
              {error}
            </p>
          )}

          <ul className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
            {visibleMessages.map((m) => {
          const mine = m.authorId === currentUid
          return (
            <li key={m.messageId} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
              <div
                className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                  mine ? 'rounded-br-sm bg-accent text-bg' : 'rounded-bl-sm border border-border bg-input text-text'
                }`}
              >
                {m.text}
              </div>
              <div className="mt-1 flex items-center gap-2.5 text-[10.5px] text-text-faint">
                <span>
                  {formatTime(m.createdAt)}
                  {m.editedAt ? ' (edited)' : ''}
                </span>
                {mine && (
                  <button type="button" onClick={() => handleDelete(m.messageId)} className="font-semibold text-text-muted">
                    Delete
                  </button>
                )}
                {!mine && !reportResults[m.messageId] && (
                  <button
                    type="button"
                    onClick={() => {
                      setReportingMessageId(m.messageId)
                      setReportReason('')
                    }}
                    className="font-semibold text-text-muted"
                  >
                    Report
                  </button>
                )}
              </div>

              {reportingMessageId === m.messageId && (
                <form
                  onSubmit={(e) => handleSubmitReport(e, m.messageId)}
                  className="mt-2 w-full max-w-[78%] rounded-xl border border-border bg-surface-alt p-3"
                >
                  <label htmlFor={`report-reason-${m.messageId}`} className="mb-1.5 block text-[11.5px] font-semibold text-text-secondary">
                    Why are you reporting this?
                  </label>
                  <input
                    id={`report-reason-${m.messageId}`}
                    type="text"
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    placeholder="What's wrong with this message?"
                    className="mb-2 w-full rounded-lg border border-border bg-input px-3 py-2 text-[12.5px] text-text outline-none focus:border-accent"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={reportSubmitting || reportReason.trim().length === 0}
                      className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-bold text-bg disabled:opacity-40"
                    >
                      Submit report
                    </button>
                    <button type="button" onClick={() => setReportingMessageId(null)} className="text-[12px] font-semibold text-text-muted">
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {reportResults[m.messageId] && (
                <p className="mt-1.5 max-w-[78%] text-[11.5px] text-text-muted">{describeReportResult(reportResults[m.messageId])}</p>
              )}
            </li>
          )
        })}
      </ul>

      <form onSubmit={handleSend} className="flex gap-2 border-t border-border-soft px-4 py-3">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message…"
          aria-label="Message"
          className="flex-1 rounded-xl border border-border bg-surface-alt px-4 py-2.5 text-sm text-text outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={sending || draft.trim().length === 0}
          className="rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-bg disabled:opacity-40"
        >
          Send
        </button>
      </form>
        </div>

        <MobileTabBar active="profile" />
      </main>
    </div>
  )
}
