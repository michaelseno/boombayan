import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { CyclesPage } from './CyclesPage'

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
const boardMember = { user_id: 'member-1', email: 'member@boombayan.org', is_administrator: false, member_id: 'member-1' }

describe('CyclesPage', () => {
  it('shows the list of cycles after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/cycles' ? Promise.resolve([openCycle]) : Promise.resolve(admin),
    )

    render(
      <MemoryRouter>
        <CyclesPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('2026-01-01')).toBeInTheDocument())
    expect(screen.getByText('Open')).toBeInTheDocument()
  })

  it('hides the open-cycle form when a cycle is already open', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/cycles' ? Promise.resolve([openCycle]) : Promise.resolve(admin),
    )

    render(
      <MemoryRouter>
        <CyclesPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('2026-01-01')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Open cycle' })).not.toBeInTheDocument()
  })

  it('opens a new cycle when none is open', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/cycles' ? Promise.resolve([]) : Promise.resolve(admin),
    )

    render(
      <MemoryRouter>
        <CyclesPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Open cycle' })).toBeInTheDocument())

    vi.mocked(apiFetch).mockResolvedValueOnce(openCycle)
    fireEvent.click(screen.getByRole('button', { name: 'Open cycle' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/cycles', 'fake-id-token', {
        method: 'POST',
        body: { start_date: null },
      }),
    )
    expect(await screen.findByText('2026-01-01')).toBeInTheDocument()
  })

  it('hides the open-cycle form when the user is not an administrator', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/cycles' ? Promise.resolve([]) : Promise.resolve(boardMember),
    )

    render(
      <MemoryRouter>
        <CyclesPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Cycles')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Open cycle' })).not.toBeInTheDocument()
  })

  it('shows an error message when the cycles fetch fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    render(
      <MemoryRouter>
        <CyclesPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load cycles.')
  })
})
