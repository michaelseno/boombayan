# Plan 6b: Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Reports page with four tabbed report views (Portfolio Snapshot, Cycle Report, Member Statement, Loan Ledger) computed entirely from existing APIs, with disabled download buttons as placeholders.

**Architecture:** One new `ReportsPage.tsx` handles all four tabs with lazy data fetching — members + loans on mount, cycles on first Cycles/Members tab visit, dividends per-cycle on demand cached in component state. AppShell's disabled Reports stub becomes a real NavLink. No backend changes.

**Tech Stack:** React 18, React Router v6, TypeScript, Tailwind CSS v3, Vitest + React Testing Library

## Global Constraints

- No backend changes — all data from existing endpoints
- No download implementation — both buttons render with `disabled` and `aria-disabled="true"` and `opacity-50 cursor-not-allowed`
- All existing 72 tests must remain green
- Target test count after plan: **80 tests** (+8)
- Branch: `feature/plan-6b-reporting`
- Working directory: `frontend/`
- Follow existing Plan 6a Tailwind design system exactly (card panels, tables, inputs, badges, skeletons)
- All types imported from `../api/types` — do not redeclare locally
- `useAuth()` from `../auth/AuthContext`, `apiFetch` from `../api/client`
- `useCurrentUser()` from `../auth/CurrentUserContext` (available if needed for role gating — reports are visible to all authenticated users)

---

### Task 1: Branch + AppShell activation + routing + ReportsPage tab scaffold

**Files:**
- Modify: `frontend/src/components/AppShell.tsx`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/pages/ReportsPage.tsx`
- Create: `frontend/src/pages/ReportsPage.test.tsx`

**Interfaces:**
- Produces: `ReportsPage` component exported from `src/pages/ReportsPage.tsx`; `/reports` route navigable in the app; Reports NavLink active in sidebar

- [ ] **Step 1: Create branch**

```bash
git checkout -b feature/plan-6b-reporting
```

Expected: Switched to a new branch 'feature/plan-6b-reporting'

- [ ] **Step 2: Write failing tests — `src/pages/ReportsPage.test.tsx`**

```tsx
import { fireEvent, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useCurrentUser } from '../auth/CurrentUserContext'
import { renderWithUser } from '../test-utils/renderWithUser'
import { ReportsPage } from './ReportsPage'

vi.mock('../api/client', () => ({ apiFetch: vi.fn() }))
vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../auth/CurrentUserContext', () => ({ useCurrentUser: vi.fn() }))

