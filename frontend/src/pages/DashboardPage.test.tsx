import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DashboardPage } from './DashboardPage'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

describe('DashboardPage', () => {
  it('shows the current user email, role, and navigation links after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue({
      user_id: 'abc123',
      email: 'board@boombayan.org',
      is_administrator: true,
      member_id: 'mem-1',
    })

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(screen.getByText('Welcome, board@boombayan.org')).toBeInTheDocument(),
    )
    expect(screen.getByText('Administrator')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('href', '/members')
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
  })

  it('hides the Settings link for non-administrators', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue({
      user_id: 'abc123',
      email: 'board@boombayan.org',
      is_administrator: false,
      member_id: 'mem-1',
    })

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(screen.getByText('Welcome, board@boombayan.org')).toBeInTheDocument(),
    )
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('shows an error message when the profile fetch fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your profile.')
  })
})
