# Plan 3: Loan Lifecycle — Design

Status: Approved for planning
Source: `docs/superpowers/specs/2026-06-19-boombayan-phase1-design.md` §4-5, refined through brainstorming
Scope: Loan application, board approval, and release. Payments, the penalty engine, `Completed` status, and Cycle/dividend processing are out of scope — see "Out of Scope" below.

## 1. Purpose

Plan 1 (Infra & Auth) and Plan 2 (Member & Share Management) are merged. This is Plan 3 of the multi-plan Phase 1 build: it takes a loan from application through board approval to release, producing an `Active` loan with a real outstanding balance. It does not yet let anyone pay that balance down — that's Plan 4.

## 2. Data Model

### Loans (new table)
- PK: `LoanId`
- No GSIs. At this app's scale (low hundreds of items, low request rate — same rationale Plan 2 applied to Members), `list_loans()` performs a table scan and filters in Python rather than provisioning `GSI1`/`GSI2` as the Phase 1 design doc sketches. Revisit only if scanning genuinely becomes a bottleneck.
- Attributes: `MemberId`, `RequestedAmount`, `ApprovedAmount` (null until `Approved`), `RepaymentIntervalDays`, `InterestRate` (snapshotted from `Config.DefaultInterestRate` at application time — later rate changes never affect this loan), `ApplicationDate`, `Remarks` (optional), `Status`, `IsExceptionCase`, `ReleaseDate` (null until release), `InterestDeduction`, `NetReleaseAmount`, `RemainingBalance`, `NextDueDate`.
- Embedded `Approvals`: map of `UserId -> {Status, Date, Comments}`. Populated at creation with every current User at `Pending` status — see §3.

### Status values (this plan)
`Pending Board Approval → Approved → Active`, plus `Rejected`.

- **`Draft` does not exist as a stored state.** Creating a loan application goes directly to `Pending Board Approval` — there is no separate "save as draft, edit later, submit" step, matching Plan 2's Add Member pattern (one form, one submit).
- **`Released` does not exist as a stored state, distinct from `Active`.** The Phase 1 design doc's lifecycle diagram lists them separately, but nothing observable happens between the moment release fields are computed and the loan being "active" until payments exist (Plan 4). The release action sets `Status = Active` directly; `ReleaseDate` being non-null is how a caller distinguishes "approved, not yet released" from "released."
- **`Completed` does not exist yet.** Reaching it requires tracking payments against `RemainingBalance`, which is Plan 4's job.

### Config (extended)
Adds `default_interest_rate: float` (e.g. `0.05` for 5%), alongside the existing `share_value` and `max_shares_per_member`. Editable from the existing Settings page. `DefaultInterestRate` is what every new loan's `InterestRate` snapshots at application time — changing it later never affects already-created loans.

## 3. Workflow Mechanics