function setup() {
  vi.mocked(useAuth).mockReturnValue({ idToken: 'tok', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
  vi.mocked(useCurrentUser).mockReturnValue({
    currentUser: { user_id: 'admin-1', email: 'admin@boombayan.org', is_administrator: true, member_id: null },
    loading: false,
    error: null,
  })
  vi.mocked(apiFetch).mockResolvedValue([])
}

describe('ReportsPage', () => {
  it('renders all four tab labels', () => {
    setup()
    renderWithUser(<MemoryRouter><ReportsPage /></MemoryRouter>)
    expect(screen.getByRole('tab', { name: 'Portfolio' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Cycles' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Members' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Loans' })).toBeInTheDocument()
  })

  it('switches active tab when a tab is clicked', () => {
    setup()
    renderWithUser(<MemoryRouter><ReportsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Loans' }))
    expect(screen.getByRole('tab', { name: 'Loans' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Portfolio' })).toHaveAttribute('aria-selected', 'false')
  })

  it('renders disabled download buttons on every tab', () => {
    setup()
    renderWithUser(<MemoryRouter><ReportsPage /></MemoryRouter>)
    const pdfBtn = screen.getByRole('button', { name: 'Download PDF' })
    const csvBtn = screen.getByRole('button', { name: 'Download CSV' })
    expect(pdfBtn).toBeDisabled()
    expect(csvBtn).toBeDisabled()
    expect(pdfBtn).toHaveAttribute('aria-disabled', 'true')
    expect(csvBtn).toHaveAttribute('aria-disabled', 'true')
  })
})
```

- [ ] **Step 3: Run tests — verify 3 new tests fail**

```bash
npm test -- ReportsPage
```

Expected: FAIL — `Cannot find module './ReportsPage'`

- [ ] **Step 4: Create `src/pages/ReportsPage.tsx` — tab scaffold only**

```tsx
import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'

type TabId = 'portfolio' | 'cycles' | 'members' | 'loans'

const TABS: { id: TabId; label: string }[] = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'cycles', label: 'Cycles' },
  { id: 'members', label: 'Members' },
  { id: 'loans', label: 'Loans' },
]

const disabledBtnClass =
  'opacity-50 cursor-not-allowed bg-white/[0.08] border border-white/10 text-slate-400 px-4 py-2 rounded-lg text-sm'

export function ReportsPage() {
  const { idToken: _idToken } = useAuth()
  const [activeTab, setActiveTab] = useState<TabId>('portfolio')

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

      {/* Tab panels — placeholder content */}
      <div className="min-h-[200px]">
        {activeTab === 'portfolio' && <div>Portfolio content coming soon</div>}
        {activeTab === 'cycles' && <div>Cycles content coming soon</div>}
        {activeTab === 'members' && <div>Members content coming soon</div>}
        {activeTab === 'loans' && <div>Loans content coming soon</div>}
      </div>

      {/* Download buttons — disabled placeholders */}
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
```

- [ ] **Step 5: Activate Reports NavLink in `src/components/AppShell.tsx`**

Replace the disabled Reports stub:

```tsx
// Remove this block:
{/* Reports — stubbed, activated in Plan 6b */}
<div
  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 cursor-not-allowed"
  title="Coming soon"
>
  <BarChart2 className="w-4 h-4 shrink-0" />
  Reports
</div>

// Replace with:
<NavLink to="/reports" className={navLinkClass}>
  <BarChart2 className="w-4 h-4 shrink-0" />
  Reports
</NavLink>
```

- [ ] **Step 6: Add `/reports` route in `src/App.tsx`**

Add the import and route. Add import alongside other page imports:

```tsx
import { ReportsPage } from './pages/ReportsPage'
```

Add route inside the layout route, after `/settings`:

```tsx
<Route path="/settings" element={<SettingsPage />} />
<Route path="/reports" element={<ReportsPage />} />
```

- [ ] **Step 7: Run ReportsPage tests — verify 3 pass**

```bash
npm test -- ReportsPage
```

Expected: 3 PASS

- [ ] **Step 8: Run full test suite — verify 75 tests pass**

```bash
npm test -- --run
```

Expected: 75 passed (72 existing + 3 new)

- [ ] **Step 9: Commit**

```bash
git add src/pages/ReportsPage.tsx src/pages/ReportsPage.test.tsx src/components/AppShell.tsx src/App.tsx
git commit -m "feat: add ReportsPage tab scaffold, activate Reports nav link, add /reports route"
```

---

### Task 2: Full ReportsPage implementation — all 4 tabs

**Files:**
- Modify: `frontend/src/pages/ReportsPage.tsx`
- Modify: `frontend/src/pages/ReportsPage.test.tsx`

**Interfaces:**
- Consumes: `Member`, `Loan`, `Cycle`, `Dividend`, `LoanStatus` from `../api/types`; `apiFetch` from `../api/client`; `useAuth` from `../auth/AuthContext`
- Produces: complete ReportsPage with Portfolio, Cycle Report, Member Statement, and Loan Ledger tabs rendering live data

- [ ] **Step 1: Add 5 more tests to `src/pages/ReportsPage.test.tsx`**

Add these test cases inside the existing `describe('ReportsPage', ...)` block, after the 3 existing tests:

```tsx
it('Portfolio tab shows summary card labels and member capital table', async () => {
  setup()
  vi.mocked(apiFetch).mockImplementation((path: string) => {
    if (path === '/members') return Promise.resolve([
      { member_id: 'm1', first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com', phone: '', date_joined: '2026-01-01', status: 'Active', current_shares: 10, current_capital_amount: 5000, share_history: [] },
    ])
    if (path === '/loans') return Promise.resolve([])
    return Promise.resolve([])
  })
  renderWithUser(<MemoryRouter><ReportsPage /></MemoryRouter>)
  expect(await screen.findByText('Total Capital')).toBeInTheDocument()
  expect(screen.getByText('Deployed Capital')).toBeInTheDocument()
  expect(screen.getByText('Available to Lend')).toBeInTheDocument()
  expect(screen.getByText('Active Loans')).toBeInTheDocument()
  expect(screen.getByText('Ana Reyes')).toBeInTheDocument()
})

it('Loan Ledger tab shows overdue badge for past-due active loans', async () => {
  setup()
  vi.mocked(apiFetch).mockImplementation((path: string) => {
    if (path === '/members') return Promise.resolve([
      { member_id: 'm1', first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com', phone: '', date_joined: '2026-01-01', status: 'Active', current_shares: 10, current_capital_amount: 5000, share_history: [] },
    ])
    if (path === '/loans') return Promise.resolve([
      { loan_id: 'l1', member_id: 'm1', requested_amount: 1000, approved_amount: 1000, repayment_interval_days: 30, interest_rate: 0.05, application_date: '2026-01-01', remarks: null, status: 'Active', is_exception_case: false, release_date: '2026-01-15', interest_deduction: 50, net_release_amount: 950, remaining_balance: 800, next_due_date: '2025-01-01', penalty_charged_for_current_cycle: false, cycle_id: null, approvals: {} },
    ])
    return Promise.resolve([])
  })
  renderWithUser(<MemoryRouter><ReportsPage /></MemoryRouter>)
  fireEvent.click(screen.getByRole('tab', { name: 'Loans' }))
  expect(await screen.findByText('Overdue')).toBeInTheDocument()
})

it('Loan Ledger tab filters loans by status', async () => {
  setup()
  vi.mocked(apiFetch).mockImplementation((path: string) => {
    if (path === '/members') return Promise.resolve([
      { member_id: 'm1', first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com', phone: '', date_joined: '2026-01-01', status: 'Active', current_shares: 10, current_capital_amount: 5000, share_history: [] },
    ])
    if (path === '/loans') return Promise.resolve([
      { loan_id: 'l1', member_id: 'm1', requested_amount: 1000, approved_amount: 1000, repayment_interval_days: 30, interest_rate: 0.05, application_date: '2026-01-01', remarks: null, status: 'Active', is_exception_case: false, release_date: '2026-01-15', interest_deduction: 50, net_release_amount: 950, remaining_balance: 800, next_due_date: '2026-12-01', penalty_charged_for_current_cycle: false, cycle_id: null, approvals: {} },
      { loan_id: 'l2', member_id: 'm1', requested_amount: 500, approved_amount: null, repayment_interval_days: 30, interest_rate: 0.05, application_date: '2026-02-01', remarks: null, status: 'Pending Board Approval', is_exception_case: false, release_date: null, interest_deduction: null, net_release_amount: null, remaining_balance: null, next_due_date: null, penalty_charged_for_current_cycle: false, cycle_id: null, approvals: {} },
    ])
    return Promise.resolve([])
  })
  renderWithUser(<MemoryRouter><ReportsPage /></MemoryRouter>)
  fireEvent.click(screen.getByRole('tab', { name: 'Loans' }))
  await screen.findByText('Ana Reyes')
  // Both loans visible initially
  expect(screen.getAllByText('Ana Reyes')).toHaveLength(2)
  // Filter to Active only
  fireEvent.change(screen.getByRole('combobox', { name: /status/i }), { target: { value: 'Active' } })
  expect(screen.getAllByText('Ana Reyes')).toHaveLength(1)
})

it('Cycles tab shows cycle selector after loading', async () => {
  setup()
  vi.mocked(apiFetch).mockImplementation((path: string) => {
    if (path === '/members') return Promise.resolve([])
    if (path === '/loans') return Promise.resolve([])
    if (path === '/cycles') return Promise.resolve([
      { cycle_id: 'c1', start_date: '2026-01-01', end_date: '2026-06-01', status: 'Closed', total_interest_earned: 500, total_penalties_collected: 100, top3_bonus_percentage: 0.1, top3_bonus_pool: 60, remaining_profit: 540, total_shares_at_close: 100, closed_at: '2026-06-01' },
    ])
    if (path === '/cycles/c1/dividends') return Promise.resolve([])
    return Promise.resolve([])
  })
  renderWithUser(<MemoryRouter><ReportsPage /></MemoryRouter>)
  fireEvent.click(screen.getByRole('tab', { name: 'Cycles' }))
  expect(await screen.findByRole('combobox', { name: /cycle/i })).toBeInTheDocument()
})

it('Members tab shows member selector after loading', async () => {
  setup()
  vi.mocked(apiFetch).mockImplementation((path: string) => {
    if (path === '/members') return Promise.resolve([
      { member_id: 'm1', first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com', phone: '', date_joined: '2026-01-01', status: 'Active', current_shares: 10, current_capital_amount: 5000, share_history: [] },
    ])
    if (path === '/loans') return Promise.resolve([])
    if (path === '/cycles') return Promise.resolve([])
    return Promise.resolve([])
  })
  renderWithUser(<MemoryRouter><ReportsPage /></MemoryRouter>)
  fireEvent.click(screen.getByRole('tab', { name: 'Members' }))
  expect(await screen.findByRole('combobox', { name: /member/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests — verify 5 new tests fail**

```bash
npm test -- ReportsPage
```

Expected: 3 old tests PASS, 5 new tests FAIL (tab content not yet implemented)

- [ ] **Step 3: Implement full `src/pages/ReportsPage.tsx`**

Replace the entire file with:

```tsx
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
```

- [ ] **Step 4: Run ReportsPage tests — verify all 8 pass**

```bash
npm test -- ReportsPage
```

Expected: 8 PASS

- [ ] **Step 5: Run full test suite — verify 80 tests pass**

```bash
npm test -- --run
```

Expected: 80 passed (72 existing + 8 new)

- [ ] **Step 6: Commit**

```bash
git add src/pages/ReportsPage.tsx src/pages/ReportsPage.test.tsx
git commit -m "feat: implement Reports page — Portfolio, Cycle Report, Member Statement, Loan Ledger tabs"
```
