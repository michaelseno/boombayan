import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export function ProtectedRoute() {
  const { idToken } = useAuth()
  if (!idToken) {
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}
