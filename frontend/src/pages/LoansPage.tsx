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
    return (
      <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
        {error}
      </p>
    )
  }

  if (!loans || !members) {
    return (
      <div className="motion-safe:animate-pulse space-y-3">
        <div className="h-6 bg-white/10 rounded w-1/4" />
        <div className="h-40 bg-white/10 rounded-xl" />
      </div>
    )
  }

  function memberName(memberId: string): string {
    const member = members!.find((m) => m.member_id === memberId)
    return member ? `${member.first_name} ${member.last_name}` : memberId
  }

  const statusColors: Record<string, string> = {
    'Pending Board Approval': 'bg-amber-500/20 text-amber-300',
    'Approved': 'bg-blue-500/20 text-blue-300',
    'Active': 'bg-green-500/20 text-green-300',
    'Rejected': 'bg-red-500/20 text-red-300',
    'Completed': 'bg-slate-500/20 text-slate-300',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-50">Loans</h1>
        <Link
          to="/loans/new"
          className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer"
        >
          New loan application
        </Link>
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-white/[0.05]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">
                Member
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">
                Requested amount
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">
                Application date
              </th>
            </tr>
          </thead>
          <tbody>
            {loans.map((loan) => (
              <tr
                key={loan.loan_id}
                className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors duration-150 cursor-pointer"
              >
                <td className="px-4 py-3 text-slate-300">
                  <Link to={`/loans/${loan.loan_id}`} className="hover:text-amber-400 transition-colors duration-150">
                    {memberName(loan.member_id)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-300">{loan.requested_amount}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[loan.status] ?? 'bg-slate-500/20 text-slate-300'}`}
                  >
                    {loan.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-300">{loan.application_date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
