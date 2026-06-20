import { beforeEach, describe, expect, it, vi } from 'vitest'
import { login } from './cognito'

const authenticateUser = vi.fn()
const completeNewPasswordChallenge = vi.fn()

vi.mock('amazon-cognito-identity-js', () => ({
  CognitoUserPool: vi.fn(),
  CognitoUser: vi.fn().mockImplementation(() => ({ authenticateUser, completeNewPasswordChallenge })),
  AuthenticationDetails: vi.fn(),
}))

describe('login', () => {
  beforeEach(() => {
    authenticateUser.mockReset()
    completeNewPasswordChallenge.mockReset()
  })

  it('resolves with a success result containing tokens on successful authentication', async () => {
    authenticateUser.mockImplementation((_details, callbacks) => {
      callbacks.onSuccess({
        getIdToken: () => ({ getJwtToken: () => 'fake-id-token' }),
        getAccessToken: () => ({ getJwtToken: () => 'fake-access-token' }),
        getRefreshToken: () => ({ getToken: () => 'fake-refresh-token' }),
      })
    })

    const result = await login('board@boombayan.org', 'password123')
    expect(result).toEqual({
      status: 'success',
      tokens: {
        idToken: 'fake-id-token',
        accessToken: 'fake-access-token',
        refreshToken: 'fake-refresh-token',
      },
    })
  })

  it('rejects when authentication fails', async () => {
    authenticateUser.mockImplementation((_details, callbacks) => {
      callbacks.onFailure(new Error('Incorrect username or password.'))
    })

    await expect(login('board@boombayan.org', 'wrong-password')).rejects.toThrow(
      'Incorrect username or password.',
    )
  })

  it('resolves with a newPasswordRequired result that can complete the challenge', async () => {
    authenticateUser.mockImplementation((_details, callbacks) => {
      callbacks.newPasswordRequired({ email: 'board@boombayan.org' }, [])
    })
    completeNewPasswordChallenge.mockImplementation((_newPassword, _attrs, callbacks) => {
      callbacks.onSuccess({
        getIdToken: () => ({ getJwtToken: () => 'fake-id-token' }),
        getAccessToken: () => ({ getJwtToken: () => 'fake-access-token' }),
        getRefreshToken: () => ({ getToken: () => 'fake-refresh-token' }),
      })
    })

    const result = await login('board@boombayan.org', 'temp-password')
    expect(result.status).toBe('newPasswordRequired')
    if (result.status !== 'newPasswordRequired') throw new Error('expected newPasswordRequired')

    const tokens = await result.completeNewPassword('new-strong-password')
    expect(tokens).toEqual({
      idToken: 'fake-id-token',
      accessToken: 'fake-access-token',
      refreshToken: 'fake-refresh-token',
    })
    expect(completeNewPasswordChallenge).toHaveBeenCalledWith('new-strong-password', {}, expect.anything())
  })

  it('rejects when completing the new-password challenge fails', async () => {
    authenticateUser.mockImplementation((_details, callbacks) => {
      callbacks.newPasswordRequired({ email: 'board@boombayan.org' }, [])
    })
    completeNewPasswordChallenge.mockImplementation((_newPassword, _attrs, callbacks) => {
      callbacks.onFailure(new Error('Password does not conform to policy.'))
    })

    const result = await login('board@boombayan.org', 'temp-password')
    expect(result.status).toBe('newPasswordRequired')
    if (result.status !== 'newPasswordRequired') throw new Error('expected newPasswordRequired')

    await expect(result.completeNewPassword('weak')).rejects.toThrow(
      'Password does not conform to policy.',
    )
  })
})
