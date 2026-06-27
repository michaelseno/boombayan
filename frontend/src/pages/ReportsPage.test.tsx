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
  const actual = await importOriginal()
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
})
