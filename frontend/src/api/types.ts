export type MemberStatus = 'Active' | 'Inactive' | 'Withdrawn'

export interface ShareHistoryEntry {
  cycle_id: string | null
  shares_purchased: number
  share_value_at_purchase: number
  amount_paid: number
  date: string
}

export interface Member {
  member_id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  date_joined: string
  status: MemberStatus
  current_shares: number
  current_capital_amount: number
  share_history: ShareHistoryEntry[]
}

export interface Config {
  share_value: number
  max_shares_per_member: number
  default_interest_rate: number
}

export type LoanStatus = 'Pending Board Approval' | 'Approved' | 'Active' | 'Rejected'
export type ApprovalVoteStatus = 'Pending' | 'Approved' | 'Rejected'

export interface ApprovalEntry {
  email: string
  status: ApprovalVoteStatus
  date: string | null
  comments: string | null
}

export interface Loan {
  loan_id: string
  member_id: string
  requested_amount: number
  approved_amount: number | null
  repayment_interval_days: number
  interest_rate: number
  application_date: string
  remarks: string | null
  status: LoanStatus
  is_exception_case: boolean
  release_date: string | null
  interest_deduction: number | null
  net_release_amount: number | null
  remaining_balance: number | null
  next_due_date: string | null
  approvals: Record<string, ApprovalEntry>
}
