import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Loan, Member } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export function NewLoanPage() {
  const { idToken } = useAuth()
  const navigate = useNavigate()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [memberId, setMemberId] = useState('')
  const [requestedAmount, setRequestedAmount] = useState('')
  const [repaymentIntervalDays, setRepaymentIntervalDays] = useState('')
  const [remarks, setRemarks] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!idToken) return
    let cancelled = false
    apiFetch<Member[]>('/members', idToken).then((data) => {
      if (!cancelled) {
        setMembers(data)
        if (data.length > 0) setMemberId(data[0].member_id)
      }
    })
    return () => {
      cancelled = true
    }
  }, [idToken])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!idToken) return
    setError(null)
    try {
      const loan = await apiFetch<Loan>('/loans', idToken, {
        method: 'POST',
        body: {
          member_id: memberId,
          requested_amount: Number(requestedAmount),
          repayment_interval_days: Number(repaymentIntervalDays),
          remarks: remarks || null,
        },
      })
      navigate(`/loans/${loan.loan_id}`)
    } catch {
      setError('Could not create loan application.')
    }
  }

  if (!members) {
    return (
      <div className="motion-safe:animate-pulse space-y-3">
        <div className="h-6 bg-white/10 rounded w-1/3" />
        <div className="h-40 bg-white/10 rounded-xl" />
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-50 mb-6">New loan application</h1>
      <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-6 max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="member" className="block text-xs font-medium text-slate-400 mb-1">
              Member
            </label>
            <select
              id="member"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              required
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150"
            >
              {members.map((member) => (
                <option key={member.member_id} value={member.member_id}>
                  {member.first_name} {member.last_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="requested-amount" className="block text-xs font-medium text-slate-400 mb-1">
              Requested amount
            </label>
            <input
              id="requested-amount"
              type="number"
              value={requestedAmount}
              onChange={(e) => setRequestedAmount(e.target.value)}
              required
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150"
            />
          </div>
          <div>
            <label htmlFor="repayment-interval-days" className="block text-xs font-medium text-slate-400 mb-1">
              Repayment interval (days)
            </label>
            <input
              id="repayment-interval-days"
              type="number"
              value={repaymentIntervalDays}
              onChange={(e) => setRepaymentIntervalDays(e.target.value)}
              required
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150"
            />
          </div>
          <div>
            <label htmlFor="remarks" className="block text-xs font-medium text-slate-400 mb-1">
              Remarks
            </label>
            <input
              id="remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150"
            />
          </div>
          {error && (
            <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer"
          >
            Submit application
          </button>
        </form>
      </div>
    </div>
  )
}
