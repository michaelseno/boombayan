const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

export async function apiFetch<T>(path: string, idToken: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.detail ?? `API request to ${path} failed with status ${response.status}`)
  }
  return response.json() as Promise<T>
}
