import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Cycle } from '../api/types'
import { useAuth } from '../auth/AuthContext'

interface CurrentUser {
  user_id: string
  email: string
  is_administrator: boolean
  member_id: string | null
}

export function CyclesPage() {
  const { idToken } = useAuth()
  const [cycles, setCycles] = useState<Cycle[] | null>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [startDate, setStartDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  useEffect(() => {
    if (!idToken) return
    let cancelled = false
    Promise.all([apiFetch<Cycle[]>('/cycles', idToken), apiFetch<CurrentUser>('/me', idToken)])
      .then(([cyclesData, userData]) => {
        if (!cancelled) {
          setCycles(cyclesData)
          setCurrentUser(userData)
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load cycles.')
      })
    return () => {
      cancelled = true
    }
  }, [idToken])

  async function handleOpenCycle(event: FormEvent) {
    event.preventDefault()
    if (!idToken) return
    setOpenError(null)
    try {
      const created = await apiFetch<Cycle>('/cycles', idToken, {
        method: 'POST',
        body: { start_date: startDate || null },
      })
      setCycles((prev) => [...(prev ?? []), created])
      setStartDate('')
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : 'Could not open a new cycle.')
    }
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!cycles || !currentUser) {
    return <p>Loading...</p>
  }

  const hasOpenCycle = cycles.some((cycle) => cycle.status === 'Open')

  return (
    <div>
      <h1>Cycles</h1>
      <table>
        <thead>
          <tr>
            <th>Start date</th>
            <th>End date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {cycles.map((cycle) => (
            <tr key={cycle.cycle_id}>
              <td>
                <Link to={`/cycles/${cycle.cycle_id}`}>{cycle.start_date}</Link>
              </td>
              <td>{cycle.end_date ?? '-'}</td>
              <td>{cycle.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {currentUser.is_administrator && !hasOpenCycle && (
        <form onSubmit={handleOpenCycle}>
          <h2>Open a new cycle</h2>
          <label htmlFor="start-date">Start date</label>
          <input id="start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          {openError && <p role="alert">{openError}</p>}
          <button type="submit">Open cycle</button>
        </form>
      )}
    </div>
  )
}
