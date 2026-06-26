import { useCurrentUser } from '../auth/CurrentUserContext'

export function DashboardPage() {
  const { currentUser, loading, error } = useCurrentUser()

  if (loading) {
    return (
      <div className="motion-safe:animate-pulse space-y-3">
        <div className="h-6 bg-white/10 rounded w-1/3" />
        <div className="h-4 bg-white/10 rounded w-1/4" />
        <span className="sr-only">Loading...</span>
      </div>
    )
  }

  if (error) {
    return (
      <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
        {error}
      </p>
    )
  }

  if (!currentUser) return null

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-50 mb-2">Welcome, {currentUser.email}</h1>
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          currentUser.is_administrator
            ? 'bg-amber-500/20 text-amber-300'
            : 'bg-blue-500/20 text-blue-300'
        }`}
      >
        {currentUser.is_administrator ? 'Administrator' : 'Board Member'}
      </span>
    </div>
  )
}
