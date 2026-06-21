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
  approvals: {
    'board-1': { email: 'board@boombayan.org', status: 'Pending', date: null, comments: null },
  },
}

const boardUser = { user_id: 'board-1', email: 'board@boombayan.org', is_administrator: false, member_id: null }
const adminUser = { user_id: 'admin-1', email: 'admin@boombayan.org', is_administrator: true, member_id: null }

describe('LoanDetailPage', () => {
  it('shows loan details and approvals after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/me' ? Promise.resolve(boardUser) : Promise.resolve(pendingLoan),
    )

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
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/me' ? Promise.resolve(boardUser) : Promise.resolve(pendingLoan),
    )

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
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/me' ? Promise.resolve(boardUser) : Promise.resolve(pendingLoan),
    )

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
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/me' ? Promise.resolve(boardUser) : Promise.resolve(alreadyVotedLoan),
    )

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Pending Board Approval')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('shows a release form for administrators when the loan is approved, and submits it', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    const approvedLoan = { ...pendingLoan, status: 'Approved', approved_amount: 10000 }
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/me' ? Promise.resolve(adminUser) : Promise.resolve(approvedLoan),
    )

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Approved')).toBeInTheDocument())

    const activeLoan = {
      ...approvedLoan,
      status: 'Active',
      release_date: '2026-06-21',
      interest_deduction: 500,
      net_release_amount: 9500,
      remaining_balance: 10000,
      next_due_date: '2026-07-21',
    }
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
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/me' ? Promise.resolve(boardUser) : Promise.resolve(approvedLoan),
    )

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Approved')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Release loan' })).not.toBeInTheDocument()
  })
})
