import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './client'

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the bearer token and returns parsed JSON on a default GET request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user_id: 'abc123' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await apiFetch<{ user_id: string }>('/me', 'fake-id-token')

    expect(result).toEqual({ user_id: 'abc123' })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/me'), {
      method: 'GET',
      headers: { Authorization: 'Bearer fake-id-token' },
      body: undefined,
    })
  })

  it('sends a JSON body and Content-Type header for POST requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ member_id: 'mem-1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await apiFetch<{ member_id: string }>('/members', 'fake-id-token', {
      method: 'POST',
      body: { first_name: 'Ana' },
    })

    expect(result).toEqual({ member_id: 'mem-1' })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/members'), {
      method: 'POST',
      headers: { Authorization: 'Bearer fake-id-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: 'Ana' }),
    })
  })

  it('throws when the response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiFetch('/me', 'fake-id-token')).rejects.toThrow(
      'API request to /me failed with status 404',
    )
  })
})
