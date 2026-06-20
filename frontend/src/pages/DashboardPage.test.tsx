import { render, screen, waitFor } from '@testing-library/react'
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
  it('shows the current user email after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue({
      user_id: 'abc123',
      email: 'board@boombayan.org',
      is_administrator: true,
      member_id: 'mem-1',
    })

    render(<DashboardPage />)

    await waitFor(() =>
      expect(screen.getByText('Welcome, board@boombayan.org')).toBeInTheDocument(),
    )
    expect(screen.getByText('Administrator')).toBeInTheDocument()
  })

  it('shows an error message when the profile fetch fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    render(<DashboardPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your profile.')
  })
})
