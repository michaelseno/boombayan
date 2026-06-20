import { useEffect, useState } from 'react'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'

interface CurrentUser {
  user_id: string
  email: string
  is_administrator: boolean
  member_id: string | null
}

export function DashboardPage() {
  const { idToken, logout } = useAuth()
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!idToken) return
    apiFetch<CurrentUser>('/me', idToken)
      .then(setUser)
      .catch(() => setError('Could not load your profile.'))
  }, [idToken])

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!user) {
    return <p>Loading...</p>
  }

  return (
    <div>
      <h1>Welcome, {user.email}</h1>
      <p>{user.is_administrator ? 'Administrator' : 'Board Member'}</p>
      <button onClick={logout}>Log out</button>
    </div>
  )
}
