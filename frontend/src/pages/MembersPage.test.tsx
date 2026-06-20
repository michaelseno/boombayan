import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { MembersPage } from './MembersPage'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

describe('MembersPage', () => {
  it('shows the list of members after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue([
      {
        member_id: 'mem-1',
        first_name: 'Ana',
        last_name: 'Reyes',
        email: 'ana@example.com',
        phone: '1',
        date_joined: '2026-01-15',
        status: 'Active',
        current_shares: 2,
        current_capital_amount: 1000,
        share_history: [],
      },
    ])

    render(
      <MemoryRouter>
        <MembersPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Ana Reyes')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Add member' })).toHaveAttribute('href', '/members/new')
  })

  it('shows an error message when the members fetch fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    render(
      <MemoryRouter>
        <MembersPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load members.')
  })
})
