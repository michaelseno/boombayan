# Plan 6a: UI Polish Design

Status: Draft for review
Scope: Frontend-only visual overhaul — Tailwind CSS installation, AppShell sidebar layout, and full page styling pass across all 11 authenticated pages. No backend changes. No new routes. No new features.

---

## 1. Purpose

Every page in the app is currently unstyled bare HTML — raw `<table>`, `<p>`, `<div>` blocks with no layout, no navigation bar, no visual hierarchy. This plan applies a consistent dark glassmorphism visual system and a persistent sidebar layout to make the app usable and presentable as an internal back-office tool.

---

## 2. Architecture

**What changes:**
- Tailwind CSS v3 added as a dev dependency.
- `CurrentUserContext` added — a React context that fetches `/me` once per session and shares the current user across all authenticated components. This replaces the per-page `/me` fetches that currently exist in `DashboardPage`, `LoanDetailPage`, `CycleDetailPage`, and `CyclesPage`.
- `AppShell` component added — wraps all authenticated pages with the fixed sidebar.
- `ProtectedRoute` updated to render `<AppShell><Outlet /></AppShell>`.
- All 11 pages updated with Tailwind classes. No logic changes to any page — only JSX structure and className additions.
- `LoginPage` is NOT wrapped in AppShell (it's outside `ProtectedRoute`).

**What does not change:**
- All API calls, state logic, routing, and test assertions remain identical.
- No new npm runtime dependencies (Tailwind is devDependency only).
- No backend files touched.

---

## 3. Tailwind Setup

**Install:**
```bash
npm install -D tailwindcss@3 postcss autoprefixer
npx tailwindcss init -p
```

**`tailwind.config.js`:**
```js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
```

**`src/index.css`** (replaces any existing content):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**`index.html`** — add Plus Jakarta Sans font link in `<head>`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
```

---

## 4. CurrentUserContext

**File:** `src/auth/CurrentUserContext.tsx`

**Interface:**
```typescript
interface CurrentUser {
  user_id: string
  email: string
  is_administrator: boolean
  member_id: string | null
}
```

**Provider behaviour:** Fetches `GET /me` once when `idToken` becomes available (via `useAuth()`). Stores `CurrentUser | null`. Exposes `useCurrentUser()` hook. On fetch error, stores `null` and lets pages handle their own error state.

**Placement:** `CurrentUserProvider` wraps the authenticated subtree inside `ProtectedRoute`, so it only activates after auth is confirmed and only fetches once per login session.

**Migration:** `DashboardPage`, `LoanDetailPage`, `CycleDetailPage`, and `CyclesPage` currently each fetch `/me` themselves via their own `useEffect`. They are updated to call `useCurrentUser()` instead, removing the duplicate fetches and the local `CurrentUser` interface definition from each page.

---

## 5. AppShell

**File:** `src/components/AppShell.tsx`

**Props:** `{ children: React.ReactNode }`  — reads current user from `useCurrentUser()` internally.

**Layout structure:**
```
+-- flex h-screen overflow-hidden bg-[#0F172A] --+
|                                                  |
| +-- sidebar w-64 flex-col bg-[#0F172A] --------+|
| | border-r border-white/10                       ||
| |                                                ||
| | [TOP] App name "Boombayan LMS"                 ||
| |   text-amber-400 font-bold text-lg px-6 py-5  ||
| |                                                ||
| | [MIDDLE] Nav links (flex-1 overflow-y-auto)    ||
| |   Members, Loans, Cycles, Reports (Plan 6b),   ||
| |   Settings (admin only)                        ||
| |   Active: bg-white/10 text-white rounded-lg    ||
| |   Inactive: text-slate-400 hover:text-white    ||
| |             hover:bg-white/5 rounded-lg        ||
| |                                                ||
| | [BOTTOM] User zone                             ||
| |   email: text-slate-500 text-xs truncate       ||
| |   "Log out" button: text-slate-400 hover:white ||
| +------------------------------------------------+|
|                                                  |
| +-- main flex-1 overflow-y-auto ----------------+|
| |   p-8 min-w-0                                  ||
| +------------------------------------------------+|
+--------------------------------------------------+
```

**Nav links:** Each link is a `<NavLink>` from react-router-dom. `NavLink`'s `className` prop receives `isActive` to apply the active style. Icons use Lucide React (added as a dependency: `npm install lucide-react`).

**Nav items (all authenticated users):**
- Members → `/members` (Users icon)
- Loans → `/loans` (CreditCard icon)
- Cycles → `/cycles` (RefreshCw icon)

**Nav items (admin only):**
- Settings → `/settings` (Settings icon)

**Reports** link is stubbed as a disabled item (`text-slate-600 cursor-not-allowed`) with a "Coming soon" tooltip — it is activated in Plan 6b.

**Log out:** calls `logout()` from `useAuth()`.

---

## 6. Visual Design System

### 6.1 Color Palette

| Role | Value | Tailwind |
|---|---|---|
| Page background | `#0F172A` | `bg-[#0F172A]` or `bg-slate-950` |
| Surface (cards, tables) | `rgba(255,255,255,0.05)` | `bg-white/5` |
| Surface elevated | `rgba(255,255,255,0.08)` | `bg-white/[0.08]` |
| Border | `rgba(255,255,255,0.08)` | `border-white/[0.08]` |
| Text primary | `#F8FAFC` | `text-slate-50` |
| Text secondary | `#94A3B8` | `text-slate-400` |
| Text muted (min contrast) | `#64748B` | `text-slate-500` |
| Accent primary (amber) | `#F59E0B` | `text-amber-400 / bg-amber-500` |
| Accent CTA (violet) | `#8B5CF6` | `bg-violet-600` |
| Destructive (red) | `#EF4444` | `bg-red-600` |

### 6.2 Typography

Font: Plus Jakarta Sans (Google Fonts, loaded in `index.html`).

| Element | Classes |
|---|---|
| Page title (h1) | `text-2xl font-bold text-slate-50 mb-6` |
| Section heading (h2) | `text-base font-semibold text-slate-300 mb-3 mt-6` |
| Body text | `text-sm text-slate-300` |
| Label | `block text-xs font-medium text-slate-400 mb-1` |
| Muted / metadata | `text-xs text-slate-500` |

### 6.3 Status Badges

Inline pill: `inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium`

| Status | Classes |
|---|---|
| Active / Open | `bg-green-500/20 text-green-300` |
| Completed / Closed | `bg-slate-500/20 text-slate-300` |
| Pending Board Approval | `bg-amber-500/20 text-amber-300` |
| Approved / Released | `bg-blue-500/20 text-blue-300` |
| Rejected | `bg-red-500/20 text-red-300` |

### 6.4 Cards / Panels

Wrapper for any grouped content block (table, form section, info grid):
```
bg-white/[0.03] backdrop-blur-sm border border-white/[0.08] rounded-xl p-6
```

### 6.5 Tables

```
overflow-x-auto rounded-xl border border-white/[0.08]

<table> → w-full text-sm border-collapse
<thead> → bg-white/[0.05]
<th>    → px-4 py-3 text-left text-xs font-medium text-slate-400
          uppercase tracking-wider border-b border-white/[0.08]
<tbody tr> → border-b border-white/[0.05] hover:bg-white/[0.03]
             transition-colors duration-150 cursor-pointer (on clickable rows)
<td>    → px-4 py-3 text-slate-300
```

### 6.6 Forms

```
<label>  → block text-xs font-medium text-slate-400 mb-1
<input>  → w-full bg-white/[0.05] border border-white/10 rounded-lg
           px-3 py-2 text-sm text-slate-100 placeholder-slate-600
           focus:outline-none focus:border-amber-500/50 focus:ring-1
           focus:ring-amber-500/50 transition-colors duration-150
<select> → same as input
```

### 6.7 Buttons

| Variant | Classes |
|---|---|
| Primary | `bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer` |
| CTA / destructive | `bg-violet-600 hover:bg-violet-500 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer` |
| Danger | `bg-red-600 hover:bg-red-500 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer` |
| Secondary | `bg-white/[0.08] hover:bg-white/[0.12] text-slate-300 border border-white/10 px-4 py-2 rounded-lg text-sm transition-colors duration-150 cursor-pointer` |
| Ghost / link | `text-amber-400 hover:text-amber-300 text-sm transition-colors duration-150` |

### 6.8 Alert / Feedback

```
Error:   bg-red-500/10 border border-red-500/20 text-red-300 rounded-lg px-4 py-3 text-sm
Success: bg-green-500/10 border border-green-500/20 text-green-300 rounded-lg px-4 py-3 text-sm
Info:    bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-lg px-4 py-3 text-sm
```

### 6.9 Loading state

Pages in "loading" state render a pulsing skeleton placeholder rather than plain text:
```
<div className="animate-pulse space-y-3">
  <div className="h-4 bg-white/10 rounded w-1/3" />
  <div className="h-4 bg-white/10 rounded w-1/2" />
</div>
```

### 6.10 Icons

Lucide React (`npm install lucide-react`). All icon-only interactive elements include `aria-label`. Icon size: `w-4 h-4` inline with text, `w-5 h-5` standalone. No emojis used as icons.

---

## 7. Page-by-Page Design Notes

### LoginPage

No AppShell. Full-screen centered layout on dark background.

```
bg-[#0F172A] min-h-screen flex items-center justify-center
  └─ card: bg-white/[0.03] border border-white/[0.08] rounded-2xl p-8 w-full max-w-sm
       ├─ App name "Boombayan LMS" — text-amber-400 font-bold text-2xl text-center mb-2
       ├─ subtitle — text-slate-500 text-sm text-center mb-8
       └─ form with email + password inputs + primary button
```

### DashboardPage

Simplified — navigation moved to sidebar. Shows a welcome greeting and role badge only. No nav links (those are now in AppShell).

```
<h1> Welcome, {email}
<p>  Role badge (Administrator / Board Member) using status badge styles
```

No quick-stats panel in Plan 6a (no new data fetching per YAGNI).

### MembersPage

Card wrapper → table with clickable rows (row links to `/members/:id`), "Add member" primary button top-right of header row.

Header row: `flex items-center justify-between mb-6`

### MemberDetailPage

Two-column info grid for core fields (left: labels, right: values) inside a card panel. Share history as a table below. "Purchase shares" form in a separate card panel.

### AddMemberPage

Single card panel with form fields in a `space-y-4` stack. Submit and Back buttons.

### LoansPage

Table with status badge column. "New loan application" primary button in header. Clickable rows.

### LoanDetailPage

Three card panels stacked:
1. **Loan details** — info grid with status badge
2. **Approval status** — table of board member votes + "Cast your vote" form (shown when canVote)
3. **Release / Payment actions** — shown conditionally (canRelease or canRecordPayment)
4. **Transaction history** — table with PAYMENT/PENALTY type badges (PAYMENT: blue, PENALTY: red)

### NewLoanPage

Single card panel with form. Member selector dropdown, amount and interval inputs, optional remarks.

### CyclesPage

Table of cycles with status badges. "Open a new cycle" form in a card panel — hidden when a cycle is already open.

### CycleDetailPage

Three sections:
1. **Cycle summary** — info grid with totals (shown as `—` while open)
2. **Close this cycle** (admin only, status=Open) — "Preview close" secondary button, preview results card with dividend table, then confirm form
3. **Dividends** — table with rank badges (🥇 rank 1, 🥈 rank 2, 🥉 rank 3 replaced with `#1`, `#2`, `#3` in amber/slate badge styles — no emoji)

### SettingsPage

Single card panel. Fields grouped into three visual sections separated by `<hr className="border-white/[0.08] my-6">`:
1. Share settings (share value, max shares)
2. Loan settings (default interest rate)
3. Penalty settings (penalty rate, grace period)
4. Top 3 ranking (bonus percentage, weight amount, weight count)

---

## 8. Accessibility

Per UI/UX Pro Max guidelines applied:
- All form `<input>` elements retain their existing `htmlFor`/`id` pairs.
- All icon-only interactive elements get `aria-label`.
- All tables retain `<thead>`/`<th>` structure.
- `overflow-x-auto` wrapper on every table (prevents horizontal scroll breakage).
- `cursor-pointer` on all clickable rows and cards.
- `transition-colors duration-150` or `duration-200` on all interactive elements.
- Skip-to-content link: `<a href="#main-content" className="sr-only focus:not-sr-only ...">Skip to content</a>` added at top of AppShell, `id="main-content"` on the `<main>` element.
- `prefers-reduced-motion`: Tailwind's `motion-safe:` prefix used on animation classes.

---

## 9. Testing

**Most tests unchanged.** All existing tests assert on text content, roles, and interactions — none assert on CSS class names.

**4 test files need updating** due to the `CurrentUserContext` migration. The following pages currently fetch `/me` themselves; after migration they call `useCurrentUser()` instead:

- `DashboardPage.test.tsx`
- `LoanDetailPage.test.tsx`
- `CycleDetailPage.test.tsx`
- `CyclesPage.test.tsx`

Each of these tests needs their `render()` call wrapped with a `MockCurrentUserProvider` that returns a pre-set user object — a one-line wrapper per test file. The mock `apiFetch` setup in these tests drops the `/me` mock entry (the context provider is bypassed in tests by the mock provider). Assertion logic is unchanged.

A shared test utility `src/test-utils/renderWithUser.tsx` is added:

```typescript
export function renderWithUser(ui: React.ReactElement, user = defaultAdminUser) {
  return render(
    <MockCurrentUserProvider user={user}>
      {ui}
    </MockCurrentUserProvider>
  )
}
```

All other 10 test files: no changes.

---

## 10. Out of Scope (Plan 6a)

- Mobile/responsive layout (desktop-only per Phase 1 scope)
- Reporting module (Plan 6b)
- Reports nav link (stubbed as disabled in AppShell, activated in Plan 6b)
- Dark/light mode toggle
- Animations beyond `transition-colors` micro-interactions
- Data visualisation / charts
- Skeleton loading on inner-page sections (only top-level page loading state)
