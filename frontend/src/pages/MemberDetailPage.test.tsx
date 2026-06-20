import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { MemberDetailPage } from './MemberDetailPage'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

function renderAtMember(memberId: string) {
  return render(
    <MemoryRouter initialEntries={[`/members/${memberId}`]}>
      <Routes>
        <Route path="/members/:memberId" element={<MemberDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MemberDetailPage', () => {
  it('shows member details and share history after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue({
      member_id: 'mem-1',
      first_name: 'Ana',
      last_name: 'Reyes',
      email: 'ana@example.com',
      phone: '1',
      date_joined: '2026-01-15',
      status: 'Active',
      current_shares: 2,
      current_capital_amount: 1000,
      share_history: [
        { cycle_id: null, shares_purchased: 2, share_value_at_purchase: 500, amount_paid: 1000, date: '2026-02-01' },
      ],
    })

    renderAtMember('mem-1')

    await waitFor(() => expect(screen.getByText('Ana Reyes')).toBeInTheDocument())
    expect(apiFetch).toHaveBeenCalledWith('/members/mem-1', 'fake-id-token')
    expect(screen.getByText('2026-02-01')).toBeInTheDocument()
  })

  it('shows an error message when the member fetch fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    renderAtMember('mem-1')

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this member.')
  })
})
