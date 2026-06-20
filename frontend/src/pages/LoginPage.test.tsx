import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { useAuth } from '../auth/AuthContext'
import { LoginPage } from './LoginPage'

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

describe('LoginPage', () => {
  it('calls login with the entered email and password on submit', async () => {
    const login = vi.fn().mockResolvedValue({
      status: 'success',
      tokens: { idToken: 'fake-id-token', accessToken: 'fake-access-token', refreshToken: 'fake-refresh-token' },
    })
    vi.mocked(useAuth).mockReturnValue({ idToken: null, login, setTokens: vi.fn(), logout: vi.fn() })

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'board@boombayan.org' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))

    await waitFor(() => expect(login).toHaveBeenCalledWith('board@boombayan.org', 'password123'))
  })

  it('shows an error message when login fails', async () => {
    const login = vi.fn().mockRejectedValue(new Error('Incorrect username or password.'))
    vi.mocked(useAuth).mockReturnValue({ idToken: null, login, setTokens: vi.fn(), logout: vi.fn() })

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'board@boombayan.org' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.')
  })

  it('shows the new-password form on newPasswordRequired, and completes login on submit', async () => {
    const completeNewPassword = vi.fn().mockResolvedValue({
      idToken: 'fake-id-token',
      accessToken: 'fake-access-token',
      refreshToken: 'fake-refresh-token',
    })
    const login = vi.fn().mockResolvedValue({ status: 'newPasswordRequired', completeNewPassword })
    const setTokens = vi.fn()
    vi.mocked(useAuth).mockReturnValue({ idToken: null, login, setTokens, logout: vi.fn() })

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'board@boombayan.org' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'temp-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByLabelText('New password')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-strong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))

    await waitFor(() => expect(completeNewPassword).toHaveBeenCalledWith('new-strong-password'))
    expect(setTokens).toHaveBeenCalledWith({
      idToken: 'fake-id-token',
      accessToken: 'fake-access-token',
      refreshToken: 'fake-refresh-token',
    })
  })

  it('shows an error when completing the new-password challenge fails', async () => {
    const completeNewPassword = vi.fn().mockRejectedValue(new Error('Password does not meet requirements.'))
    const login = vi.fn().mockResolvedValue({ status: 'newPasswordRequired', completeNewPassword })
    vi.mocked(useAuth).mockReturnValue({ idToken: null, login, setTokens: vi.fn(), logout: vi.fn() })

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'board@boombayan.org' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'temp-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))

    await screen.findByLabelText('New password')
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'weak' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not set new password. Please try again.')
  })
})
