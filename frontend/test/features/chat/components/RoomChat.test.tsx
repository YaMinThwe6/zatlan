import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'

const getRoom = vi.fn()
const sendMessage = vi.fn()
const deleteMessage = vi.fn()
const subscribeToMessages = vi.fn()
const unsubscribe = vi.fn()
const reportContent = vi.fn()
const getMe = vi.fn()
const getNotifications = vi.fn()

vi.mock('../../../../src/features/chat/services/roomApi', () => ({ getRoom, sendMessage, deleteMessage, subscribeToMessages }))
vi.mock('../../../../src/lib/api', () => ({ reportContent, getMe }))
// AppHeader's own dependencies — it's now part of RoomChat's shared shell
// (Sidebar/AppHeader/MobileTabBar on every signed-in page).
vi.mock('../../../../src/features/home/services/homeApi', () => ({ getNotifications }))
vi.mock('../../../../src/lib/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'uid-1' },
    loading: false,
    signInWithGoogle: vi.fn(),
    signInWithMicrosoft: vi.fn(),
    signInWithToken: vi.fn(),
    signOutUser: vi.fn()
  })
}))

const { RoomChat } = await import('../../../../src/features/chat/components/RoomChat')

const messages = [
  { messageId: 'm1', authorId: 'uid-1', text: 'Hey everyone!', createdAt: '2026-01-01T20:00:00.000Z', editedAt: null, deleted: false },
  { messageId: 'm2', authorId: 'uid-2', text: 'On my way', createdAt: '2026-01-01T20:01:00.000Z', editedAt: null, deleted: false },
  { messageId: 'm3', authorId: 'uid-2', text: 'this got removed', createdAt: '2026-01-01T20:02:00.000Z', editedAt: null, deleted: true }
]

beforeEach(() => {
  // AppHeader's own fetches — not under test here, just needs to resolve so
  // the shared shell renders without throwing.
  getMe.mockResolvedValue({ uid: 'uid-1', displayName: 'Arjun', email: 'arjun@example.com' })
  getNotifications.mockResolvedValue({ items: [] })
  getRoom.mockResolvedValue({
    roomId: 'room-1',
    type: 'ephemeral',
    eventTitle: 'Rooftop watch',
    members: [
      { uid: 'uid-1', displayName: 'Arjun' },
      { uid: 'uid-2', displayName: 'Rohan' }
    ]
  })
})

afterEach(() => {
  getRoom.mockReset()
  sendMessage.mockReset()
  deleteMessage.mockReset()
  subscribeToMessages.mockReset()
  unsubscribe.mockReset()
  reportContent.mockReset()
  getMe.mockReset()
  getNotifications.mockReset()
})

function mockSubscription(msgs: typeof messages) {
  subscribeToMessages.mockImplementation((_roomId: string, onMessages: (m: typeof messages) => void) => {
    onMessages(msgs)
    return unsubscribe
  })
}