**Eligibility:** only `Active` members can have a loan application created for them. (Assumption — the design doc doesn't state this explicitly, but an `Inactive`/`Withdrawn` member receiving a new loan contradicts the intent of those statuses.)

**Create** (`POST /loans`, admin-only): an administrator selects a Member and enters `RequestedAmount`, `RepaymentIntervalDays`, and an optional `Remarks`. The server sets:
- `ApplicationDate = today`
- `InterestRate = Config.default_interest_rate`
- `IsExceptionCase = RequestedAmount > Member.CurrentCapitalAmount` — flags for audit, never blocks creation (per the Phase 1 design doc's §5/§7.3 eligibility rule)
- `Status = Pending Board Approval`
- `Approvals` = one entry per current User (from a new `list_users()` repo function), each `{Status: Pending, Date: null, Comments: null}`

A User added to the system *after* a loan enters `Pending Board Approval` is not retroactively added to that loan's `Approvals` map — they simply have no vote on applications that predate their account. (Assumption; documented, not expected to matter at this org's scale.)

**Vote** (`POST /loans/{id}/approvals`, any authenticated User): body `{status: Approved | Rejected, comments?}`.
- Only valid while the loan's `Status = Pending Board Approval` and the caller's own `Approvals` entry is still `Pending`. Voting again after already voting, or voting on a loan that's no longer pending, is rejected (422) — **a cast vote is final.**
- A `Rejected` vote immediately flips the loan's `Status` to `Rejected`. Other Users' still-`Pending` entries are left untouched (the loan is now locked; no further votes are accepted, matching the Phase 1 design doc's "release requires unanimous approval" rule — one rejection ends the round). A rejected loan is never reopened; a new application is created if the board reconsiders.
- An `Approved` vote that completes unanimity (every entry now `Approved`) flips `Status` to `Approved` and sets `ApprovedAmount = RequestedAmount`. The board votes yes/no on the requested amount as a whole — there is no mechanism for any individual approver to propose a different amount.

**Release** (`POST /loans/{id}/release`, admin-only, only valid when `Status = Approved`): body `{release_date?}`, defaulting to today (mirrors the existing `PaymentDate` pattern described in the Phase 1 design doc §6). Computes, per §5's release formulas:
- `InterestDeduction = ApprovedAmount × InterestRate`
- `NetReleaseAmount = ApprovedAmount - InterestDeduction`
- `RemainingBalance = ApprovedAmount`
- `ReleaseDate = release_date`
- `NextDueDate = ReleaseDate + RepaymentIntervalDays`
- `Status = Active`

## 4. API Surface

| Endpoint | Access | Purpose |
|---|---|---|
| `POST /loans` | Admin | Create application (→ Pending Board Approval) |
| `GET /loans` | Any User | List all loans (optional `member_id`/`status` filter, applied in Python over a full scan) |
| `GET /loans/{id}` | Any User | Loan detail, including full `Approvals` state |
| `POST /loans/{id}/approvals` | Any User | Cast this user's vote |
| `POST /loans/{id}/release` | Admin | Release an `Approved` loan |

`GET`/`PUT /config` (existing, Plan 2) is extended to read/write `default_interest_rate`.

## 5. Frontend

- **LoansPage** (`/loans`, any user): table of all loans — member name, requested/approved amount, status, application date. Linked from dashboard nav (new "Loans" link, not role-hidden).
- **NewLoanPage** (`/loans/new`): member picker (from the existing Members list) plus amount/interval/remarks form. Not hidden from non-administrators in the nav — backend `require_admin` returns 403 on submit, surfaced as a generic error, exactly like Plan 2's Add Member/Settings pages.
- **LoanDetailPage** (`/loans/:id`): all loan fields; an Approvals table showing every User's vote, date, and comments; an Approve/Reject form shown only when the viewer's own entry is still `Pending` and the loan is still `Pending Board Approval`; a Release form (admin-only, shown only when `Status = Approved`).
- **SettingsPage** (existing): add a `default_interest_rate` field alongside `share_value`/`max_shares_per_member`.

No visual/UI polish in this plan (functional styling only, matching Plan 1/2) — a dedicated polish plan follows after Plan 5 (Cycle/Dividends).

## 6. Out of Scope (carried to later plans)

- Payment recording, `RemainingBalance` paydown, `Completed` status (Plan 4)
- The automated penalty engine, `PenaltyRate`/`PenaltyGracePeriodHours` (Plan 4)
- Cycle entity, `Top3BonusPercentage`/`Top3RankingWeights`, dividend distribution (Plan 5)
- Any UI/visual polish pass (Plan 6)
- Loan approval timeout/escalation policy, policy for insufficient pooled capital — both still open board decisions per the Phase 1 design doc §11, unchanged by this plan

## 7. Assumptions Made During Design (flag if any are wrong)

1. Only administrators create loan applications; any authenticated User can vote.
2. Creating an application skips `Draft` entirely — straight to `Pending Board Approval`.
3. `ApprovedAmount` always equals `RequestedAmount`; there's no per-approver amount edit.
4. Release is a separate, manually-triggered admin action — not automatic on reaching unanimous approval.
5. `Released` is not a distinct stored status from `Active` — release computes its fields and lands directly on `Active`.
6. A cast vote is final; re-voting on an already-decided entry is rejected.
7. Only `Active` members are eligible for new loan applications.
8. The Loans table has no GSIs; listing/filtering is a scan, matching Plan 2's Members precedent.
9. Users added after a loan enters `Pending Board Approval` are not retroactively added to its `Approvals` map.
