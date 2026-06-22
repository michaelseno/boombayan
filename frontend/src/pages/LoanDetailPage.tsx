import { FormEvent, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { ApprovalVoteStatus, Loan, Transaction } from '../api/types'
import { useAuth } from '../auth/AuthContext'

interface CurrentUser {
  user_id: string
  email: string
  is_administrator: boolean
  member_id: string | null
}

export function LoanDetailPage() {
  const { loanId } = useParams<{ loanId: string }>()
  const { idToken } = useAuth()
  const [loan, setLoan] = useState<Loan | null>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
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
      apiFetch<CurrentUser>('/me', idToken),
      apiFetch<Transaction[]>(`/loans/${loanId}/transactions`, idToken),
    ])
      .then(([loanData, userData, transactionsData]) => {
        if (!cancelled) {
          setLoan(loanData)
          setCurrentUser(userData)
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
    return <p role="alert">{error}</p>
  }

  if (!loan || !currentUser) {
    return <p>Loading...</p>
  }

  const myApproval = loan.approvals[currentUser.user_id]
  const canVote = loan.status === 'Pending Board Approval' && myApproval?.status === 'Pending'
  const canRelease = currentUser.is_administrator && loan.status === 'Approved'
  const canRecordPayment = currentUser.is_administrator && loan.status === 'Active'

  return (
    <div>
      <h1>Loan {loan.loan_id}</h1>
      <p>Status: {loan.status}</p>
      <p>Requested amount: {loan.requested_amount}</p>
      <p>Approved amount: {loan.approved_amount ?? 'Not yet approved'}</p>
      <p>Repayment interval (days): {loan.repayment_interval_days}</p>
      <p>Interest rate: {loan.interest_rate}</p>
      <p>Application date: {loan.application_date}</p>
      {loan.is_exception_case && <p>Exception case: requested amount exceeds the member&apos;s capital.</p>}
      {loan.remarks && <p>Remarks: {loan.remarks}</p>}
      {(loan.status === 'Active' || loan.status === 'Completed') && (
        <div>
          <h2>Release details</h2>
          <p>Release date: {loan.release_date}</p>
          <p>Interest deduction: {loan.interest_deduction}</p>
          <p>Net release amount: {loan.net_release_amount}</p>
          <p>Remaining balance: {loan.remaining_balance}</p>
          <p>Next due date: {loan.next_due_date}</p>
        </div>
      )}

      <h2>Approvals</h2>
      <table>
        <thead>
          <tr>
            <th>Board member</th>
            <th>Status</th>
            <th>Date</th>
            <th>Comments</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(loan.approvals).map(([userId, entry]) => (
            <tr key={userId}>
              <td>{entry.email}</td>
              <td>{entry.status}</td>
              <td>{entry.date ?? '-'}</td>
              <td>{entry.comments ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {canVote && (
        <div>
          <h2>Cast your vote</h2>
          <label htmlFor="comments">Comments</label>
          <input id="comments" value={comments} onChange={(e) => setComments(e.target.value)} />
          {voteError && <p role="alert">{voteError}</p>}
          <button type="button" onClick={() => handleVote('Approved')}>Approve</button>
          <button type="button" onClick={() => handleVote('Rejected')}>Reject</button>
        </div>
      )}

      {canRelease && (
        <form onSubmit={handleRelease}>
          <h2>Release this loan</h2>
          <label htmlFor="release-date">Release date</label>
          <input
            id="release-date"
            type="date"
            value={releaseDate}
            onChange={(e) => setReleaseDate(e.target.value)}
          />
          {releaseError && <p role="alert">{releaseError}</p>}
          <button type="submit">Release loan</button>
        </form>
      )}

      {canRecordPayment && (
        <form onSubmit={handleRecordPayment}>
          <h2>Record a payment</h2>
          <label htmlFor="payment-amount">Amount</label>
          <input
            id="payment-amount"
            type="number"
            value={paymentAmount}
            onChange={(e) => setPaymentAmount(e.target.value)}
            required
          />
          <label htmlFor="payment-date">Payment date</label>
          <input
            id="payment-date"
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
          />
          <label htmlFor="payment-notes">Notes</label>
          <input id="payment-notes" value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} />
          {paymentError && <p role="alert">{paymentError}</p>}
          <button type="submit">Record payment</button>
        </form>
      )}

      <h2>Transaction history</h2>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Amount</th>
            <th>Balance after</th>
            <th>Date</th>
            <th>Recorded by</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => (
            <tr key={transaction.transaction_id}>
              <td>{transaction.type}</td>
              <td>{transaction.amount}</td>
              <td>{transaction.remaining_balance_after}</td>
              <td>{transaction.timestamp}</td>
              <td>{transaction.recorded_by ?? '-'}</td>
              <td>{transaction.notes ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
