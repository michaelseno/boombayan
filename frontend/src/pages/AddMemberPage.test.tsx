import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { AddMemberPage } from './AddMemberPage'

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

describe('AddMemberPage', () => {
  it('submits the form and navigates to the new member on success', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue({
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
    })

    render(
      <MemoryRouter>
        <AddMemberPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ana' } })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Reyes' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create member' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/members', 'fake-id-token', {
        method: 'POST',
        body: { first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com', phone: '1' },
      }),
    )
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/members/mem-1'))
  })

  it('shows an error message when member creation fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    render(
      <MemoryRouter>
        <AddMemberPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ana' } })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Reyes' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create member' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not create member.')
  })
})
