import { FormEvent, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Member } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export function MemberDetailPage() {
  const { memberId } = useParams<{ memberId: string }>()
  const { idToken } = useAuth()
  const [member, setMember] = useState<Member | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sharesToPurchase, setSharesToPurchase] = useState('')
  const [purchaseError, setPurchaseError] = useState<string | null>(null)
  const [isSubmittingPurchase, setIsSubmittingPurchase] = useState(false)

  useEffect(() => {
    if (!idToken || !memberId) return
    let cancelled = false
    apiFetch<Member>(`/members/${memberId}`, idToken)
      .then((data) => {
        if (!cancelled) setMember(data)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this member.')
      })
    return () => {
      cancelled = true
    }
  }, [idToken, memberId])

  async function handlePurchase(event: FormEvent) {
    event.preventDefault()
    if (!idToken || !memberId) return
    setPurchaseError(null)
    setIsSubmittingPurchase(true)
    try {
      const updated = await apiFetch<Member>(`/members/${memberId}/shares`, idToken, {
        method: 'POST',
        body: { shares_purchased: Number(sharesToPurchase) },
      })
      setMember(updated)
      setSharesToPurchase('')
    } catch (err) {
      setPurchaseError(err instanceof Error ? err.message : 'Could not record the share purchase.')
    } finally {
      setIsSubmittingPurchase(false)
    }
  }

  if (error) {
    return (
      <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
        {error}
      </p>
    )
  }

  if (!member) {
    return (
      <div className="motion-safe:animate-pulse space-y-3">
        <div className="h-6 bg-white/10 rounded w-1/3" />
        <div className="h-32 bg-white/10 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-50">{member.first_name} {member.last_name}</h1>
      </div>

      {/* Member info card */}
      <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-6">
        <h2 className="text-base font-semibold text-slate-300 mb-4">Member details</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <dt className="text-slate-500">Status</dt>
          <dd className="text-slate-300">{member.status}</dd>
          <dt className="text-slate-500">Email</dt>
          <dd className="text-slate-300">{member.email}</dd>
          <dt className="text-slate-500">Phone</dt>
          <dd className="text-slate-300">{member.phone}</dd>
          <dt className="text-slate-500">Current shares</dt>
          <dd className="text-slate-300">{member.current_shares}</dd>
          <dt className="text-slate-500">Current capital</dt>
          <dd className="text-slate-300">{member.current_capital_amount}</dd>
        </dl>
      </div>

      {/* Share history */}
      <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-6">
        <h2 className="text-base font-semibold text-slate-300 mb-4">Share history</h2>
        <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-white/[0.05]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">Shares purchased</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">Share value</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">Amount paid</th>
              </tr>
            </thead>
            <tbody>
              {member.share_history.map((entry, index) => (
                <tr key={index} className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors duration-150">
                  <td className="px-4 py-3 text-slate-300">{entry.date}</td>
                  <td className="px-4 py-3 text-slate-300">{entry.shares_purchased}</td>
                  <td className="px-4 py-3 text-slate-300">{entry.share_value_at_purchase}</td>
                  <td className="px-4 py-3 text-slate-300">{entry.amount_paid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Purchase shares */}
      <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-6">
        <h2 className="text-base font-semibold text-slate-300 mb-4">Purchase shares</h2>
        <form onSubmit={handlePurchase} className="space-y-4 max-w-xs">
          <div>
            <label htmlFor="shares-purchased" className="block text-xs font-medium text-slate-400 mb-1">
              Shares to purchase
            </label>
            <input
              id="shares-purchased"
              type="number"
              min="1"
              value={sharesToPurchase}
              onChange={(e) => setSharesToPurchase(e.target.value)}
              required
              disabled={isSubmittingPurchase}
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150"
            />
          </div>
          {purchaseError && (
            <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
              {purchaseError}
            </p>
          )}
          <button
            type="submit"
            disabled={isSubmittingPurchase}
            className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer"
          >
            Purchase
          </button>
        </form>
      </div>
    </div>
  )
}
