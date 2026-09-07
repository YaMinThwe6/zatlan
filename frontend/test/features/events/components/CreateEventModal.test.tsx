import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const searchMovies = vi.fn()
vi.mock('../../../../src/features/movie/services/movieApi', () => ({ searchMovies }))

const createEvent = vi.fn()
vi.mock('../../../../src/features/home/services/homeApi', () => ({ createEvent }))

const { CreateEventModal } = await import('../../../../src/features/events/components/CreateEventModal')

afterEach(() => {
  searchMovies.mockReset()
  createEvent.mockReset()
})

describe('CreateEventModal', () => {
  it('starts on the movie-search step when no movie is given', () => {
    render(<CreateEventModal onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.getByLabelText(/which movie/i)).toBeInTheDocument()
  })

  it('skips straight to the form when initialMovie is given — the movie detail page already knows which movie', () => {
    render(<CreateEventModal initialMovie={{ movieId: 'm1', title: 'Interstellar', poster: null, year: 2014 }} onClose={vi.fn()} onCreated={vi.fn()} />)
    expect(screen.queryByLabelText(/which movie/i)).not.toBeInTheDocument()
    expect(screen.getByText('Interstellar')).toBeInTheDocument()
    expect(searchMovies).not.toHaveBeenCalled()
  })

  it('creates the event for the pre-selected movie on submit', async () => {
    createEvent.mockResolvedValue({ eventId: 'evt-1' })
    const onCreated = vi.fn()
    render(<CreateEventModal initialMovie={{ movieId: 'm1', title: 'Interstellar', poster: null, year: 2014 }} onClose={vi.fn()} onCreated={onCreated} />)

    fireEvent.change(screen.getByLabelText(/date & time/i), { target: { value: '2099-06-01T20:00' } })
    fireEvent.click(screen.getByRole('button', { name: /^schedule$/i }))

    await waitFor(() => expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({ movieId: 'm1', mode: 'online' })))
    expect(onCreated).toHaveBeenCalledWith('evt-1')
  })

  it('lets the pre-selected movie be changed back to search', () => {
    render(<CreateEventModal initialMovie={{ movieId: 'm1', title: 'Interstellar', poster: null, year: 2014 }} onClose={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /change/i }))
    expect(screen.getByLabelText(/which movie/i)).toBeInTheDocument()
  })
})
