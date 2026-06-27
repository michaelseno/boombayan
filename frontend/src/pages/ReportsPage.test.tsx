import { fireEvent, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useCurrentUser } from '../auth/CurrentUserContext'
import { renderWithUser } from '../test-utils/renderWithUser'
import { ReportsPage } from './ReportsPage'

vi.mock('../api/client', () => ({ apiFetch: vi.fn() }))
vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../auth/CurrentUserContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/CurrentUserContext')>()
  return {
    ...actual,
    useCurrentUser: vi.fn(),
  }
})

function setup() {
  vi.mocked(useAuth).mockReturnValue({ idToken: 'tok', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
  vi.mocked(useCurrentUser).mockReturnValue({
    currentUser: { user_id: 'admin-1', email: 'admin@boombayan.org', is_administrator: true, member_id: null },
    loading: false,
    error: null,
  })
  vi.mocked(apiFetch).mockResolvedValue([])
}

describe('ReportsPage', () => {
  it('renders all four tab labels', () => {
    setup()
    renderWithUser(<MemoryRouter><ReportsPage /></MemoryRouter>)
    expect(screen.getByRole('tab', { name: 'Portfolio' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Cycles' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Members' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Loans' })).toBeInTheDocument()
  })

  it('switches active tab when a tab is clicked', () => {
    setup()
    renderWithUser(<MemoryRouter><ReportsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Loans' }))
    expect(screen.getByRole('tab', { name: 'Loans' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Portfolio' })).toHaveAttribute('aria-selected', 'false')
  })

  it('renders disabled download buttons on every tab', () => {
    setup()
    renderWithUser(<MemoryRouter><ReportsPage /></MemoryRouter>)
    const pdfBtn = screen.getByRole('button', { name: 'Download PDF' })
    const csvBtn = screen.getByRole('button', { name: 'Download CSV' })
    expect(pdfBtn).toBeDisabled()
    expect(csvBtn).toBeDisabled()
    expect(pdfBtn).toHaveAttribute('aria-disabled', 'true')
    expect(csvBtn).toHaveAttribute('aria-disabled', 'true')
  })

  it('Portfolio tab shows summary card labels and member capital table', async () => {
    setup()
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      if (path === '/members') return Promise.resolve([
        { member_id: 'm1', first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com', phone: '', date_joined: '2026-01-01', status: 'Active', current_shares: 10, current_capital_amount: 5000, share_history: [] },
      ])
      if (path === '/loans') return Promise.resolve([])
      return Promise.resolve([])
    })
    renderWithUser(<MemoryRouter><ReportsPage /></MemoryRouter>)
    expect(await screen.findByText('Total Capital')).toBeInTheDocument()
    expect(screen.getByText('Deployed Capital')).toBeInTheDocument()
    expect(screen.getByText('Available to Lend')).toBeInTheDocument()
    expect(screen.getByText('Active Loans')).toBeInTheDocument()
    expect(screen.getByText('Ana Reyes')).toBeInTheDocument()
  })

  it('Loan Ledger tab shows overdue badge for past-due active loans', async () => {
    setup()
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      if (path === '/members') return Promise.resolve([
        { member_id: 'm1', first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com', phone: '', date_joined: '2026-01-01', status: 'Active', current_shares: 10, current_capital_amount: 5000, share_history: [] },
      ])
      if (path === '/loans') return Promise.resolve([
        { loan_id: 'l1', member_id: 'm1', requested_amount: 1000, approved_amount: 1000, repayment_interval_days: 30, interest_rate: 0.05, application_date: '2026-01-01', remarks: null, status: 'Active', is_exception_case: false, release_date: '2026-01-15', interest_deduction: 50, net_release_amount: 950, remaining_balance: 800, next_due_date: '2025-01-01', penalty_charged_for_current_cycle: false, cycle_id: null, approvals: {} },
      ])
      return Promise.resolve([])
    })
    renderWithUser(<MemoryRouter><ReportsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Loans' }))
    // "Overdue" appears in both the column header and the badge — use findAllByText
    const overdueCells = await screen.findAllByText('Overdue')
    expect(overdueCells.length).toBeGreaterThanOrEqual(2)
  })

  it('Loan Ledger tab filters loans by status', async () => {
    setup()
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      if (path === '/members') return Promise.resolve([
        { member_id: 'm1', first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com', phone: '', date_joined: '2026-01-01', status: 'Active', current_shares: 10, current_capital_amount: 5000, share_history: [] },
      ])
      if (path === '/loans') return Promise.resolve([
        { loan_id: 'l1', member_id: 'm1', requested_amount: 1000, approved_amount: 1000, repayment_interval_days: 30, interest_rate: 0.05, application_date: '2026-01-01', remarks: null, status: 'Active', is_exception_case: false, release_date: '2026-01-15', interest_deduction: 50, net_release_amount: 950, remaining_balance: 800, next_due_date: '2026-12-01', penalty_charged_for_current_cycle: false, cycle_id: null, approvals: {} },
        { loan_id: 'l2', member_id: 'm1', requested_amount: 500, approved_amount: null, repayment_interval_days: 30, interest_rate: 0.05, application_date: '2026-02-01', remarks: null, status: 'Pending Board Approval', is_exception_case: false, release_date: null, interest_deduction: null, net_release_amount: null, remaining_balance: null, next_due_date: null, penalty_charged_for_current_cycle: false, cycle_id: null, approvals: {} },
      ])
      return Promise.resolve([])
    })
    renderWithUser(<MemoryRouter><ReportsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Loans' }))
    // Both loans share the same member — wait for both rows to appear
    await screen.findAllByText('Ana Reyes')
    // Both loans visible initially
    expect(screen.getAllByText('Ana Reyes')).toHaveLength(2)
    // Filter to Active only
    fireEvent.change(screen.getByRole('combobox', { name: /status/i }), { target: { value: 'Active' } })
    expect(screen.getAllByText('Ana Reyes')).toHaveLength(1)
  })

  it('Cycles tab shows cycle summary cards and dividend table after loading', async () => {
    setup()
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      if (path === '/members') return Promise.resolve([])
      if (path === '/loans') return Promise.resolve([])
      if (path === '/cycles') return Promise.resolve([
        { cycle_id: 'c1', start_date: '2026-01-01', end_date: '2026-06-01', status: 'Closed', total_interest_earned: 500, total_penalties_collected: 100, top3_bonus_percentage: 0.1, top3_bonus_pool: 60, remaining_profit: 540, total_shares_at_close: 100, closed_at: '2026-06-01' },
      ])
      if (path === '/cycles/c1/dividends') return Promise.resolve([
        { cycle_id: 'c1', member_id: 'm1', share_based_amount: 270, top3_bonus_amount: 0, total_amount: 270, shares_at_calculation: 10, rank: null },
      ])
      return Promise.resolve([])
    })
    renderWithUser(<MemoryRouter><ReportsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Cycles' }))
    expect(await screen.findByText('Interest Earned')).toBeInTheDocument()
    expect(screen.getByText('500.00')).toBeInTheDocument()
    expect(screen.getAllByText('270.00').length).toBeGreaterThanOrEqual(1)
  })

  it('Members tab shows loan history and dividend history after selecting a member', async () => {
    setup()
    vi.mocked(apiFetch).mockImplementation((path: string) => {
      if (path === '/members') return Promise.resolve([
        { member_id: 'm1', first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com', phone: '', date_joined: '2026-01-01', status: 'Active', current_shares: 10, current_capital_amount: 5000, share_history: [] },
      ])
      if (path === '/loans') return Promise.resolve([
        { loan_id: 'l1', member_id: 'm1', requested_amount: 2000, approved_amount: 2000, repayment_interval_days: 30, interest_rate: 0.05, application_date: '2026-03-01', remarks: null, status: 'Active', is_exception_case: false, release_date: '2026-03-15', interest_deduction: 100, net_release_amount: 1900, remaining_balance: 1500, next_due_date: '2026-12-01', penalty_charged_for_current_cycle: false, cycle_id: null, approvals: {} },
      ])
      if (path === '/cycles') return Promise.resolve([
        { cycle_id: 'c1', start_date: '2026-01-01', end_date: '2026-06-01', status: 'Closed', total_interest_earned: 500, total_penalties_collected: 100, top3_bonus_percentage: 0.1, top3_bonus_pool: 60, remaining_profit: 540, total_shares_at_close: 100, closed_at: '2026-06-01' },
      ])
      if (path === '/cycles/c1/dividends') return Promise.resolve([
        { cycle_id: 'c1', member_id: 'm1', share_based_amount: 270, top3_bonus_amount: 0, total_amount: 270, shares_at_calculation: 10, rank: null },
      ])
      return Promise.resolve([])
    })
    renderWithUser(<MemoryRouter><ReportsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Members' }))
    const select = await screen.findByRole('combobox', { name: /member/i })
    fireEvent.change(select, { target: { value: 'm1' } })
    expect(await screen.findByText('2,000.00')).toBeInTheDocument()
    expect(screen.getAllByText('270.00').length).toBeGreaterThanOrEqual(1)
  })
})
