import { FormEvent, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { ApprovalVoteStatus, Loan, Transaction } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useCurrentUser } from '../auth/CurrentUserContext'

export function LoanDetailPage() {
  const { loanId } = useParams<{ loanId: string }>()
  const { idToken } = useAuth()
  const { currentUser } = useCurrentUser()
  const [loan, setLoan] = useState<Loan | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [error, setError] = useState<string | null>(null)
  const [comments, setComments] = useState('')
  const [voteError, setVoteError] = useState<string | null>(null)
  const [releaseDate, setReleaseDate] = useState('')
  const [releaseError, setReleaseError] = useState<string | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [paymentError, setPaymentError] = useState<string | null>(null)

  useEffect(() => {
    if (!idToken || !loanId) return
    let cancelled = false
    Promise.all([
      apiFetch<Loan>(`/loans/${loanId}`, idToken),
      apiFetch<Transaction[]>(`/loans/${loanId}/transactions`, idToken),
    ])
      .then(([loanData, transactionsData]) => {
        if (!cancelled) {
          setLoan(loanData)
          setTransactions(transactionsData)
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this loan.')
      })
    return () => {
      cancelled = true
    }
  }, [idToken, loanId])

  async function handleVote(status: ApprovalVoteStatus) {
    if (!idToken || !loanId) return
    setVoteError(null)
    try {
      const updated = await apiFetch<Loan>(`/loans/${loanId}/approvals`, idToken, {
        method: 'POST',
        body: { status, comments: comments || null },
      })
      setLoan(updated)
      setComments('')
    } catch (err) {
      setVoteError(err instanceof Error ? err.message : 'Could not record your vote.')
    }
  }

  async function handleRelease(event: FormEvent) {
    event.preventDefault()
    if (!idToken || !loanId) return
    setReleaseError(null)
    try {
      const updated = await apiFetch<Loan>(`/loans/${loanId}/release`, idToken, {
        method: 'POST',
        body: { release_date: releaseDate || null },
      })
      setLoan(updated)
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : 'Could not release this loan.')
    }
  }

  async function handleRecordPayment(event: FormEvent) {
    event.preventDefault()
    if (!idToken || !loanId) return
    setPaymentError(null)
    try {
      const updated = await apiFetch<Loan>(`/loans/${loanId}/payments`, idToken, {
        method: 'POST',
        body: { amount: Number(paymentAmount), payment_date: paymentDate || null, notes: paymentNotes || null },
      })
      setLoan(updated)
      setPaymentAmount('')
      setPaymentDate('')
      setPaymentNotes('')
      const updatedTransactions = await apiFetch<Transaction[]>(`/loans/${loanId}/transactions`, idToken)
      setTransactions(updatedTransactions)
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Could not record this payment.')
    }
  }

  if (error) {
    return (
      <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
        {error}
      </p>
    )
  }

  if (!loan) {
    return (
      <div className="motion-safe:animate-pulse space-y-3">
        <div className="h-6 bg-white/10 rounded w-1/3" />
        <div className="h-40 bg-white/10 rounded-xl" />
      </div>
    )
  }

  const myApproval = loan.approvals[currentUser?.user_id ?? '']
  const canVote = loan.status === 'Pending Board Approval' && myApproval?.status === 'Pending'
  const canRelease = currentUser?.is_administrator && loan.status === 'Approved'
  const canRecordPayment = currentUser?.is_administrator && loan.status === 'Active'

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-50">Loan {loan.loan_id}</h1>

      <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-6 space-y-1 text-sm">
        <p className="text-slate-300">Status: {loan.status}</p>
        <p className="text-slate-300">Requested amount: {loan.requested_amount}</p>
        <p className="text-slate-300">Approved amount: {loan.approved_amount ?? 'Not yet approved'}</p>
        <p className="text-slate-300">Repayment interval (days): {loan.repayment_interval_days}</p>
        <p className="text-slate-300">Interest rate: {loan.interest_rate}</p>
        <p className="text-slate-300">Application date: {loan.application_date}</p>
        {loan.is_exception_case && (
          <p className="text-amber-300">Exception case: requested amount exceeds the member&apos;s capital.</p>
        )}
        {loan.remarks && <p className="text-slate-300">Remarks: {loan.remarks}</p>}
        {(loan.status === 'Active' || loan.status === 'Completed') && (
          <div className="mt-3 pt-3 border-t border-white/[0.08] space-y-1">
            <p className="text-slate-300">Release date: {loan.release_date}</p>
            <p className="text-slate-300">Interest deduction: {loan.interest_deduction}</p>
            <p className="text-slate-300">Net release amount: {loan.net_release_amount}</p>
            <p className="text-slate-300">Remaining balance: {loan.remaining_balance}</p>
            <p className="text-slate-300">Next due date: {loan.next_due_date}</p>
          </div>
        )}
      </div>

      <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-6">
        <h2 className="text-base font-semibold text-slate-300 mb-4">Approvals</h2>
        <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-white/[0.05]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">
                  Board member
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">
                  Comments
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(loan.approvals).map(([userId, entry]) => (
                <tr key={userId} className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors duration-150">
                  <td className="px-4 py-3 text-slate-300">{entry.email}</td>
                  <td className="px-4 py-3 text-slate-300">{entry.status}</td>
                  <td className="px-4 py-3 text-slate-300">{entry.date ?? '-'}</td>
                  <td className="px-4 py-3 text-slate-300">{entry.comments ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canVote && (
          <div className="mt-4 space-y-3 max-w-xs">
            <h2 className="text-base font-semibold text-slate-300">Cast your vote</h2>
            <div>
              <label htmlFor="comments" className="block text-xs font-medium text-slate-400 mb-1">
                Comments
              </label>
              <input
                id="comments"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150"
              />
            </div>
            {voteError && (
              <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
                {voteError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleVote('Approved')}
                className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => handleVote('Rejected')}
                className="bg-red-600 hover:bg-red-500 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer"
              >
                Reject
              </button>
            </div>
          </div>
        )}
      </div>

      {canRelease && (
        <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-6">
          <form onSubmit={handleRelease} className="space-y-3 max-w-xs">
            <h2 className="text-base font-semibold text-slate-300">Release this loan</h2>
            <div>
              <label htmlFor="release-date" className="block text-xs font-medium text-slate-400 mb-1">
                Release date
              </label>
              <input
                id="release-date"
                type="date"
                value={releaseDate}
                onChange={(e) => setReleaseDate(e.target.value)}
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150"
              />
            </div>
            {releaseError && (
              <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
                {releaseError}
              </p>
            )}
            <button
              type="submit"
              className="bg-violet-600 hover:bg-violet-500 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer"
            >
              Release loan
            </button>
          </form>
        </div>
      )}

      {canRecordPayment && (
        <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-6">
          <form onSubmit={handleRecordPayment} className="space-y-3 max-w-xs">
            <h2 className="text-base font-semibold text-slate-300">Record a payment</h2>
            <div>
              <label htmlFor="payment-amount" className="block text-xs font-medium text-slate-400 mb-1">
                Amount
              </label>
              <input
                id="payment-amount"
                type="number"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                required
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150"
              />
            </div>
            <div>
              <label htmlFor="payment-date" className="block text-xs font-medium text-slate-400 mb-1">
                Payment date
              </label>
              <input
                id="payment-date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150"
              />
            </div>
            <div>
              <label htmlFor="payment-notes" className="block text-xs font-medium text-slate-400 mb-1">
                Notes
              </label>
              <input
                id="payment-notes"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150"
              />
            </div>
            {paymentError && (
              <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
                {paymentError}
              </p>
            )}
            <button
              type="submit"
              className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer"
            >
              Record payment
            </button>
          </form>
        </div>
      )}

      <div className="bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-6">
        <h2 className="text-base font-semibold text-slate-300 mb-4">Transaction history</h2>
        <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-white/[0.05]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">
                  Amount
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">
                  Balance after
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">
                  Recorded by
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.transaction_id} className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors duration-150">
                  <td className="px-4 py-3 text-slate-300">{transaction.type}</td>
                  <td className="px-4 py-3 text-slate-300">{transaction.amount}</td>
                  <td className="px-4 py-3 text-slate-300">{transaction.remaining_balance_after}</td>
                  <td className="px-4 py-3 text-slate-300">{transaction.timestamp}</td>
                  <td className="px-4 py-3 text-slate-300">{transaction.recorded_by ?? '-'}</td>
                  <td className="px-4 py-3 text-slate-300">{transaction.notes ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
