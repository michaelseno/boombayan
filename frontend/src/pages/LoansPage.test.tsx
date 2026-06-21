import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { LoansPage } from './LoansPage'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

const loan = {
  loan_id: 'loan-1',
  member_id: 'mem-1',
  requested_amount: 10000,
  approved_amount: null,
  repayment_interval_days: 30,
  interest_rate: 0.05,
  application_date: '2026-06-21',
  remarks: null,
  status: 'Pending Board Approval',
  is_exception_case: false,
  release_date: null,
  interest_deduction: null,
  net_release_amount: null,
  remaining_balance: null,
  next_due_date: null,
  approvals: {},
}

const member = {
  member_id: 'mem-1',
  first_name: 'Ana',
  last_name: 'Reyes',
  email: 'ana@example.com',
  phone: '1',
  date_joined: '2026-01-15',
  status: 'Active',
  current_shares: 0,
  current_capital_amount: 0,
  share_history: [],
}

describe('LoansPage', () => {
  it('shows the list of loans with member names after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/loans' ? Promise.resolve([loan]) : Promise.resolve([member]),
    )

    render(
      <MemoryRouter>
        <LoansPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Ana Reyes')).toBeInTheDocument())
    expect(screen.getByText('Pending Board Approval')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New loan application' })).toHaveAttribute('href', '/loans/new')
  })

  it('shows an error message when the loans fetch fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    render(
      <MemoryRouter>
        <LoansPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load loans.')
  })
})
