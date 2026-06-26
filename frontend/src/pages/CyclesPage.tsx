import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Cycle } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useCurrentUser } from '../auth/CurrentUserContext'

export function CyclesPage() {
  const { idToken } = useAuth()
  const { currentUser } = useCurrentUser()
  const [cycles, setCycles] = useState<Cycle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  useEffect(() => {
    if (!idToken) return
    let cancelled = false
    apiFetch<Cycle[]>('/cycles', idToken)
      .then((data) => {
        if (!cancelled) setCycles(data)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load cycles.')
      })
    return () => {
      cancelled = true
    }
  }, [idToken])

  async function handleOpen(event: FormEvent) {
    event.preventDefault()
    if (!idToken) return
    setOpenError(null)
    try {
      const newCycle = await apiFetch<Cycle>('/cycles', idToken, { method: 'POST', body: { start_date: null } })
      setCycles((prev) => [...(prev ?? []), newCycle])
    } catch {
      setOpenError('Could not open cycle.')
    }
  }

  const hasOpenCycle = cycles?.some((c) => c.status === 'Open') ?? false
  const canOpen = currentUser?.is_administrator && !hasOpenCycle

  if (error) {
    return (
      <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
        {error}
      </p>
    )
  }

  if (!cycles) {
    return (
      <div className="motion-safe:animate-pulse space-y-3">
        <div className="h-6 bg-white/10 rounded w-1/4" />
        <div className="h-40 bg-white/10 rounded-xl" />
      </div>
    )
  }

  const statusColors: Record<string, string> = {
    Open: 'bg-green-500/20 text-green-300',
    Closed: 'bg-slate-500/20 text-slate-300',
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-50">Cycles</h1>

      <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-white/[0.05]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">
                Start date
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {cycles.map((c) => (
              <tr
                key={c.cycle_id}
                className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors duration-150"
              >
                <td className="px-4 py-3 text-slate-300">
                  <Link to={`/cycles/${c.cycle_id}`} className="hover:text-amber-400 transition-colors duration-150">
                    {c.start_date}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[c.status] ?? 'bg-slate-500/20 text-slate-300'}`}
                  >
                    {c.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canOpen && (
        <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-6 max-w-xs">
          <h2 className="text-base font-semibold text-slate-300 mb-4">Open a new cycle</h2>
          <form onSubmit={handleOpen}>
            {openError && (
              <p
                role="alert"
                className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm mb-3"
              >
                {openError}
              </p>
            )}
            <button
              type="submit"
              className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer"
            >
              Open cycle
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
