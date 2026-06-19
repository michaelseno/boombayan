import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'
import { login as cognitoLogin, LoginResult } from './cognito'

vi.mock('./cognito', () => ({
  login: vi.fn(),
}))

describe('AuthProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(cognitoLogin).mockReset()
  })

  it('starts with no idToken when localStorage is empty', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    expect(result.current.idToken).toBeNull()
  })

  it('sets idToken and persists it to localStorage after a successful login', async () => {
    vi.mocked(cognitoLogin).mockResolvedValue({
      status: 'success',
      tokens: {
        idToken: 'fake-id-token',
        accessToken: 'fake-access-token',
        refreshToken: 'fake-refresh-token',
      },
    })
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await act(async () => {
      await result.current.login('board@boombayan.org', 'password123')
    })

    expect(result.current.idToken).toBe('fake-id-token')
    expect(localStorage.getItem('boombayan.auth.idToken')).toBe('fake-id-token')
  })

  it('does not set idToken when login returns newPasswordRequired', async () => {
    vi.mocked(cognitoLogin).mockResolvedValue({
      status: 'newPasswordRequired',
      completeNewPassword: vi.fn(),
    })
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    let loginResult: LoginResult | undefined
    await act(async () => {
      loginResult = await result.current.login('board@boombayan.org', 'temp-password')
    })

    expect(loginResult?.status).toBe('newPasswordRequired')
    expect(result.current.idToken).toBeNull()
  })

  it('setTokens sets idToken and persists it to localStorage', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    act(() => {
      result.current.setTokens({
        idToken: 'fake-id-token',
        accessToken: 'fake-access-token',
        refreshToken: 'fake-refresh-token',
      })
    })

    expect(result.current.idToken).toBe('fake-id-token')
    expect(localStorage.getItem('boombayan.auth.idToken')).toBe('fake-id-token')
  })

  it('clears idToken and localStorage on logout', async () => {
    vi.mocked(cognitoLogin).mockResolvedValue({
      status: 'success',
      tokens: {
        idToken: 'fake-id-token',
        accessToken: 'fake-access-token',
        refreshToken: 'fake-refresh-token',
      },
    })
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await act(async () => {
      await result.current.login('board@boombayan.org', 'password123')
    })

    act(() => {
      result.current.logout()
    })

    expect(result.current.idToken).toBeNull()
    expect(localStorage.getItem('boombayan.auth.idToken')).toBeNull()
  })
})
