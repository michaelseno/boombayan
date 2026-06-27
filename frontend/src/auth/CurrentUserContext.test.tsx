import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { CurrentUserProvider, useCurrentUser } from '../auth/CurrentUserContext'

vi.mock('../api/client', () => ({ apiFetch: vi.fn() }))
vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }))

function TestConsumer() {
  const { currentUser, loading, error } = useCurrentUser()
  if (loading) return <p>Loading...</p>
  if (error) return <p role="alert">{error}</p>
  if (!currentUser) return <p>No user</p>
  return <p>{currentUser.email}</p>
}

describe('CurrentUserContext', () => {
  it('shows loading state while fetching', () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'tok', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {})) // never resolves

    render(
      <MemoryRouter>
        <CurrentUserProvider>
          <TestConsumer />
        </CurrentUserProvider>
      </MemoryRouter>,
    )

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('exposes current user after successful fetch', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'tok', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue({
      user_id: 'u1',
      email: 'admin@boombayan.org',
      is_administrator: true,
      member_id: null,
    })

    render(
      <MemoryRouter>
        <CurrentUserProvider>
          <TestConsumer />
        </CurrentUserProvider>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('admin@boombayan.org')).toBeInTheDocument())
  })

  it('exposes error when fetch fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'tok', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('network error'))

    render(
      <MemoryRouter>
        <CurrentUserProvider>
          <TestConsumer />
        </CurrentUserProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your profile.')
  })
})
