import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { useAuth } from '../auth/AuthContext'
import { ProtectedRoute } from './ProtectedRoute'

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

function renderWithRoutes(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<div>Dashboard Page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute', () => {
  it('redirects to /login when there is no idToken', () => {
    vi.mocked(useAuth).mockReturnValue({
      idToken: null,
      login: vi.fn(),
      setTokens: vi.fn(),
      logout: vi.fn(),
    })
    renderWithRoutes('/dashboard')
    expect(screen.getByText('Login Page')).toBeInTheDocument()
  })

  it('renders the nested route when idToken is present', () => {
    vi.mocked(useAuth).mockReturnValue({
      idToken: 'token',
      login: vi.fn(),
      setTokens: vi.fn(),
      logout: vi.fn(),
    })
    renderWithRoutes('/dashboard')
    expect(screen.getByText('Dashboard Page')).toBeInTheDocument()
  })
})
