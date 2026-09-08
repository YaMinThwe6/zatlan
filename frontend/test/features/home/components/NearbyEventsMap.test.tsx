import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'

// The real @vis.gl/react-google-maps loads Google's script and talks to the
// DOM in ways jsdom can't support — mocked here with plain stand-ins so the
// component tree (and our own click-handling logic) is still exercised.
vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="api-provider">{children}</div>,
  Map: ({ children }: { children: React.ReactNode }) => <div data-testid="map">{children}</div>,
  AdvancedMarker: ({ title, onClick }: { title?: string; onClick?: () => void }) => (
    <button type="button" aria-label={`marker-${title}`} onClick={onClick}>
      {title}
    </button>
  ),
  InfoWindow: ({ children, onCloseClick }: { children: React.ReactNode; onCloseClick?: () => void }) => (
    <div data-testid="info-window">
      {children}
      <button type="button" onClick={onCloseClick}>Close</button>
    </div>
  )
}))

vi.mock('../../../../src/lib/maps', () => ({ mapsApiKey: 'test-key', mapsMapId: 'test-map-id' }))

const { NearbyEventsMap } = await import('../../../../src/features/home/components/NearbyEventsMap')

const center = { lat: 12.9716, lng: 77.5946 }
const events = [
  {
    eventId: 'evt-1',
    hostId: 'host-1',
    movieId: 'm1',
    title: 'Rooftop Watch Party',
    datetime: '2099-06-01T20:00:00.000Z',
    mode: 'in-person' as const,
    location: { area: 'MG Road', city: 'Bangalore' },
    preciseLocation: { lat: 12.98, lng: 77.6 },
    visibility: 'public' as const,
    participantLimit: 5,
    participantCount: 2,
    requiresApproval: false,
    joinCode: null,
    roomId: 'room-1',
    createdAt: null,
    joined: false,
    pending: false,
    hostDisplayName: 'Rohan',
    movieTitle: 'Interstellar',
    moviePoster: null,
    distanceKm: 1.2
  },
  {
    eventId: 'evt-2',
    hostId: 'host-2',
    movieId: 'm2',
    title: null,
    datetime: '2099-06-02T20:00:00.000Z',
    mode: 'online' as const,
    location: null,
    preciseLocation: null,
    visibility: 'public' as const,
    participantLimit: 5,
    participantCount: 1,
    requiresApproval: false,
    joinCode: null,
    roomId: 'room-2',
    createdAt: null,
    joined: false,
    pending: false,
    hostDisplayName: 'Host Two',
    movieTitle: 'Dune',
    moviePoster: null,
    distanceKm: 3.4
  }
]

afterEach(() => vi.clearAllMocks())

describe('NearbyEventsMap', () => {
  it('renders a marker for the caller and one for each event that has a location', () => {
    render(<NearbyEventsMap center={center} items={events} joinStatus={{}} onJoin={vi.fn()} />)

    expect(screen.getByLabelText('marker-You')).toBeInTheDocument()
    expect(screen.getByLabelText('marker-Rooftop Watch Party')).toBeInTheDocument()
    // evt-2 has no location (online event) — no pin for it
    expect(screen.queryByLabelText(/marker-Dune/)).not.toBeInTheDocument()
  })

  it('opens an InfoWindow with the event details when its marker is clicked', () => {
    render(<NearbyEventsMap center={center} items={events} joinStatus={{}} onJoin={vi.fn()} />)

    expect(screen.queryByTestId('info-window')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('marker-Rooftop Watch Party'))

    const infoWindow = within(screen.getByTestId('info-window'))
    expect(infoWindow.getByText('Rooftop Watch Party')).toBeInTheDocument()
    expect(infoWindow.getByText('1.2 km away')).toBeInTheDocument()
  })

  it('calls onJoin from the InfoWindow\'s Join button', () => {
    const onJoin = vi.fn()
    render(<NearbyEventsMap center={center} items={events} joinStatus={{}} onJoin={onJoin} />)

    fireEvent.click(screen.getByLabelText('marker-Rooftop Watch Party'))
    fireEvent.click(screen.getByRole('button', { name: /^join$/i }))

    expect(onJoin).toHaveBeenCalledWith('evt-1')
  })

  it('reflects an already-joined status in the InfoWindow', () => {
    render(<NearbyEventsMap center={center} items={events} joinStatus={{ 'evt-1': 'joined' }} onJoin={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('marker-Rooftop Watch Party'))
    expect(screen.getByRole('button', { name: 'Joined' })).toBeDisabled()
  })

  it('closes the InfoWindow on request', () => {
    render(<NearbyEventsMap center={center} items={events} joinStatus={{}} onJoin={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('marker-Rooftop Watch Party'))
    expect(screen.getByTestId('info-window')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^close$/i }))
    expect(screen.queryByTestId('info-window')).not.toBeInTheDocument()
  })
})
