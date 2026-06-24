import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { CycleDetailPage } from './CycleDetailPage'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

const openCycle = {
  cycle_id: 'cycle-1',
  start_date: '2026-01-01',
  end_date: null,
  status: 'Open',
  total_interest_earned: null,
  total_penalties_collected: null,
  top3_bonus_percentage: null,
  top3_bonus_pool: null,
  remaining_profit: null,
  total_shares_at_close: null,
  closed_at: null,
}

const admin = { user_id: 'admin-1', email: 'admin@boombayan.org', is_administrator: true, member_id: null }

const member = {
  member_id: 'mem-1', first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com',
  phone: '1', date_joined: '2026-01-15', status: 'Active', current_shares: 2,
  current_capital_amount: 1000, share_history: [],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/cycles/cycle-1']}>
      <Routes>
        <Route path="/cycles/:cycleId" element={<CycleDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function mockFetchFor(cycle: typeof openCycle, dividends: unknown[] = []) {
  vi.mocked(apiFetch).mockImplementation((path) => {
    if (path === '/cycles/cycle-1') return Promise.resolve(cycle)
    if (path === '/me') return Promise.resolve(admin)
    if (path === '/cycles/cycle-1/dividends') return Promise.resolve(dividends)
    if (path === '/members') return Promise.resolve([member])
    throw new Error(`Unexpected path: ${path}`)
  })
}

describe('CycleDetailPage', () => {
  it('shows cycle details after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockFetchFor(openCycle)

    renderPage()

    await waitFor(() => expect(screen.getByText('Status: Open')).toBeInTheDocument())
    expect(screen.getByText('Start date: 2026-01-01')).toBeInTheDocument()
  })

  it('previews the close before confirming', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockFetchFor(openCycle)

    renderPage()
    await waitFor(() => expect(screen.getByText('Status: Open')).toBeInTheDocument())

    const previewResult = {
      cycle_id: 'cycle-1',
      total_interest_earned: 1000,
      total_penalties_collected: 0,
      top3_bonus_percentage: 0,
      top3_bonus_pool: 0,
      remaining_profit: 1000,
      total_shares_at_close: 2,
      dividends: [
        {
          member_id: 'mem-1', shares_at_calculation: 2, share_based_amount: 1000,
          top3_bonus_amount: 0, total_amount: 1000, rank: null,
        },
      ],
    }
    vi.mocked(apiFetch).mockResolvedValueOnce(previewResult)
    fireEvent.click(screen.getByRole('button', { name: 'Preview close' }))

    await waitFor(() => expect(screen.getByText('Ana Reyes')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Confirm close' })).toBeInTheDocument()
  })

  it('confirms the close and refreshes the dividend list', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockFetchFor(openCycle)

    renderPage()
    await waitFor(() => expect(screen.getByText('Status: Open')).toBeInTheDocument())

    const previewResult = {
      cycle_id: 'cycle-1', total_interest_earned: 1000, total_penalties_collected: 0,
      top3_bonus_percentage: 0, top3_bonus_pool: 0, remaining_profit: 1000, total_shares_at_close: 2,
      dividends: [
        { member_id: 'mem-1', shares_at_calculation: 2, share_based_amount: 1000, top3_bonus_amount: 0, total_amount: 1000, rank: null },
      ],
    }
    vi.mocked(apiFetch).mockResolvedValueOnce(previewResult)
    fireEvent.click(screen.getByRole('button', { name: 'Preview close' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm close' })).toBeInTheDocument())

    const closedCycle = { ...openCycle, status: 'Closed', end_date: '2026-06-23', remaining_profit: 1000 }
    vi.mocked(apiFetch).mockResolvedValueOnce(closedCycle)
    const dividendRecord = {
      cycle_id: 'cycle-1', member_id: 'mem-1', share_based_amount: 1000,
      top3_bonus_amount: 0, total_amount: 1000, shares_at_calculation: 2, rank: null,
    }
    vi.mocked(apiFetch).mockResolvedValueOnce([dividendRecord])
    fireEvent.click(screen.getByRole('button', { name: 'Confirm close' }))

    await waitFor(() => expect(screen.getByText('Status: Closed')).toBeInTheDocument())
    expect(apiFetch).toHaveBeenCalledWith('/cycles/cycle-1/close', 'fake-id-token', {
      method: 'POST',
      body: { end_date: null },
    })
  })

  it('shows an error message when the cycle fetch fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this cycle.')
  })

  it('does not show close UI for non-administrator viewing an open cycle', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    const nonAdmin = { ...admin, is_administrator: false }
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === '/cycles/cycle-1') return Promise.resolve(openCycle)
      if (path === '/me') return Promise.resolve(nonAdmin)
      if (path === '/cycles/cycle-1/dividends') return Promise.resolve([])
      if (path === '/members') return Promise.resolve([member])
      throw new Error(`Unexpected path: ${path}`)
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Status: Open')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Preview close' })).not.toBeInTheDocument()
  })

  it('does not show close UI for administrator viewing a closed cycle', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    const closedCycle = {
      ...openCycle,
      status: 'Closed',
      end_date: '2026-06-23',
    }
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === '/cycles/cycle-1') return Promise.resolve(closedCycle)
      if (path === '/me') return Promise.resolve(admin)
      if (path === '/cycles/cycle-1/dividends') return Promise.resolve([])
      if (path === '/members') return Promise.resolve([member])
      throw new Error(`Unexpected path: ${path}`)
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Status: Closed')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Preview close' })).not.toBeInTheDocument()
  })
})
