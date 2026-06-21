import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { NewLoanPage } from './NewLoanPage'

const navigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

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

const createdLoan = {
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

describe('NewLoanPage', () => {
  it('loads members into the picker', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue([member])

    render(
      <MemoryRouter>
        <NewLoanPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('option', { name: 'Ana Reyes' })).toBeInTheDocument())
  })

  it('submits the form and navigates to the new loan on success', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValueOnce([member])

    render(
      <MemoryRouter>
        <NewLoanPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ana Reyes' })).toBeInTheDocument())

    vi.mocked(apiFetch).mockResolvedValueOnce(createdLoan)

    fireEvent.change(screen.getByLabelText('Requested amount'), { target: { value: '10000' } })
    fireEvent.change(screen.getByLabelText('Repayment interval (days)'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit application' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/loans', 'fake-id-token', {
        method: 'POST',
        body: { member_id: 'mem-1', requested_amount: 10000, repayment_interval_days: 30, remarks: null },
      }),
    )
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/loans/loan-1'))
  })

  it('shows an error message when loan creation fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValueOnce([member])

    render(
      <MemoryRouter>
        <NewLoanPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ana Reyes' })).toBeInTheDocument())

    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('boom'))
    fireEvent.change(screen.getByLabelText('Requested amount'), { target: { value: '10000' } })
    fireEvent.change(screen.getByLabelText('Repayment interval (days)'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit application' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not create loan application.')
  })
})
