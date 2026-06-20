import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Member } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export function MemberDetailPage() {
  const { memberId } = useParams<{ memberId: string }>()
  const { idToken } = useAuth()
  const [member, setMember] = useState<Member | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!member) {
    return <p>Loading...</p>
  }

  return (
    <div>
      <h1>{member.first_name} {member.last_name}</h1>
      <p>Status: {member.status}</p>
      <p>Email: {member.email}</p>
      <p>Phone: {member.phone}</p>
      <p>Current shares: {member.current_shares}</p>
      <p>Current capital: {member.current_capital_amount}</p>
      <h2>Share history</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Shares purchased</th>
            <th>Share value</th>
            <th>Amount paid</th>
          </tr>
        </thead>
        <tbody>
          {member.share_history.map((entry, index) => (
            <tr key={index}>
              <td>{entry.date}</td>
              <td>{entry.shares_purchased}</td>
              <td>{entry.share_value_at_purchase}</td>
              <td>{entry.amount_paid}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
