import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
    let cancelled = false
    apiFetch<CurrentUser>('/me', idToken)
      .then((data) => {
        if (!cancelled) setUser(data)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your profile.')
      })
    return () => {
      cancelled = true
    }
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
      <nav>
        <Link to="/members">Members</Link>
        {user.is_administrator && <Link to="/settings">Settings</Link>}
      </nav>
      <button onClick={logout}>Log out</button>
    </div>
  )
}
