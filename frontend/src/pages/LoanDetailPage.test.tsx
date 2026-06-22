import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { LoanDetailPage } from './LoanDetailPage'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

function renderAtLoan(loanId: string) {
  return render(
    <MemoryRouter initialEntries={[`/loans/${loanId}`]}>
      <Routes>
        <Route path="/loans/:loanId" element={<LoanDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const pendingLoan = {
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
  penalty_charged_for_current_cycle: false,
  approvals: {
    'board-1': { email: 'board@boombayan.org', status: 'Pending', date: null, comments: null },
  },
}

const activeLoan = {
  ...pendingLoan,
  status: 'Active',
  approved_amount: 10000,
  release_date: '2026-06-21',
  interest_deduction: 500,
  net_release_amount: 9500,
  remaining_balance: 10000,
  next_due_date: '2026-07-21',
}

const boardUser = { user_id: 'board-1', email: 'board@boombayan.org', is_administrator: false, member_id: null }
const adminUser = { user_id: 'admin-1', email: 'admin@boombayan.org', is_administrator: true, member_id: null }

function mockLoanFetches(loan: typeof pendingLoan, user: typeof boardUser, transactions: unknown[] = []) {
  vi.mocked(apiFetch).mockImplementation((path) => {
    if (path === '/me') return Promise.resolve(user)
    if (path.endsWith('/transactions')) return Promise.resolve(transactions)
    return Promise.resolve(loan)
  })
}

describe('LoanDetailPage', () => {
  it('shows loan details and approvals after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockLoanFetches(pendingLoan, boardUser)

    renderAtLoan('loan-1')

    await waitFor(() => expect(screen.getByText('Status: Pending Board Approval')).toBeInTheDocument())
    expect(screen.getByText('board@boombayan.org')).toBeInTheDocument()
  })

  it('shows an error message when the loan fetch fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    renderAtLoan('loan-1')

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this loan.')
  })

  it('submits an approve vote and updates the displayed approvals', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockLoanFetches(pendingLoan, boardUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Pending Board Approval')).toBeInTheDocument())

    const approvedLoan = {
      ...pendingLoan,
      status: 'Approved',
      approved_amount: 10000,
      approvals: {
        'board-1': { email: 'board@boombayan.org', status: 'Approved', date: '2026-06-21', comments: null },
      },
    }
    vi.mocked(apiFetch).mockResolvedValueOnce(approvedLoan)

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/loans/loan-1/approvals', 'fake-id-token', {
        method: 'POST',
        body: { status: 'Approved', comments: null },
      }),
    )
    await waitFor(() => expect(screen.getByText('Status: Approved')).toBeInTheDocument())
  })

  it('submits a reject vote and updates the displayed status', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockLoanFetches(pendingLoan, boardUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Pending Board Approval')).toBeInTheDocument())

    const rejectedLoan = {
      ...pendingLoan,
      status: 'Rejected',
      approvals: {
        'board-1': { email: 'board@boombayan.org', status: 'Rejected', date: '2026-06-21', comments: 'Not enough capital' },
      },
    }
    vi.mocked(apiFetch).mockResolvedValueOnce(rejectedLoan)

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    await waitFor(() => expect(screen.getByText('Status: Rejected')).toBeInTheDocument())
  })

  it('hides the vote form when the current user has already voted', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    const alreadyVotedLoan = {
      ...pendingLoan,
      approvals: {
        'board-1': { email: 'board@boombayan.org', status: 'Approved', date: '2026-06-21', comments: null },
      },
    }
    mockLoanFetches(alreadyVotedLoan, boardUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Pending Board Approval')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('shows a release form for administrators when the loan is approved, and submits it', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    const approvedLoan = { ...pendingLoan, status: 'Approved', approved_amount: 10000 }
    mockLoanFetches(approvedLoan, adminUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Approved')).toBeInTheDocument())

    vi.mocked(apiFetch).mockResolvedValueOnce(activeLoan)

    fireEvent.click(screen.getByRole('button', { name: 'Release loan' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/loans/loan-1/release', 'fake-id-token', {
        method: 'POST',
        body: { release_date: null },
      }),
    )
    await waitFor(() => expect(screen.getByText('Status: Active')).toBeInTheDocument())
  })

  it('hides the release form for non-administrators', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    const approvedLoan = { ...pendingLoan, status: 'Approved', approved_amount: 10000 }
    mockLoanFetches(approvedLoan, boardUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Approved')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Release loan' })).not.toBeInTheDocument()
  })

  it('shows a record payment form for administrators on an active loan, submits it, and refreshes the transaction history', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockLoanFetches(activeLoan, adminUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Active')).toBeInTheDocument())

    const paidDownLoan = { ...activeLoan, remaining_balance: 7000 }
    vi.mocked(apiFetch).mockResolvedValueOnce(paidDownLoan)
    const newTransactions = [
      {
        transaction_id: 'txn-1',
        loan_id: 'loan-1',
        timestamp: '2026-07-21T10:00:00+00:00',
        type: 'PAYMENT',
        amount: 3000,
        remaining_balance_after: 7000,
        recorded_by: 'admin-1',
        notes: null,
      },
    ]
    vi.mocked(apiFetch).mockResolvedValueOnce(newTransactions)

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '3000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/loans/loan-1/payments', 'fake-id-token', {
        method: 'POST',
        body: { amount: 3000, payment_date: null, notes: null },
      }),
    )
    await waitFor(() => expect(screen.getByText('Remaining balance: 7000')).toBeInTheDocument())
    expect(await screen.findByText('PAYMENT')).toBeInTheDocument()
  })

  it('shows an error message when recording a payment fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockLoanFetches(activeLoan, adminUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Active')).toBeInTheDocument())

    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Payment amount exceeds the remaining balance'))

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '99999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Payment amount exceeds the remaining balance')
  })

  it('hides the record payment form for non-administrators', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockLoanFetches(activeLoan, boardUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Active')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument()
  })

  it('hides the record payment form when the loan is not active', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockLoanFetches(pendingLoan, adminUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Pending Board Approval')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument()
  })

  it('shows existing transaction history rows', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    const existingTransactions = [
      {
        transaction_id: 'txn-1',
        loan_id: 'loan-1',
        timestamp: '2026-07-21T10:00:00+00:00',
        type: 'PAYMENT',
        amount: 3000,
        remaining_balance_after: 7000,
        recorded_by: 'admin-1',
        notes: 'First installment',
      },
    ]
    mockLoanFetches(activeLoan, boardUser, existingTransactions)

    renderAtLoan('loan-1')

    await waitFor(() => expect(screen.getByText('First installment')).toBeInTheDocument())
  })
})
