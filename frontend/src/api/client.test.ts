import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './client'

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the bearer token and returns parsed JSON on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user_id: 'abc123' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await apiFetch<{ user_id: string }>('/me', 'fake-id-token')

    expect(result).toEqual({ user_id: 'abc123' })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/me'), {
      headers: { Authorization: 'Bearer fake-id-token' },
    })
  })

  it('throws when the response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiFetch('/me', 'fake-id-token')).rejects.toThrow(
      'API request to /me failed with status 404',
    )
  })

  it('throws the backend detail message when present', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'User not found' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiFetch('/me', 'fake-id-token')).rejects.toThrow('User not found')
  })
})
