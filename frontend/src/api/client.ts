const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

export interface ApiFetchOptions {
  method?: string
  body?: unknown
}

export async function apiFetch<T>(
  path: string,
  idToken: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${idToken}` }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  if (!response.ok) {
    throw new Error(`API request to ${path} failed with status ${response.status}`)
  }
  return response.json() as Promise<T>
}
