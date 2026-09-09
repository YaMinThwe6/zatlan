import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const getNearbyEvents = vi.fn()
const joinEvent = vi.fn()
vi.mock('../../../../src/features/home/services/homeApi', () => ({ getNearbyEvents, joinEvent }))

// mapsConfigured defaults to false here (no VITE_GOOGLE_MAPS_API_KEY in the
// test env) — overridden per-test below for the map-enabled case. The real
// map component is mocked at this module boundary; NearbyEventsMap.test.tsx
// covers its own internals.
let mapsConfiguredValue = false
vi.mock('../../../../src/lib/maps', () => ({
  get mapsConfigured() {
    return mapsConfiguredValue
  }
}))
const NearbyEventsMapMock = vi.fn((_props: { center: { lat: number; lng: number }; items: unknown[] }) => (
  <div data-testid="nearby-events-map" />
))
vi.mock('../../../../src/features/home/components/NearbyEventsMap', () => ({ NearbyEventsMap: NearbyEventsMapMock }))

const { NearbyEvents } = await import('../../../../src/features/home/components/NearbyEvents')

const event = {
  eventId: 'evt-1',
  hostId: 'host-1',
  movieId: 'm1',
  title: 'Rooftop Watch Party',
  datetime: '2099-06-01T20:00:00.000Z',
  mode: 'in-person' as const,
  location: { address: 'MG Road', lat: 12.9716, lng: 77.5946 },
  visibility: 'public' as const,
  participantLimit: 5,
  participantCount: 2,
  requiresApproval: false,
  roomId: 'room-1',
  movieTitle: 'Interstellar',
  moviePoster: null,
  distanceKm: 1.2
}

const originalGeolocation = navigator.geolocation

