import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Loan, Member } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export function LoansPage() {
  const { idToken } = useAuth()
  const [loans, setLoans] = useState<Loan[] | null>(null)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!idToken) return
    let cancelled = false
    Promise.all([apiFetch<Loan[]>('/loans', idToken), apiFetch<Member[]>('/members', idToken)])
      .then(([loansData, membersData]) => {
        if (!cancelled) {
          setLoans(loansData)
          setMembers(membersData)
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load loans.')
      })
    return () => {
      cancelled = true
    }
  }, [idToken])

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!loans || !members) {
    return <p>Loading...</p>
  }

  function memberName(memberId: string): string {
    const member = members!.find((m) => m.member_id === memberId)
    return member ? `${member.first_name} ${member.last_name}` : memberId
  }

  return (
    <div>
      <h1>Loans</h1>
      <Link to="/loans/new">New loan application</Link>
      <table>
        <thead>
          <tr>
            <th>Member</th>
            <th>Requested amount</th>
            <th>Status</th>
            <th>Application date</th>
          </tr>
        </thead>
        <tbody>
          {loans.map((loan) => (
            <tr key={loan.loan_id}>
              <td>
                <Link to={`/loans/${loan.loan_id}`}>{memberName(loan.member_id)}</Link>
              </td>
              <td>{loan.requested_amount}</td>
              <td>{loan.status}</td>
              <td>{loan.application_date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
