import { FormEvent, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Cycle, CycleCloseResult, Dividend, Member } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useCurrentUser } from '../auth/CurrentUserContext'

export function CycleDetailPage() {
  const { cycleId } = useParams<{ cycleId: string }>()
  const { idToken } = useAuth()
  const { currentUser } = useCurrentUser()
  const [cycle, setCycle] = useState<Cycle | null>(null)
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
      apiFetch<Dividend[]>(`/cycles/${cycleId}/dividends`, idToken),
      apiFetch<Member[]>('/members', idToken),
    ])
      .then(([cycleData, dividendsData, membersData]) => {
        if (!cancelled) {
          setCycle(cycleData)
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
    return (
      <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
        {error}
      </p>
    )
  }

  if (!cycle) {
    return (
      <div className="motion-safe:animate-pulse space-y-3">
        <div className="h-6 bg-white/10 rounded w-1/4" />
        <div className="h-40 bg-white/10 rounded-xl" />
      </div>
    )
  }

  const canClose = currentUser?.is_administrator && cycle.status === 'Open'

  function rankBadge(rank: number | null) {
    if (rank === null) return <span className="text-slate-500">-</span>
    const cls =
      rank === 1
        ? 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-300'
        : 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-500/20 text-slate-300'
    return <span className={cls}>#{rank}</span>
  }

  const thCls =
    'px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]'
  const tdCls = 'px-4 py-3 text-sm text-slate-300'

  return (
    <div className="space-y-6">
      {/* Cycle summary card */}
      <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-6">
        <h1 className="text-2xl font-bold text-slate-50 mb-4">Cycle {cycle.cycle_id}</h1>
        <div className="space-y-1 text-sm">
          <p className="text-slate-300">Status: {cycle.status}</p>
          <p className="text-slate-300">Start date: {cycle.start_date}</p>
          <p className="text-slate-300">End date: {cycle.end_date ?? '-'}</p>
          <p className="text-slate-300">Total interest earned: {cycle.total_interest_earned ?? '-'}</p>
          <p className="text-slate-300">Total penalties collected: {cycle.total_penalties_collected ?? '-'}</p>
          <p className="text-slate-300">Top 3 bonus pool: {cycle.top3_bonus_pool ?? '-'}</p>
          <p className="text-slate-300">Remaining profit: {cycle.remaining_profit ?? '-'}</p>
          <p className="text-slate-300">Total shares at close: {cycle.total_shares_at_close ?? '-'}</p>
        </div>
      </div>

      {/* Close cycle panel (admin + open cycle only) */}
      {canClose && (
        <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-6">
          <h2 className="text-lg font-semibold text-slate-200 mb-4">Close this cycle</h2>
          <button
            type="button"
            onClick={handlePreviewClose}
            className="bg-white/[0.08] hover:bg-white/[0.12] text-slate-300 border border-white/10 px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer"
          >
            Preview close
          </button>
          {previewError && (
            <p role="alert" className="mt-3 bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
              {previewError}
            </p>
          )}
          {preview && (
            <form onSubmit={handleConfirmClose} className="mt-4 space-y-4">
              <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4 space-y-1 text-sm">
                <h3 className="text-base font-semibold text-slate-200 mb-2">Preview</h3>
                <p className="text-slate-300">Total interest earned: {preview.total_interest_earned}</p>
                <p className="text-slate-300">Total penalties collected: {preview.total_penalties_collected}</p>
                <p className="text-slate-300">Top 3 bonus pool: {preview.top3_bonus_pool}</p>
                <p className="text-slate-300">Remaining profit: {preview.remaining_profit}</p>
              </div>

              <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-white/[0.05]">
                    <tr>
                      <th className={thCls}>Member</th>
                      <th className={thCls}>Shares</th>
                      <th className={thCls}>Rank</th>
                      <th className={thCls}>Share-based amount</th>
                      <th className={thCls}>Top 3 bonus</th>
                      <th className={thCls}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.dividends.map((dividend) => (
                      <tr
                        key={dividend.member_id}
                        className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors duration-150"
                      >
                        <td className={tdCls}>{memberName(dividend.member_id)}</td>
                        <td className={tdCls}>{dividend.shares_at_calculation}</td>
                        <td className={tdCls}>{rankBadge(dividend.rank)}</td>
                        <td className={tdCls}>{dividend.share_based_amount}</td>
                        <td className={tdCls}>{dividend.top3_bonus_amount}</td>
                        <td className={tdCls}>{dividend.total_amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-end gap-4">
                <div>
                  <label htmlFor="end-date" className="block text-xs font-medium text-slate-400 mb-1">
                    End date
                  </label>
                  <input
                    id="end-date"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="bg-white/[0.05] border border-white/[0.12] text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  />
                </div>
                {closeError && (
                  <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
                    {closeError}
                  </p>
                )}
                <button
                  type="submit"
                  className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer"
                >
                  Confirm close
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Dividends table */}
      <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-200 mb-4">Dividends</h2>
        <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-white/[0.05]">
              <tr>
                <th className={thCls}>Member</th>
                <th className={thCls}>Shares</th>
                <th className={thCls}>Rank</th>
                <th className={thCls}>Share-based amount</th>
                <th className={thCls}>Top 3 bonus</th>
                <th className={thCls}>Total</th>
              </tr>
            </thead>
            <tbody>
              {dividends.map((dividend) => (
                <tr
                  key={dividend.member_id}
                  className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors duration-150"
                >
                  <td className={tdCls}>{memberName(dividend.member_id)}</td>
                  <td className={tdCls}>{dividend.shares_at_calculation}</td>
                  <td className={tdCls}>{rankBadge(dividend.rank)}</td>
                  <td className={tdCls}>{dividend.share_based_amount}</td>
                  <td className={tdCls}>{dividend.top3_bonus_amount}</td>
                  <td className={tdCls}>{dividend.total_amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
