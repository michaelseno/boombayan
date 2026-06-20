import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Member } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export function MembersPage() {
  const { idToken } = useAuth()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!idToken) return
    let cancelled = false
    apiFetch<Member[]>('/members', idToken)
      .then((data) => {
        if (!cancelled) setMembers(data)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load members.')
      })
    return () => {
      cancelled = true
    }
  }, [idToken])

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!members) {
    return <p>Loading...</p>
  }

  return (
    <div>
      <h1>Members</h1>
      <Link to="/members/new">Add member</Link>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Shares</th>
            <th>Capital</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.member_id}>
              <td>
                <Link to={`/members/${member.member_id}`}>
                  {member.first_name} {member.last_name}
                </Link>
              </td>
              <td>{member.status}</td>
              <td>{member.current_shares}</td>
              <td>{member.current_capital_amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
