import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { useCurrentUser } from '../auth/CurrentUserContext'
import { DashboardPage } from './DashboardPage'

vi.mock('../auth/CurrentUserContext', () => ({ useCurrentUser: vi.fn() }))

describe('DashboardPage', () => {
  it('shows loading state', () => {
    vi.mocked(useCurrentUser).mockReturnValue({ currentUser: null, loading: true, error: null })
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('shows welcome message and Administrator badge for admin user', () => {
    vi.mocked(useCurrentUser).mockReturnValue({
      currentUser: { user_id: 'u1', email: 'admin@boombayan.org', is_administrator: true, member_id: null },
      loading: false,
      error: null,
    })
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(screen.getByText('Welcome, admin@boombayan.org')).toBeInTheDocument()
    expect(screen.getByText('Administrator')).toBeInTheDocument()
  })

  it('shows Board Member badge for non-admin user', () => {
    vi.mocked(useCurrentUser).mockReturnValue({
      currentUser: { user_id: 'u2', email: 'board@boombayan.org', is_administrator: false, member_id: 'mem-1' },
      loading: false,
      error: null,
    })
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(screen.getByText('Board Member')).toBeInTheDocument()
  })

  it('shows error alert when profile load fails', () => {
    vi.mocked(useCurrentUser).mockReturnValue({ currentUser: null, loading: false, error: 'Could not load your profile.' })
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your profile.')
  })
})
