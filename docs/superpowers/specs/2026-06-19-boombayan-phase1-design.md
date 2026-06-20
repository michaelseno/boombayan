# Boombayan Lending Management System — Phase 1 Design

Status: Draft for review
Source: Boombayan LMS BRD v1.2
Scope: Web-only internal back-office system (board members + administrators). Mobile app and member self-service portal are explicitly out of scope (see "Out of Scope" below) — matching the BRD's own classification of both as Future Enhancements (§19).

## 1. Purpose

This document translates the BRD's business rules into a concrete technical design: architecture, data model, workflows, and calculation engines for replacing Boombayan's spreadsheet-based lending operations. It covers the full core business domain (membership, shares/capital, loans, payments, penalties, cycles, dividends, reporting) as one cohesive design, since these areas share a data model and are tightly interdependent. Build sequencing into incremental milestones happens in the implementation plan (next step), not in this document.

## 2. Architecture

| Layer | Choice | Rationale |
|---|---|---|
| Backend | FastAPI (Python), deployed on AWS Lambda via the Mangum ASGI adapter, behind API Gateway (HTTP API) | Matches stated Python comfort; async, lightweight, pairs naturally with Lambda |
| Database | Amazon DynamoDB | Builder's prior experience; reporting trade-offs mitigated by a custom reporting module (see §8) instead of a data-lake pipeline |
| IaC | Serverless Framework | Builder's explicit choice; mature Lambda/API Gateway tooling |
| Frontend | React + Vite + TypeScript, single-page app, hosted as static files on S3 + CloudFront | No SSR/SEO need (internal, auth-gated dashboard); simplest static deploy |
| Auth | Amazon Cognito (User Pools); JWTs verified inside the FastAPI app (PyJWT against Cognito's JWKS endpoint), not a native API Gateway JWT authorizer | Offloads password hashing/reset/MFA; less custom security code to maintain solo. App-level verification (not an API Gateway authorizer) was the actual Phase 1 implementation choice — keeps auth testable/portable and was needed anyway since this Lambda's `$default` catch-all route handles its own CORS via FastAPI middleware |
| Monitoring | CloudWatch (logs, metrics) | Native to the stack |
| Repo | Monorepo: `backend/`, `frontend/`, `infra/` | Builder's explicit choice |

Estimated AWS cost at ~100 users: ~$20-30/month, dominated by the DynamoDB on-demand/Lambda/API Gateway/Cognito free tiers staying near $0 at this scale.

## 3. Roles & Permissions

Two people-facing identities, linked but distinct:

- **Member** — a financial stake in the org: shares, capital, loans, dividends. Most members in V1 never log in (member self-service is a Future Enhancement, §19).
- **User** — a login account (Cognito-backed). Every User can review and approve/reject loans (the "board member" capability). A subset of Users additionally hold an `IsAdministrator` flag granting day-to-day data entry: managing members, shares, payments, cycles, and system configuration.

A User optionally links to a Member record (`MemberId`), since board members are themselves shareholding Members. This also supports future non-member staff (Users without a linked Member) without a data model change.

No public-facing or borrower-facing access exists in Phase 1.

## 4. Data Model

Multiple focused DynamoDB tables (not one single-table design) — at this scale (low hundreds of items, low request rate) single-table design's main benefits (pre-joining at high scale) aren't relevant, and separate tables are simpler to reason about. Small, strictly bounded collections are embedded directly in their parent item; unbounded or independently-queried collections get their own table.

### Users
- PK: `UserId` (Cognito sub)
- Attributes: `Email`, `IsAdministrator` (bool), `MemberId` (nullable link), `CreatedAt`, `LastLoginAt`

### Members
- PK: `MemberId`
- Attributes: `FirstName`, `LastName`, `Email`, `Phone`, `DateJoined`, `Status` (Active/Inactive/Withdrawn), `CurrentShares`, `CurrentCapitalAmount`
- Embedded `ShareHistory`: list of `{CycleId, SharesPurchased, ShareValueAtPurchase, AmountPaid, Date}` — embedded because purchases are rare and capped (max 5 shares ever)
- Shares/capital persist automatically across cycles unless the member actively withdraws (confirmed)

### Loans
- PK: `LoanId`
- Attributes: `MemberId`, `RequestedAmount`, `ApprovedAmount`, `RepaymentIntervalDays`, `InterestRate` (snapshotted at application — future rate changes never affect existing loans, per §7.5), `ApplicationDate`, `Remarks`, `Status`, `IsExceptionCase` (bool), `ReleaseDate`, `InterestDeduction`, `NetReleaseAmount`, `RemainingBalance`, `NextDueDate`, `PenaltyChargedForCurrentCycle` (bool)
- Embedded `Approvals`: map of `BoardMemberUserId -> {Status, Date, Comments}` — bounded at exactly the number of Users with approval rights, so one read returns the loan and its full approval state together
- GSI1: PK `MemberId`, SK `ApplicationDate` — "all loans for a member," newest first
- GSI2: PK `Status`, SK `ApplicationDate` — "all loans pending approval" (board dashboard)

### Transactions
- PK: `LoanId`, SK: `Timestamp`
- Attributes: `Type` (PAYMENT | PENALTY), `Amount`, `RemainingBalanceAfter`, `RecordedBy` (UserId), `Notes`
- Payments and penalties share this table since both are balance-affecting events on a loan; one query returns a loan's full transaction history
- GSI: PK `Type`, SK `Timestamp` — cross-loan reports ("all payments this month")

### Cycles
- PK: `CycleId`
- Attributes: `StartDate`, `EndDate`, `Status` (Open/Closed), `TotalInterestEarned`, `TotalPenaltiesCollected`, `Top3BonusPercentage` (snapshotted at close), `Top3BonusPool`, `RemainingProfit`, `TotalSharesAtClose`, `ClosedAt`
- Closed cycles are immutable (audit trail requirement, §17)

### Dividends
- PK: `CycleId`, SK: `MemberId`
- Attributes: `ShareBasedAmount`, `Top3BonusAmount`, `TotalAmount`, `SharesAtCalculation`, `Rank` (1-3 if Top 3, else null)
- GSI: PK `MemberId`, SK `CycleId` — "a member's dividend history across cycles"

### AuditLog
- PK: `EntityType#EntityId`, SK: `Timestamp`
- Attributes: `Action`, `ActorUserId`, `Details` (snapshot/description)
- Append-only; never deleted (§17)

### Config
- Single item. Current values only — no historical versioning, since every consuming entity snapshots the value it used at the time (loan stores its own interest rate, share purchase stores its own share value, cycle stores its own bonus %)
- Attributes: `ShareValue`, `MaxSharesPerMember`, `DefaultInterestRate`, `PenaltyRate`, `PenaltyGracePeriodHours`, `Top3BonusPercentage`, `Top3RankingWeights {WeightAmount, WeightCount}`

## 5. Loan Lifecycle

**States:** `Draft → Pending Board Approval → Approved → Released → Active → Completed`, plus **`Rejected`** (added; not in the BRD's diagram) — triggered the moment any one User rejects, since release requires unanimous approval (§7.2). A rejected application is not reopened; a new Draft is created if the board reconsiders, preserving the audit record of what was actually rejected.

**Eligibility & exceptions (§7.3):** there is no configurable max-loan multiplier. The member's `CurrentCapitalAmount` is the implicit standard ceiling — if `ApprovedAmount > CurrentCapitalAmount`, the system auto-sets `IsExceptionCase = true` for the audit trail, but never blocks approval. All outstanding loans/balances for the member are always shown during review (§7.4 — no concurrent-loan limit).

**Release (§7.6):** on transition to `Released`: `InterestDeduction = ApprovedAmount × InterestRate`, `NetReleaseAmount = ApprovedAmount - InterestDeduction`, `ReleaseDate = now`, `RemainingBalance = ApprovedAmount` (the borrower must repay the full approved amount, not the net amount received — the interest is the org's cut taken upfront, not a discount on principal), `NextDueDate = ReleaseDate + RepaymentIntervalDays`.

**Repayment model:** `RepaymentIntervalDays` is the recurring repayment interval itself (e.g., 30, 15, 60 days), not a fixed total duration. The loan keeps recurring due dates — however many cycles it takes — until the balance reaches zero, rather than following a pre-computed installment schedule. Payment amounts are flexible, not fixed installments.

## 6. Payments & Penalties

**Recording a payment:** Admin enters `PaymentAmount` + `PaymentDate` (defaults to today, editable for backdated entries). `RemainingBalance -= PaymentAmount`, recorded as a `Transaction` (Type=PAYMENT) with the resulting balance snapshotted. `NextDueDate = PaymentDate + RepaymentIntervalDays`; `PenaltyChargedForCurrentCycle` resets to `false`. If `RemainingBalance <= 0`, the Loan transitions to `Completed`.

**Penalty engine (automated):** a scheduled job (EventBridge rule → Lambda, running every few hours) queries Active loans where `now > NextDueDate + PenaltyGracePeriodHours` AND `PenaltyChargedForCurrentCycle == false`. For each match: `penalty = RemainingBalance × PenaltyRate`, `RemainingBalance += penalty` (penalty compounds into what's owed), recorded as a `Transaction` (Type=PENALTY), then `PenaltyChargedForCurrentCycle = true`.

This means a penalty applies **once per missed due date**, not repeatedly while overdue — confirmed explicitly. Since `NextDueDate` only advances on payment, a loan with zero further payments accrues exactly one penalty, ever. This is a direct, intentional consequence of the confirmed rules, not an oversight — worth the board revisiting if it proves to be insufficient collections pressure in practice, but out of scope to change without a new decision.

## 7. Dividend Distribution & Top 3 Ranking (Cycle Close, §11-13)

1. `TotalInterestEarned` = sum of `InterestDeduction` across all loans released during the cycle (interest is earned in full at release, not accrued over time, since it's deducted upfront).
2. `TotalPenaltiesCollected` = sum of penalty Transactions in the cycle — **tracked and reported separately, excluded from the distributable dividend pool** (confirmed: only interest funds dividends, matching §10's "interest is the only income source" and §11's formula, which references only interest earned).
3. `Top3BonusPool = TotalInterestEarned × Top3BonusPercentage` (board-configured, value TBD — see Open Items).
4. `RemainingProfit = TotalInterestEarned - Top3BonusPool`.
5. Each member's dividend = `RemainingProfit × (CurrentShares / TotalSharesAcrossAllMembers)`, plus an equal three-way split of `Top3BonusPool` if ranked in the Top 3.
6. Results written to `Dividends`; the `Cycle` record is updated with all computed totals and locked (`Status = Closed`, immutable thereafter).

**Top 3 ranking:** for each member with ≥1 loan in the cycle, compute `TotalLoanAmount` and `NumberOfLoans`, min-max normalize each across all qualifying members (0-1 scale, so peso amounts don't dominate the count metric; if all qualifying members tie on a metric, that metric normalizes to 1 for everyone rather than dividing by zero), then `Score = normalize(TotalLoanAmount) × WeightAmount + normalize(NumberOfLoans) × WeightCount`. Weights live in Config, board-adjustable without code changes (satisfies §12). Ties in final score are broken by earliest `ApplicationDate` among the tied members' most recent loan, for deterministic results — an engineering tie-break, not a business policy, so it doesn't need board sign-off.

## 8. Reporting Module

Each of the BRD's 8 report types (§14) maps to one table, queried/scanned and aggregated in a Lambda function — no Athena or data-lake pipeline for Phase 1, since per-table item counts stay small at this org's scale (deferred unless scanning genuinely becomes a bottleneck):

| Report | Source |
|---|---|
| Member Report | Members |
| Capital Report | Members (sum CurrentCapitalAmount, share distribution) |
| Loan Report | Loans |
| Payment Report | Transactions (Type=PAYMENT) |
| Interest Report | Loans (InterestDeduction) |
| Penalty Report | Transactions (Type=PENALTY) |
| Dividend Report | Dividends |
| Cycle Summary Report | Cycles |

Exports to PDF (reportlab/weasyprint) and Excel (openpyxl) per the non-functional requirements (§18).

## 9. Out of Scope (Phase 1)

- Native/cross-platform mobile app (BRD §19 Future Enhancement)
- Member self-service portal (BRD §19 Future Enhancement); no Member-role login exists
- SMS/email notifications, automated payment reminders, digital signatures, electronic dividend statements (all BRD §19 Future Enhancements)
- Athena/S3 data-lake reporting pipeline (revisit only if per-table scans become a real bottleneck)
- Aurora Serverless / DynamoDB alternative database migration

## 10. Assumptions Made During Design (flag if any are wrong)

1. `RemainingBalance` initializes at `ApprovedAmount`, not `NetReleaseAmount` — borrower owes back the full pre-deduction amount.
2. `RepaymentIntervalDays` is a recurring interval, not a fixed total loan duration.
3. Standard max loan = 1:1 against `CurrentCapitalAmount`, no configurable multiplier; exceeding it only sets an audit flag, never blocks approval.
4. `Rejected` is a new terminal state, triggered by any single rejection; rejected applications are not reopened.
5. Penalties apply once per missed due date, never repeat for the same due date, and compound into the loan's outstanding balance.
6. Collected penalties are excluded from the dividend distribution pool.
7. Top 3 ranking uses a board-configurable weighted sum of normalized loan amount and loan count.
8. Shares/capital persist automatically across cycles unless a member explicitly withdraws.
9. Users (login accounts) and Members (financial stake) are linked-but-distinct records.
10. Config holds current values only, no historical versioning.

## 11. Outstanding Decisions for the Board (carried from BRD §20, not resolved by this design)

- Top 3 bonus pool percentage (value)
- Top 3 ranking weight values (the engine is built; the weights are a board call)
- Loan approval timeout policy (no expiry/escalation mechanism designed yet for stalled approvals)
- Policy when pooled available capital is insufficient to fund an approved loan
- Member withdrawal process mechanics (request flow, capital payout timing) — data model supports withdrawal as a Member status change, but the process itself isn't designed
- Cycle reopening policy — not supported in Phase 1; closed cycles are immutable by design
