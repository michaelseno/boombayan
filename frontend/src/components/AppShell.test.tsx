import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { useAuth } from '../auth/AuthContext'
import { CurrentUserContext } from '../auth/CurrentUserContext'
import { AppShell } from './AppShell'

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }))

const logoutFn = vi.fn()

function renderShell(isAdmin: boolean) {
  vi.mocked(useAuth).mockReturnValue({ idToken: 'tok', login: vi.fn(), setTokens: vi.fn(), logout: logoutFn })
  const user = { user_id: 'u1', email: 'test@boombayan.org', is_administrator: isAdmin, member_id: null }
  return render(
    <CurrentUserContext.Provider value={{ currentUser: user, loading: false, error: null }}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<p>Page content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </CurrentUserContext.Provider>,
  )
}

describe('AppShell', () => {
  it('renders nav links and page content for non-admin users', () => {
    renderShell(false)
    expect(screen.getByText('Boombayan LMS')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /members/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /loans/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /cycles/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /settings/i })).not.toBeInTheDocument()
    expect(screen.getByText('Page content')).toBeInTheDocument()
  })

  it('renders the Settings link for admin users', () => {
    renderShell(true)
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument()
  })

  it('calls logout when the Log out button is clicked', async () => {
    renderShell(false)
    await userEvent.click(screen.getByRole('button', { name: /log out/i }))
    expect(logoutFn).toHaveBeenCalledOnce()
  })
})
