import { FormEvent, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Cycle, CycleCloseResult, Dividend, Member } from '../api/types'
import { useAuth } from '../auth/AuthContext'

interface CurrentUser {
  user_id: string
  email: string
  is_administrator: boolean
  member_id: string | null
}

export function CycleDetailPage() {
  const { cycleId } = useParams<{ cycleId: string }>()
  const { idToken } = useAuth()
  const [cycle, setCycle] = useState<Cycle | null>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [dividends, setDividends] = useState<Dividend[]>([])
  const [preview, setPreview] = useState<CycleCloseResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [endDate, setEndDate] = useState('')

  useEffect(() => {
    if (!idToken || !cycleId) return
    let cancelled = false
    Promise.all([
      apiFetch<Cycle>(`/cycles/${cycleId}`, idToken),
      apiFetch<CurrentUser>('/me', idToken),
      apiFetch<Dividend[]>(`/cycles/${cycleId}/dividends`, idToken),
      apiFetch<Member[]>('/members', idToken),
    ])
      .then(([cycleData, userData, dividendsData, membersData]) => {
        if (!cancelled) {
          setCycle(cycleData)
          setCurrentUser(userData)
          setDividends(dividendsData)
          setMembers(membersData)
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this cycle.')
      })
    return () => {
      cancelled = true
    }
  }, [idToken, cycleId])

  function memberName(memberId: string): string {
    const member = members.find((m) => m.member_id === memberId)
    return member ? `${member.first_name} ${member.last_name}` : memberId
  }

  async function handlePreviewClose() {
    if (!idToken || !cycleId) return
    setPreviewError(null)
    try {
      const result = await apiFetch<CycleCloseResult>(`/cycles/${cycleId}/preview-close`, idToken)
      setPreview(result)
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Could not preview this close.')
    }
  }

  async function handleConfirmClose(event: FormEvent) {
    event.preventDefault()
    if (!idToken || !cycleId) return
    setCloseError(null)
    try {
      const updated = await apiFetch<Cycle>(`/cycles/${cycleId}/close`, idToken, {
        method: 'POST',
        body: { end_date: endDate || null },
      })
      setCycle(updated)
      setPreview(null)
      const updatedDividends = await apiFetch<Dividend[]>(`/cycles/${cycleId}/dividends`, idToken)
      setDividends(updatedDividends)
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : 'Could not close this cycle.')
    }
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!cycle || !currentUser) {
    return <p>Loading...</p>
  }

  const canClose = currentUser.is_administrator && cycle.status === 'Open'

  return (
    <div>
      <h1>Cycle {cycle.cycle_id}</h1>
      <p>Status: {cycle.status}</p>
      <p>Start date: {cycle.start_date}</p>
      <p>End date: {cycle.end_date ?? '-'}</p>
      <p>Total interest earned: {cycle.total_interest_earned ?? '-'}</p>
      <p>Total penalties collected: {cycle.total_penalties_collected ?? '-'}</p>
      <p>Top 3 bonus pool: {cycle.top3_bonus_pool ?? '-'}</p>
      <p>Remaining profit: {cycle.remaining_profit ?? '-'}</p>
      <p>Total shares at close: {cycle.total_shares_at_close ?? '-'}</p>

      {canClose && (
        <div>
          <h2>Close this cycle</h2>
          <button type="button" onClick={handlePreviewClose}>Preview close</button>
          {previewError && <p role="alert">{previewError}</p>}
          {preview && (
            <form onSubmit={handleConfirmClose}>
              <h3>Preview</h3>
              <p>Total interest earned: {preview.total_interest_earned}</p>
              <p>Total penalties collected: {preview.total_penalties_collected}</p>
              <p>Top 3 bonus pool: {preview.top3_bonus_pool}</p>
              <p>Remaining profit: {preview.remaining_profit}</p>
              <table>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Shares</th>
                    <th>Rank</th>
                    <th>Share-based amount</th>
                    <th>Top 3 bonus</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.dividends.map((dividend) => (
                    <tr key={dividend.member_id}>
                      <td>{memberName(dividend.member_id)}</td>
                      <td>{dividend.shares_at_calculation}</td>
                      <td>{dividend.rank ?? '-'}</td>
                      <td>{dividend.share_based_amount}</td>
                      <td>{dividend.top3_bonus_amount}</td>
                      <td>{dividend.total_amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <label htmlFor="end-date">End date</label>
              <input id="end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              {closeError && <p role="alert">{closeError}</p>}
              <button type="submit">Confirm close</button>
            </form>
          )}
        </div>
      )}

      <h2>Dividends</h2>
      <table>
        <thead>
          <tr>
            <th>Member</th>
            <th>Shares</th>
            <th>Rank</th>
            <th>Share-based amount</th>
            <th>Top 3 bonus</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {dividends.map((dividend) => (
            <tr key={dividend.member_id}>
              <td>{memberName(dividend.member_id)}</td>
              <td>{dividend.shares_at_calculation}</td>
              <td>{dividend.rank ?? '-'}</td>
              <td>{dividend.share_based_amount}</td>
              <td>{dividend.top3_bonus_amount}</td>
              <td>{dividend.total_amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
