# Plan 6b: Reporting Design

Status: Approved
Scope: Frontend-only reporting module — a dedicated Reports page with four tabbed report views, all computed from existing APIs. No new backend endpoints. No download implementation (buttons present but disabled).

---

## 1. Purpose

Provide the board with a single Reports page giving visibility into four key views: overall fund health (Portfolio Snapshot), per-cycle financials (Cycle Report), per-member history (Member Statement), and the full loan book (Loan Ledger). All data is derived from existing APIs.

---

## 2. Architecture

**What changes:**

- `src/pages/ReportsPage.tsx` — new page with four lazy-loaded tabs
- `src/pages/ReportsPage.test.tsx` — ~8 tests
- `src/App.tsx` — add `/reports` route inside the existing layout route
- `src/components/AppShell.tsx` — activate the Reports nav stub (replace disabled `<div>` with a real `<NavLink to="/reports">`)

**What does not change:**

- No backend files touched
- No new API endpoints
- All existing tests remain green
- Download functionality not implemented — buttons render as `opacity-50 cursor-not-allowed` with `aria-disabled="true"`

**Data sources (all existing endpoints):**

| Report | APIs |
|---|---|
| Portfolio Snapshot | `GET /members`, `GET /loans` |
| Cycle Report | `GET /cycles`, `GET /cycles/:id/dividends` |
| Member Statement | `GET /members`, `GET /loans`, `GET /cycles` + `GET /cycles/:id/dividends` for each closed cycle |
| Loan Ledger | `GET /loans`, `GET /members` |

**Fetch strategy:** Lazy per tab — data is fetched when a tab is first selected, not all at once on page mount. Results are cached in component state so switching back to a visited tab does not re-fetch.

---

## 3. Page Layout

### 3.1 Tab Bar

Horizontal tab strip below the page heading. Tabs: Portfolio | Cycles | Members | Loans.

Active tab: `border-b-2 border-amber-500 text-amber-400 font-medium`
Inactive tab: `text-slate-400 hover:text-slate-200`

### 3.2 Download Buttons (all tabs)

Each tab panel footer has two disabled buttons:

```
[Download PDF]  [Download CSV]
```

Classes: `opacity-50 cursor-not-allowed bg-white/[0.08] border border-white/10 text-slate-400 px-4 py-2 rounded-lg text-sm`
Attributes: `disabled aria-disabled="true"`

---

## 4. Report Definitions

### 4.1 Portfolio Snapshot

**Data:** `GET /members` + `GET /loans`

**Computed values:**
- Total Capital = sum of all members' `current_capital_amount`
- Deployed Capital = sum of `remaining_balance` on loans where `status === 'Active'`
- Available to Lend = Total Capital − Deployed Capital
- Active Loan Count = count of loans where `status === 'Active'`

**Layout:**

```
[Total Capital]  [Deployed Capital]  [Available to Lend]  [Active Loans]
  summary cards (4 across, amber value text)

Member Capital Table
  Name | Shares | Capital Amount
  sorted by current_capital_amount descending
```

### 4.2 Cycle Report

**Data:** `GET /cycles` (for selector) + `GET /cycles/:id/dividends` (on cycle selection)

**Layout:**

```
Cycle: [dropdown — most recent selected by default]

Summary row (cards):
  Interest Earned | Penalties Collected | Profit | Bonus Pool | Close Date

Dividend Breakdown Table:
  Rank | Member | Shares | Share Dividend | Bonus | Total
  sorted by rank ascending (nulls last)
```

Member names resolved by cross-referencing `member_id` against the members list (fetched once for the page).

Open cycles show `—` for summary figures that are null (not yet computed).

### 4.3 Member Statement

**Data:** `GET /members` (for selector) + `GET /loans` (filtered by member) + dividends from all closed cycles

**Layout:**

```
Member: [dropdown — sorted by last name]

Info row: Full Name | Email | Status | Shares | Capital Amount

Loan History Table:
  Date Applied | Amount | Status | Remaining Balance
  sorted by application_date descending

Dividend History Table:
  Cycle | Shares at Calculation | Share Dividend | Bonus | Total
  only closed cycles where the member received a dividend
  sorted by cycle start_date descending
```

Dividend fetch strategy: fetch `GET /cycles` to get closed cycle IDs, then fetch `GET /cycles/:id/dividends` for each closed cycle and filter to the selected member. Results cached after first load.

### 4.4 Loan Ledger

**Data:** `GET /loans` + `GET /members`

**Layout:**

```
Status filter: [All | Pending Board Approval | Approved | Active | Completed | Rejected]  (default: All)

Loan Ledger Table:
  Member | Amount | Remaining Balance | Status | Next Due Date | Overdue
  sorted by application_date descending
```

Overdue logic: a loan is overdue when `status === 'Active'` AND `next_due_date` is before today's date. Overdue column shows a red badge `bg-red-500/20 text-red-300` with text "Overdue"; otherwise empty.

---

## 5. Visual Design

Follows the Plan 6a design system throughout:

- Page heading: `text-2xl font-bold text-slate-50 mb-6`
- Summary cards: `bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-4` with label `text-xs text-slate-500` and value `text-xl font-bold text-amber-400`
- Tables: standard Plan 6a table classes (`overflow-x-auto rounded-xl border border-white/[0.08]`, thead `bg-white/[0.05]`, etc.)
- Dropdowns / selects: Plan 6a input class
- Status badges: Plan 6a badge system
- Loading skeleton: `motion-safe:animate-pulse` with `bg-white/10` placeholder divs
- Error alert: `bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm`

---

## 6. AppShell Activation

Replace the current disabled Reports stub in `AppShell.tsx`:

```tsx
// Before (stub):
<div className="... cursor-not-allowed" title="Coming soon">
  <BarChart2 className="w-4 h-4 shrink-0" />
  Reports
</div>

// After (active NavLink):
<NavLink to="/reports" className={navLinkClass}>
  <BarChart2 className="w-4 h-4 shrink-0" />
  Reports
</NavLink>
```

---

## 7. Routing

Add to `App.tsx` inside the existing layout route:

```tsx
<Route path="/reports" element={<ReportsPage />} />
```

---

## 8. Testing

**File:** `src/pages/ReportsPage.test.tsx`

**Test count:** ~8 tests (current suite: 72 → target: ~80)

**Test cases:**

1. Portfolio tab renders on mount — shows 4 summary card labels (Total Capital, Deployed Capital, Available to Lend, Active Loans)
2. Portfolio tab — member capital table renders with member data
3. Cycles tab — switching to tab triggers cycle list fetch; shows cycle selector
4. Cycles tab — dividend table renders after cycle selected
5. Members tab — member selector renders with all members
6. Members tab — selecting a member shows their loan history and dividend history
7. Loan Ledger tab — table renders all loans; status filter shows only matching loans when changed
8. Download buttons — both buttons present with `aria-disabled="true"` and `disabled` on all tabs

**Mocking pattern:** `vi.mock('../auth/CurrentUserContext', ...)` + `renderWithUser` from `src/test-utils/renderWithUser.tsx` (established in Plan 6a).

---

## 9. Out of Scope (Plan 6b)

- PDF generation
- CSV export
- Email delivery of reports
- Date range filtering beyond cycle/status selectors
- Chart visualisations
- Printing stylesheet