// Seeds two history entries so the "Back" button's navigate(-1) has
// somewhere real to go — a bare single-entry history can't go back further.
function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/', '/rooms/room-1']} initialIndex={1}>
      <Routes>
        <Route path="/" element={<p>Previous page</p>} />
        <Route path="/rooms/:roomId" element={<RoomChat />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('RoomChat', () => {
  it('subscribes to the room on mount and renders non-deleted messages', () => {
    mockSubscription(messages)
    renderWithRouter()

    expect(subscribeToMessages).toHaveBeenCalledWith('room-1', expect.any(Function))
    expect(screen.getByText('Hey everyone!')).toBeInTheDocument()
    expect(screen.getByText('On my way')).toBeInTheDocument()
    expect(screen.queryByText('this got removed')).not.toBeInTheDocument()
  })

  it("shows the event's title as the page heading, not the generic 'Room chat'", async () => {
    mockSubscription(messages)
    renderWithRouter()

    expect(await screen.findByRole('heading', { name: 'Rooftop watch' })).toBeInTheDocument()
    expect(screen.queryByText('Room chat')).not.toBeInTheDocument()
  })

  it("labels each other member's message with their display name", async () => {
    mockSubscription(messages)
    renderWithRouter()

    // m2 is from uid-2 (Rohan). "Arjun" (the caller, uid-1) legitimately
    // appears elsewhere on the page (AppHeader's own identity), so this
    // checks the label sits right next to their message, not just that the
    // text exists anywhere on the page.
    const rohanLabel = await screen.findByText('Rohan')
    expect(rohanLabel.closest('li')).toHaveTextContent('On my way')
  })

  it('unsubscribes on unmount', () => {
    mockSubscription(messages)
    const { unmount } = renderWithRouter()
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('re-subscribes when the route\'s roomId changes', async () => {
    mockSubscription(messages)
    // Same mounted RoomChat instance across a route param change — proves
    // the subscription effect reacts to useParams() changing, not just to
    // a fresh mount. Real navigation via a Link, not rerender(), since
    // useParams() only updates on an actual route transition.
    render(
      <MemoryRouter initialEntries={['/rooms/room-1']}>
        <Routes>
          <Route
            path="/rooms/:roomId"
            element={
              <>
                <Link to="/rooms/room-2">Go to room 2</Link>
                <RoomChat />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    )
    expect(subscribeToMessages).toHaveBeenCalledWith('room-1', expect.any(Function))

    fireEvent.click(screen.getByText('Go to room 2'))

    await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1))
    expect(subscribeToMessages).toHaveBeenCalledWith('room-2', expect.any(Function))
  })

  it('sends a message and clears the draft', async () => {
    mockSubscription(messages)
    sendMessage.mockResolvedValue({ messageId: 'm4', createdAt: '2026-01-01T20:03:00.000Z' })
    renderWithRouter()

    fireEvent.change(screen.getByLabelText(/message/i), { target: { value: 'Starting now!' } })
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }))

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('room-1', 'Starting now!'))
    expect(screen.getByLabelText(/message/i)).toHaveValue('')
  })

  it('shows an error and keeps the draft when sending fails', async () => {
    mockSubscription(messages)
    sendMessage.mockRejectedValue(new Error('network error'))
    renderWithRouter()

    fireEvent.change(screen.getByLabelText(/message/i), { target: { value: 'oops' } })
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('network error'))
    expect(screen.getByLabelText(/message/i)).toHaveValue('oops')
  })

  it('only offers Delete on the caller\'s own messages', () => {
    mockSubscription(messages)
    renderWithRouter()

    expect(screen.getAllByRole('button', { name: /delete/i })).toHaveLength(1) // only m1, authored by uid-1
  })

  it('deletes a message on click', async () => {
    mockSubscription(messages)
    deleteMessage.mockResolvedValue(undefined)
    renderWithRouter()

    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    await waitFor(() => expect(deleteMessage).toHaveBeenCalledWith('room-1', 'm1'))
  })

  it('navigates back when Back is clicked', async () => {
    mockSubscription(messages)
    renderWithRouter()

    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(await screen.findByText('Previous page')).toBeInTheDocument()
  })

  it('only offers Report on other people\'s messages, not the caller\'s own', () => {
    mockSubscription(messages)
    renderWithRouter()

    expect(screen.getAllByRole('button', { name: /^report$/i })).toHaveLength(1) // only m2, authored by uid-2
  })

  it('opens a reason form on Report, and submits it to reportContent', async () => {
    mockSubscription(messages)
    reportContent.mockResolvedValue({
      reportId: 'rep-1',
      status: 'actioned',
      decision: {
        violates: true,
        category: 'harassment',
        contentAction: 'remove',
        accountAction: 'warn',
        suspensionDays: null,
        confidence: 0.8,
        rationale: 'This was harassment.',
        flaggedForReview: false,
        resolvedAt: '2026-01-01T20:05:00.000Z'
      }
    })
    renderWithRouter()

    fireEvent.click(screen.getByRole('button', { name: /^report$/i }))
    fireEvent.change(screen.getByLabelText(/why are you reporting/i), { target: { value: 'being rude' } })
    fireEvent.click(screen.getByRole('button', { name: /submit report/i }))

    await waitFor(() =>
      expect(reportContent).toHaveBeenCalledWith({ targetType: 'message', targetId: 'm2', roomId: 'room-1', reason: 'being rude' })
    )
    expect(await screen.findByText(/action taken/i)).toHaveTextContent('This was harassment.')
    expect(screen.queryByLabelText(/why are you reporting/i)).not.toBeInTheDocument()
  })

  it('mentions when a decision was low-confidence and flagged for human review', async () => {
    mockSubscription(messages)
    reportContent.mockResolvedValue({
      reportId: 'rep-2',
      status: 'dismissed',
      decision: {
        violates: false,
        category: 'legitimate-discussion',
        contentAction: 'none',
        accountAction: 'none',
        suspensionDays: null,
        confidence: 0.3,
        rationale: 'Unclear.',
        flaggedForReview: true,
        resolvedAt: '2026-01-01T20:05:00.000Z'
      }
    })
    renderWithRouter()

    fireEvent.click(screen.getByRole('button', { name: /^report$/i }))
    fireEvent.change(screen.getByLabelText(/why are you reporting/i), { target: { value: 'not sure' } })
    fireEvent.click(screen.getByRole('button', { name: /submit report/i }))

    expect(await screen.findByText(/flagged for human review/i)).toBeInTheDocument()
  })

  it('closes the report form on Cancel without submitting', () => {
    mockSubscription(messages)
    renderWithRouter()

    fireEvent.click(screen.getByRole('button', { name: /^report$/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.queryByLabelText(/why are you reporting/i)).not.toBeInTheDocument()
    expect(reportContent).not.toHaveBeenCalled()
  })
})
