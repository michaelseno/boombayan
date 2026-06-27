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
    return (
      <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
        {error}
      </p>
    )
  }

  if (!members) {
    return (
      <div className="motion-safe:animate-pulse space-y-3">
        <div className="h-6 bg-white/10 rounded w-1/4" />
        <div className="h-40 bg-white/10 rounded-xl" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-50">Members</h1>
        <Link
          to="/members/new"
          className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer"
        >
          Add member
        </Link>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-white/[0.05]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">Shares</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">Capital</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr
                key={member.member_id}
                className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors duration-150 cursor-pointer"
              >
                <td className="px-4 py-3 text-slate-300">
                  <Link to={`/members/${member.member_id}`} className="hover:text-amber-400 transition-colors duration-150">
                    {member.first_name} {member.last_name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-300">{member.status}</td>
                <td className="px-4 py-3 text-slate-300">{member.current_shares}</td>
                <td className="px-4 py-3 text-slate-300">{member.current_capital_amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