afterEach(() => {
  getNearbyEvents.mockReset()
  joinEvent.mockReset()
  NearbyEventsMapMock.mockClear()
  mapsConfiguredValue = false
  Object.defineProperty(navigator, 'geolocation', { value: originalGeolocation, configurable: true })
})

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<NearbyEvents />} />
        <Route path="/rooms/:roomId" element={<p>Room chat page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('NearbyEvents', () => {
  it('shows a "Find events near me" button before any location is requested', () => {
    renderWithRouter()
    expect(screen.getByRole('button', { name: /find events near me/i })).toBeInTheDocument()
    expect(getNearbyEvents).not.toHaveBeenCalled()
  })

  it('fetches and renders nearby events after location is granted', async () => {
    getNearbyEvents.mockResolvedValue({ items: [event] })
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (onSuccess: (pos: { coords: { latitude: number; longitude: number } }) => void) => {
          onSuccess({ coords: { latitude: 12.9716, longitude: 77.5946 } })
        }
      }
    })

    renderWithRouter()
    fireEvent.click(screen.getByRole('button', { name: /find events near me/i }))

    await waitFor(() => expect(getNearbyEvents).toHaveBeenCalledWith(12.9716, 77.5946, 25))
    expect(await screen.findByText('Rooftop Watch Party')).toBeInTheDocument()
    expect(screen.getByText('1.2 km away')).toBeInTheDocument()
  })

  it('joins a nearby event on click', async () => {
    getNearbyEvents.mockResolvedValue({ items: [event] })
    joinEvent.mockResolvedValue({ status: 'joined' })
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (onSuccess: (pos: { coords: { latitude: number; longitude: number } }) => void) => {
          onSuccess({ coords: { latitude: 12.9716, longitude: 77.5946 } })
        }
      }
    })

    renderWithRouter()
    fireEvent.click(screen.getByRole('button', { name: /find events near me/i }))
    await screen.findByText('Rooftop Watch Party')

    fireEvent.click(screen.getByRole('button', { name: /^join$/i }))
    await waitFor(() => expect(joinEvent).toHaveBeenCalledWith('evt-1'))
    // Chat, not a disabled "Joined" — you're in, so the button takes you
    // straight to the room instead of just sitting there inert.
    expect(await screen.findByRole('button', { name: /^chat$/i })).not.toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Joined' })).not.toBeInTheDocument()
  })

  it('the Join button becomes Chat once joined, opening the event\'s room', async () => {
    getNearbyEvents.mockResolvedValue({ items: [event] })
    joinEvent.mockResolvedValue({ status: 'joined' })
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (onSuccess: (pos: { coords: { latitude: number; longitude: number } }) => void) => {
          onSuccess({ coords: { latitude: 12.9716, longitude: 77.5946 } })
        }
      }
    })

    renderWithRouter()
    fireEvent.click(screen.getByRole('button', { name: /find events near me/i }))
    await screen.findByText('Rooftop Watch Party')

    fireEvent.click(screen.getByRole('button', { name: /^join$/i }))
    expect(await screen.findAllByRole('button', { name: /^chat$/i })).toHaveLength(1) // one button, not Joined+Chat side by side
    fireEvent.click(screen.getByRole('button', { name: /^chat$/i }))

    expect(await screen.findByText('Room chat page')).toBeInTheDocument()
  })

  it('shows a gentle message, not an error, when location permission is denied', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (
          _onSuccess: unknown,
          onError: (err: { code: number; PERMISSION_DENIED: number }) => void
        ) => {
          onError({ code: 1, PERMISSION_DENIED: 1 })
        }
      }
    })

    renderWithRouter()
    fireEvent.click(screen.getByRole('button', { name: /find events near me/i }))

    await waitFor(() => expect(screen.getByText(/enable location access/i)).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(getNearbyEvents).not.toHaveBeenCalled()
  })

  it('shows an error when the browser has no geolocation support at all', () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined })
    renderWithRouter()
    fireEvent.click(screen.getByRole('button', { name: /find events near me/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/not available/i)
  })

  it('does not render the map when Maps is not configured (no API key)', async () => {
    mapsConfiguredValue = false
    getNearbyEvents.mockResolvedValue({ items: [event] })
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (onSuccess: (pos: { coords: { latitude: number; longitude: number } }) => void) => {
          onSuccess({ coords: { latitude: 12.9716, longitude: 77.5946 } })
        }
      }
    })

    renderWithRouter()
    fireEvent.click(screen.getByRole('button', { name: /find events near me/i }))
    await screen.findByText('Rooftop Watch Party')

    expect(screen.queryByTestId('nearby-events-map')).not.toBeInTheDocument()
  })

  it('renders the map once located, when Maps is configured', async () => {
    mapsConfiguredValue = true
    getNearbyEvents.mockResolvedValue({ items: [event] })
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (onSuccess: (pos: { coords: { latitude: number; longitude: number } }) => void) => {
          onSuccess({ coords: { latitude: 12.9716, longitude: 77.5946 } })
        }
      }
    })

    renderWithRouter()
    fireEvent.click(screen.getByRole('button', { name: /find events near me/i }))

    await waitFor(() => expect(screen.getByTestId('nearby-events-map')).toBeInTheDocument())
    const props = NearbyEventsMapMock.mock.calls[0][0]
    expect(props).toMatchObject({ center: { lat: 12.9716, lng: 77.5946 }, items: [event] })
  })

  it('shows Requested immediately on load for an approval-required event the backend already reports as pending — real bug: this used to reset to "Join" on every page refresh', async () => {
    getNearbyEvents.mockResolvedValue({ items: [{ ...event, requiresApproval: true, joined: false, pending: true }] })
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (onSuccess: (pos: { coords: { latitude: number; longitude: number } }) => void) => {
          onSuccess({ coords: { latitude: 12.9716, longitude: 77.5946 } })
        }
      }
    })

    renderWithRouter()
    fireEvent.click(screen.getByRole('button', { name: /find events near me/i }))

    expect(await screen.findByRole('button', { name: 'Requested' })).toBeDisabled()
    expect(joinEvent).not.toHaveBeenCalled()
  })

  it('shows an empty-state message when nothing is nearby', async () => {
    getNearbyEvents.mockResolvedValue({ items: [] })
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (onSuccess: (pos: { coords: { latitude: number; longitude: number } }) => void) => {
          onSuccess({ coords: { latitude: 12.9716, longitude: 77.5946 } })
        }
      }
    })

    renderWithRouter()
    fireEvent.click(screen.getByRole('button', { name: /find events near me/i }))

    await waitFor(() => expect(screen.getByText(/no watch parties nearby/i)).toBeInTheDocument())
  })
})
