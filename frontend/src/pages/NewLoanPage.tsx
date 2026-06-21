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
    return <p>Loading...</p>
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>New loan application</h1>
      <label htmlFor="member">Member</label>
      <select id="member" value={memberId} onChange={(e) => setMemberId(e.target.value)} required>
        {members.map((member) => (
          <option key={member.member_id} value={member.member_id}>
            {member.first_name} {member.last_name}
          </option>
        ))}
      </select>
      <label htmlFor="requested-amount">Requested amount</label>
      <input
        id="requested-amount"
        type="number"
        value={requestedAmount}
        onChange={(e) => setRequestedAmount(e.target.value)}
        required
      />
      <label htmlFor="repayment-interval-days">Repayment interval (days)</label>
      <input
        id="repayment-interval-days"
        type="number"
        value={repaymentIntervalDays}
        onChange={(e) => setRepaymentIntervalDays(e.target.value)}
        required
      />
      <label htmlFor="remarks">Remarks</label>
      <input id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Submit application</button>
    </form>
  )
}
