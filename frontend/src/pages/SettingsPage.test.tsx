import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { SettingsPage } from './SettingsPage'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

describe('SettingsPage', () => {
  it('shows the current config values after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue({ share_value: 500, max_shares_per_member: 5 })

    render(<SettingsPage />)

    await waitFor(() => expect(screen.getByLabelText('Share value')).toHaveValue(500))
    expect(screen.getByLabelText('Max shares per member')).toHaveValue(5)
  })

  it('saves updated config values on submit', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValueOnce({ share_value: 500, max_shares_per_member: 5 })

    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByLabelText('Share value')).toHaveValue(500))

    vi.mocked(apiFetch).mockResolvedValueOnce({ share_value: 600, max_shares_per_member: 5 })
    fireEvent.change(screen.getByLabelText('Share value'), { target: { value: '600' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/config', 'fake-id-token', {
        method: 'PUT',
        body: { share_value: 600, max_shares_per_member: 5 },
      }),
    )
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
  })

  it('shows an error message when saving fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValueOnce({ share_value: 500, max_shares_per_member: 5 })

    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByLabelText('Share value')).toHaveValue(500))

    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save settings.')
  })
})
