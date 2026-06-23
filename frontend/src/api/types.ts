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
  penalty_rate: number
  penalty_grace_period_hours: number
  top3_bonus_percentage: number
  top3_ranking_weight_amount: number
  top3_ranking_weight_count: number
}

export type LoanStatus = 'Pending Board Approval' | 'Approved' | 'Active' | 'Rejected' | 'Completed'
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
  penalty_charged_for_current_cycle: boolean
  cycle_id: string | null
  approvals: Record<string, ApprovalEntry>
}

export type TransactionType = 'PAYMENT' | 'PENALTY'

export interface Transaction {
  transaction_id: string
  loan_id: string
  timestamp: string
  type: TransactionType
  amount: number
  remaining_balance_after: number
  recorded_by: string | null
  notes: string | null
  cycle_id: string | null
}

export type CycleStatus = 'Open' | 'Closed'

export interface Cycle {
  cycle_id: string
  start_date: string
  end_date: string | null
  status: CycleStatus
  total_interest_earned: number | null
  total_penalties_collected: number | null
  top3_bonus_percentage: number | null
  top3_bonus_pool: number | null
  remaining_profit: number | null
  total_shares_at_close: number | null
  closed_at: string | null
}

export interface Dividend {
  cycle_id: string
  member_id: string
  share_based_amount: number
  top3_bonus_amount: number
  total_amount: number
  shares_at_calculation: number
  rank: number | null
}

export interface DividendBreakdown {
  member_id: string
  shares_at_calculation: number
  share_based_amount: number
  top3_bonus_amount: number
  total_amount: number
  rank: number | null
}

export interface CycleCloseResult {
  cycle_id: string
  total_interest_earned: number
  total_penalties_collected: number
  top3_bonus_percentage: number
  top3_bonus_pool: number
  remaining_profit: number
  total_shares_at_close: number
  dividends: DividendBreakdown[]
}
