import { useEffect, useState } from 'react'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Cycle, Dividend, Loan, LoanStatus, Member } from '../api/types'

type TabId = 'portfolio' | 'cycles' | 'members' | 'loans'

const TABS: { id: TabId; label: string }[] = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'cycles', label: 'Cycles' },
  { id: 'members', label: 'Members' },
  { id: 'loans', label: 'Loans' },
]

const STATUS_OPTIONS: Array<LoanStatus | 'All'> = [
  'All',
  'Active',
  'Pending Board Approval',
  'Approved',
  'Completed',
  'Rejected',
]

const disabledBtnClass =
  'opacity-50 cursor-not-allowed bg-white/[0.08] border border-white/10 text-slate-400 px-4 py-2 rounded-lg text-sm'

const cardClass = 'bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-4'

const tableWrapClass = 'overflow-x-auto rounded-xl border border-white/[0.08]'
const thClass = 'px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider border-b border-white/[0.08]'
const tdClass = 'px-4 py-3 text-slate-300'
const trClass = 'border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors duration-150'

const inputClass =
  'bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-colors duration-150'

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={cardClass}>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-amber-400">{value}</p>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="motion-safe:animate-pulse space-y-3">
      <div className="h-6 bg-white/10 rounded w-1/4" />
      <div className="h-40 bg-white/10 rounded-xl" />
    </div>
  )
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function ReportsPage() {
  const { idToken } = useAuth()
  const [activeTab, setActiveTab] = useState<TabId>('portfolio')

  // Shared data (members + loans) — loaded on mount
  const [members, setMembers] = useState<Member[] | null>(null)
  const [loans, setLoans] = useState<Loan[] | null>(null)
  const [baseError, setBaseError] = useState<string | null>(null)

  // Cycles tab state
  const [cycles, setCycles] = useState<Cycle[] | null>(null)
  const [selectedCycleId, setSelectedCycleId] = useState<string>('')
  const [dividendCache, setDividendCache] = useState<Record<string, Dividend[]>>({})
  const [cycleError, setCycleError] = useState<string | null>(null)

  // Member statement state
  const [selectedMemberId, setSelectedMemberId] = useState<string>('')

  // Loan ledger state
  const [loanStatusFilter, setLoanStatusFilter] = useState<LoanStatus | 'All'>('All')

  // Fetch members + loans on mount
  useEffect(() => {
    if (!idToken) return
    let cancelled = false
    Promise.all([
      apiFetch<Member[]>('/members', idToken),
      apiFetch<Loan[]>('/loans', idToken),
    ])
      .then(([m, l]) => {
        if (!cancelled) {
          setMembers(m)
          setLoans(l)
        }
      })
      .catch(() => {
        if (!cancelled) setBaseError('Could not load report data.')
      })
    return () => { cancelled = true }
  }, [idToken])

  // Fetch cycles when Cycles or Members tab first visited
  useEffect(() => {
    if (!idToken || cycles !== null) return
    if (activeTab !== 'cycles' && activeTab !== 'members') return
    let cancelled = false
    apiFetch<Cycle[]>('/cycles', idToken)
      .then((data) => {
        if (!cancelled) {
          setCycles(data)
          const first = data.find((c) => c.status === 'Closed') ?? data[0]
          if (first) setSelectedCycleId(first.cycle_id)
        }
      })
      .catch(() => { if (!cancelled) setCycleError('Could not load cycles.') })
    return () => { cancelled = true }
  }, [idToken, activeTab, cycles])

  // Fetch dividends for selected cycle (cached)
  useEffect(() => {
    if (!idToken || !selectedCycleId || dividendCache[selectedCycleId]) return
    let cancelled = false
    apiFetch<Dividend[]>(`/cycles/${selectedCycleId}/dividends`, idToken)
      .then((data) => {
        if (!cancelled) setDividendCache((prev) => ({ ...prev, [selectedCycleId]: data }))
      })
      .catch(() => { if (!cancelled) setCycleError('Could not load dividends.') })
    return () => { cancelled = true }
  }, [idToken, selectedCycleId, dividendCache])

  // Fetch dividends for all closed cycles when Members tab visited (for member statement)
  useEffect(() => {
    if (!idToken || activeTab !== 'members' || !cycles) return
    const closed = cycles.filter((c) => c.status === 'Closed')
    closed.forEach((c) => {
      if (dividendCache[c.cycle_id]) return
      apiFetch<Dividend[]>(`/cycles/${c.cycle_id}/dividends`, idToken)
        .then((data) => setDividendCache((prev) => ({ ...prev, [c.cycle_id]: data })))
        .catch(() => {})
    })
  }, [idToken, activeTab, cycles, dividendCache])

  // ── Portfolio Snapshot ────────────────────────────────────────────────────
  function renderPortfolio() {
    if (baseError) return <ErrorAlert message={baseError} />
    if (!members || !loans) return <Skeleton />

    const totalCapital = members.reduce((s, m) => s + m.current_capital_amount, 0)
    const deployedCapital = loans
      .filter((l) => l.status === 'Active')
      .reduce((s, l) => s + (l.remaining_balance ?? 0), 0)
    const availableToLend = totalCapital - deployedCapital
    const activeLoanCount = loans.filter((l) => l.status === 'Active').length
    const sorted = [...members].sort((a, b) => b.current_capital_amount - a.current_capital_amount)

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryCard label="Total Capital" value={fmt(totalCapital)} />
          <SummaryCard label="Deployed Capital" value={fmt(deployedCapital)} />
          <SummaryCard label="Available to Lend" value={fmt(availableToLend)} />
          <SummaryCard label="Active Loans" value={String(activeLoanCount)} />
        </div>

        <div className={tableWrapClass}>
          <table className="w-full text-sm border-collapse">
            <thead className="bg-white/[0.05]">
              <tr>
                <th className={thClass}>Name</th>
                <th className={thClass}>Shares</th>
                <th className={thClass}>Capital Amount</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => (
                <tr key={m.member_id} className={trClass}>
                  <td className={tdClass}>{m.first_name} {m.last_name}</td>
                  <td className={tdClass}>{m.current_shares}</td>
                  <td className={tdClass}>{fmt(m.current_capital_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── Cycle Report ──────────────────────────────────────────────────────────
  function renderCycles() {
    if (cycleError) return <ErrorAlert message={cycleError} />
    if (!cycles) return <Skeleton />

    const memberMap = Object.fromEntries((members ?? []).map((m) => [m.member_id, `${m.first_name} ${m.last_name}`]))
    const selectedCycle = cycles.find((c) => c.cycle_id === selectedCycleId)
    const dividends = dividendCache[selectedCycleId] ?? []
    const sortedDivs = [...dividends].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))

    return (
      <div className="space-y-6">
        <div>
          <label htmlFor="cycle-select" className="block text-xs font-medium text-slate-400 mb-1">
            Cycle
          </label>
          <select
            id="cycle-select"
            aria-label="Cycle"
            value={selectedCycleId}
            onChange={(e) => setSelectedCycleId(e.target.value)}
            className={inputClass}
          >
            {cycles.map((c) => (
              <option key={c.cycle_id} value={c.cycle_id}>
                {c.start_date} — {c.end_date ?? 'Open'}
              </option>
            ))}
          </select>
        </div>

        {selectedCycle && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <SummaryCard label="Interest Earned" value={fmt(selectedCycle.total_interest_earned)} />
              <SummaryCard label="Penalties Collected" value={fmt(selectedCycle.total_penalties_collected)} />
              <SummaryCard label="Profit" value={fmt(selectedCycle.remaining_profit)} />
              <SummaryCard label="Bonus Pool" value={fmt(selectedCycle.top3_bonus_pool)} />
              <SummaryCard label="Close Date" value={selectedCycle.end_date ?? '—'} />
            </div>

            <div className={tableWrapClass}>
              <table className="w-full text-sm border-collapse">
                <thead className="bg-white/[0.05]">
                  <tr>
                    <th className={thClass}>Rank</th>
                    <th className={thClass}>Member</th>
                    <th className={thClass}>Shares</th>
                    <th className={thClass}>Share Dividend</th>
                    <th className={thClass}>Bonus</th>
                    <th className={thClass}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDivs.map((d) => (
                    <tr key={d.member_id} className={trClass}>
                      <td className={tdClass}>
                        {d.rank != null ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${d.rank === 1 ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-500/20 text-slate-300'}`}>
                            #{d.rank}
                          </span>
                        ) : '—'}
                      </td>
                      <td className={tdClass}>{memberMap[d.member_id] ?? d.member_id}</td>
                      <td className={tdClass}>{d.shares_at_calculation}</td>
                      <td className={tdClass}>{fmt(d.share_based_amount)}</td>
                      <td className={tdClass}>{fmt(d.top3_bonus_amount)}</td>
                      <td className={tdClass}>{fmt(d.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    )
  }

  // ── Member Statement ──────────────────────────────────────────────────────
  function renderMembers() {
    if (baseError) return <ErrorAlert message={baseError} />
    if (!members || !loans) return <Skeleton />

    const sorted = [...members].sort((a, b) => a.last_name.localeCompare(b.last_name))
    const selected = members.find((m) => m.member_id === selectedMemberId)
    const memberLoans = loans.filter((l) => l.member_id === selectedMemberId)
      .sort((a, b) => b.application_date.localeCompare(a.application_date))

    const closedCycles = cycles?.filter((c) => c.status === 'Closed') ?? []
    const memberDividends = closedCycles
      .flatMap((c) => (dividendCache[c.cycle_id] ?? []).filter((d) => d.member_id === selectedMemberId).map((d) => ({ ...d, cycle: c })))
      .sort((a, b) => b.cycle.start_date.localeCompare(a.cycle.start_date))

    return (
      <div className="space-y-6">
        <div>
          <label htmlFor="member-select" className="block text-xs font-medium text-slate-400 mb-1">
            Member
          </label>
          <select
            id="member-select"
            aria-label="Member"
            value={selectedMemberId}
            onChange={(e) => setSelectedMemberId(e.target.value)}
            className={inputClass}
          >
            <option value="">Select a member</option>
            {sorted.map((m) => (
              <option key={m.member_id} value={m.member_id}>
                {m.last_name}, {m.first_name}
              </option>
            ))}
          </select>
        </div>

        {selected && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <SummaryCard label="Full Name" value={`${selected.first_name} ${selected.last_name}`} />
              <SummaryCard label="Email" value={selected.email} />
              <SummaryCard label="Status" value={selected.status} />
              <SummaryCard label="Shares" value={String(selected.current_shares)} />
              <SummaryCard label="Capital" value={fmt(selected.current_capital_amount)} />
            </div>

            <div>
              <h2 className="text-base font-semibold text-slate-300 mb-3">Loan history</h2>
              <div className={tableWrapClass}>
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-white/[0.05]">
                    <tr>
                      <th className={thClass}>Date Applied</th>
                      <th className={thClass}>Amount</th>
                      <th className={thClass}>Status</th>
                      <th className={thClass}>Remaining Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memberLoans.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500 text-sm">No loans</td></tr>
                    ) : memberLoans.map((l) => (
                      <tr key={l.loan_id} className={trClass}>
                        <td className={tdClass}>{l.application_date}</td>
                        <td className={tdClass}>{fmt(l.requested_amount)}</td>
                        <td className={tdClass}>{l.status}</td>
                        <td className={tdClass}>{l.remaining_balance != null ? fmt(l.remaining_balance) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h2 className="text-base font-semibold text-slate-300 mb-3">Dividend history</h2>
              <div className={tableWrapClass}>
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-white/[0.05]">
                    <tr>
                      <th className={thClass}>Cycle</th>
                      <th className={thClass}>Shares</th>
                      <th className={thClass}>Share Dividend</th>
                      <th className={thClass}>Bonus</th>
                      <th className={thClass}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memberDividends.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500 text-sm">No dividends</td></tr>
                    ) : memberDividends.map((d) => (
                      <tr key={d.cycle.cycle_id} className={trClass}>
                        <td className={tdClass}>{d.cycle.start_date}</td>
                        <td className={tdClass}>{d.shares_at_calculation}</td>
                        <td className={tdClass}>{fmt(d.share_based_amount)}</td>
                        <td className={tdClass}>{fmt(d.top3_bonus_amount)}</td>
                        <td className={tdClass}>{fmt(d.total_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  // ── Loan Ledger ───────────────────────────────────────────────────────────
  function renderLoans() {
    if (baseError) return <ErrorAlert message={baseError} />
    if (!members || !loans) return <Skeleton />

    const today = new Date().toISOString().split('T')[0]
    const memberMap = Object.fromEntries(members.map((m) => [m.member_id, `${m.first_name} ${m.last_name}`]))
    const filtered = loans
      .filter((l) => loanStatusFilter === 'All' || l.status === loanStatusFilter)
      .sort((a, b) => b.application_date.localeCompare(a.application_date))

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <label htmlFor="status-filter" className="text-xs font-medium text-slate-400">
            Status
          </label>
          <select
            id="status-filter"
            aria-label="Status"
            value={loanStatusFilter}
            onChange={(e) => setLoanStatusFilter(e.target.value as LoanStatus | 'All')}
            className={inputClass}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className={tableWrapClass}>
          <table className="w-full text-sm border-collapse">
            <thead className="bg-white/[0.05]">
              <tr>
                <th className={thClass}>Member</th>
                <th className={thClass}>Amount</th>
                <th className={thClass}>Remaining</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>Next Due</th>
                <th className={thClass}>Overdue</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const isOverdue = l.status === 'Active' && l.next_due_date != null && l.next_due_date < today
                return (
                  <tr key={l.loan_id} className={trClass}>
                    <td className={tdClass}>{memberMap[l.member_id] ?? l.member_id}</td>
                    <td className={tdClass}>{fmt(l.requested_amount)}</td>
                    <td className={tdClass}>{l.remaining_balance != null ? fmt(l.remaining_balance) : '—'}</td>
                    <td className={tdClass}>{l.status}</td>
                    <td className={tdClass}>{l.next_due_date ?? '—'}</td>
                    <td className={tdClass}>
                      {isOverdue && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-300">
                          Overdue
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-50 mb-6">Reports</h1>

      {/* Tab bar */}
      <div role="tablist" className="flex gap-1 border-b border-white/[0.08] mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors duration-150 border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div className="min-h-[200px]">
        {activeTab === 'portfolio' && renderPortfolio()}
        {activeTab === 'cycles' && renderCycles()}
        {activeTab === 'members' && renderMembers()}
        {activeTab === 'loans' && renderLoans()}
      </div>

      {/* Disabled download buttons */}
      <div className="flex gap-3 mt-8">
        <button disabled aria-disabled="true" className={disabledBtnClass}>
          Download PDF
        </button>
        <button disabled aria-disabled="true" className={disabledBtnClass}>
          Download CSV
        </button>
      </div>
    </div>
  )
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <p role="alert" className="bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm">
      {message}
    </p>
  )
}
