import { createContext, useContext, useEffect, useState } from 'react'
import { apiFetch } from '../api/client'
import { useAuth } from './AuthContext'

export interface CurrentUser {
  user_id: string
  email: string
  is_administrator: boolean
  member_id: string | null
}

interface CurrentUserContextValue {
  currentUser: CurrentUser | null
  loading: boolean
  error: string | null
}

export const CurrentUserContext = createContext<CurrentUserContextValue>({
  currentUser: null,
  loading: false,
  error: null,
})

export function useCurrentUser(): CurrentUserContextValue {
  return useContext(CurrentUserContext)
}

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const { idToken } = useAuth()
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!idToken) return
    let cancelled = false
    setLoading(true)
    apiFetch<CurrentUser>('/me', idToken)
      .then((data) => {
        if (!cancelled) {
          setCurrentUser(data)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load your profile.')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [idToken])

  return (
    <CurrentUserContext.Provider value={{ currentUser, loading, error }}>
      {children}
    </CurrentUserContext.Provider>
  )
}
