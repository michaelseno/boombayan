# Plan 4: Payments & Penalties — Design

Status: Approved for planning
Source: `docs/superpowers/specs/2026-06-19-boombayan-phase1-design.md` §4, §6, refined through brainstorming
Scope: Recording payments against an `Active` loan's `RemainingBalance`, the `Completed` status, and the automated penalty engine. Cycle/dividend processing and any UI/visual polish pass are out of scope — see "Out of Scope" below.

## 1. Purpose

Plans 1-3 (Infra & Auth, Member & Share Management, Loan Lifecycle) are merged. An `Active` loan currently has a real outstanding balance that nothing can pay down, and no consequence for missing a due date. This plan adds payment recording (paying that balance down to `Completed`) and a scheduled penalty engine that charges a loan once per missed due date, per §6 of the Phase 1 design doc.

## 2. Data Model

### Transactions (new table)
- PK: `LoanId`, SK: `Timestamp` (full ISO 8601 datetime, not just a date — multiple transactions can land on the same calendar day and the sort key must be unique/orderable).
- Attributes: `TransactionId` (uuid, stable external reference independent of the key), `Type` (`PAYMENT` | `PENALTY`), `Amount`, `RemainingBalanceAfter`, `RecordedBy` (the admin's `UserId` for `PAYMENT`; `null` for system-generated `PENALTY` — nothing "recorded" those), `Notes` (optional).
- No GSI yet. The Phase 1 design doc sketches a `Type`/`Timestamp` GSI for cross-loan reports ("all payments this month"), but nothing consumes that until a future Reporting plan — same rationale Plan 3 applied to skip GSIs on `Loans`.
- Considered embedding transactions directly in the `Loan` item (matching `Members.ShareHistory`). Rejected: the Phase 1 design doc's own rule is that small, bounded collections embed while unbounded or independently-queried collections get their own table. A long-lived loan's payment/penalty history is unbounded by design.

### Loans (extended)
- New status value: `Completed` (terminal, alongside the existing `Rejected`).
- New attribute: `PenaltyChargedForCurrentCycle` (bool, default `false`) — set `true` when a penalty is charged for the current missed due date, reset to `false` whenever a payment is recorded (so the next missed due date can be penalized again).

### Config (extended)
Adds `penalty_rate: float` (e.g. `0.02` for 2%) and `penalty_grace_period_hours: int`, alongside the existing `share_value`, `max_shares_per_member`, `default_interest_rate`. Both default to `0`, matching the existing zero-default convention for unconfigured rates. Editable from the existing Settings page.

## 3. Payment Recording

`POST /loans/{loan_id}/payments` (admin-only, mirrors `release_loan`'s `require_admin` gate). Body: `{amount: float (>0), payment_date?: str, notes?: str}`, `payment_date` defaulting to today.

- 400 if the loan's `Status != Active` ("payments can only be recorded against an active loan").
- 400 if `amount > RemainingBalance` — **overpayment is rejected outright**, not clamped to zero or allowed to go negative. Forces the admin to enter the correct payoff amount.
- On success: `RemainingBalance -= amount`; append a `Transaction` (`Type=PAYMENT`, `Amount=amount`, `RemainingBalanceAfter` = the new balance, `RecordedBy` = the calling admin's `UserId`, `Notes=notes`, `Timestamp=now`); `NextDueDate = payment_date + RepaymentIntervalDays`; `PenaltyChargedForCurrentCycle = False`.
- If `RemainingBalance <= 0` after the update: `Status = Completed`. Because overpayment is rejected, balance can only reach exactly `0`, never negative.
- Returns the updated `Loan`.

`GET /loans/{loan_id}/transactions` (any authenticated user, matching `GET /loans/{id}`'s access level) — full transaction history for the loan, oldest first.

## 4. Penalty Engine

Core logic lives in a plain function, `run_penalty_check()`, with no FastAPI/HTTP layer — it's not user-triggered, so it's callable identically from tests and from a Lambda handler.

**Trigger:** a new `penaltyCheck` Lambda function in `infra/serverless.yml`, triggered by an EventBridge `schedule: rate(6 hours)` event. It shares the existing provider-level IAM role (the Transactions table's ARN is added to that role's `Resource` list; no new per-function role needed).

**Logic:** scan `list_loans()` filtered to `Status == Active`. For each:
- Compute `due_with_grace = midnight of NextDueDate + PenaltyGracePeriodHours` — `NextDueDate` is stored as a date-only string, so it's treated as the start (`00:00`) of that calendar day before adding the grace period.
- Skip unless **all** of: `now > due_with_grace`, `PenaltyChargedForCurrentCycle == False`, and `Config.penalty_rate > 0`.
- The `penalty_rate > 0` guard is a rule this plan adds beyond the original design doc's text: with both new Config fields defaulting to `0`, a literal reading would start charging (and recording) `$0` penalty transactions against every overdue loan the instant this ships, before any admin has opted in via Settings. Guarding on a positive rate keeps the engine inert until configured.
- On a match: `penalty = RemainingBalance × PenaltyRate`; `RemainingBalance += penalty` (penalty compounds into what's owed, per §6); append a `Transaction` (`Type=PENALTY`, `Amount=penalty`, `RemainingBalanceAfter` = the new balance, `RecordedBy=null`, `Notes=null`, `Timestamp=now`); `PenaltyChargedForCurrentCycle = True`; persist via `put_loan`.

This reaffirms the Phase 1 design doc's explicit rule: a penalty applies once per missed due date, never repeats for the same due date (since `NextDueDate` only advances on payment), and compounds into the balance rather than being tracked separately.

## 5. API Surface

| Endpoint | Access | Purpose |
|---|---|---|
| `POST /loans/{id}/payments` | Admin | Record a payment, paying down `RemainingBalance` |
| `GET /loans/{id}/transactions` | Any User | Full payment/penalty history for a loan |

`GET`/`PUT /config` (existing) is extended to read/write `penalty_rate` and `penalty_grace_period_hours`.

No HTTP endpoint triggers the penalty engine — it only runs on the EventBridge schedule.

## 6. Frontend

- **`api/types.ts`**: add a `Transaction` interface; extend the `LoanStatus` union with `'Completed'`; extend `Loan` with `penalty_charged_for_current_cycle: boolean` (mirrors the backend model 1:1, matching this codebase's existing convention, even though the UI won't prominently surface it); extend `Config` with `penalty_rate` / `penalty_grace_period_hours`.
- **`LoanDetailPage.tsx`**: an admin-only "Record payment" form (amount + date inputs), shown only when `status === 'Active'`, posting to the new endpoint and refreshing the loan on success. A "Transaction history" table below it, fetched from `GET /loans/{id}/transactions`, showing type/amount/balance-after/date/recorded-by/notes. `Completed` status displays as plain text, same treatment as `Rejected` — no special action attached.
- **`SettingsPage.tsx`**: add `penalty_rate` and `penalty_grace_period_hours` fields, matching the existing `default_interest_rate` field's pattern exactly.

## 7. Out of Scope (carried to later plans)

- Cycle entity, `Top3BonusPercentage`/`Top3RankingWeights`, dividend distribution (Plan 5)
- Any UI/visual polish pass (Plan 6, per the existing sequencing decision from Plan 3's brainstorming)
- The Reporting module and the Transactions table's cross-loan `Type`/`Timestamp` GSI (deferred until a Reporting plan actually needs it)
- Loan approval timeout/escalation policy, policy for insufficient pooled capital — still open board decisions per the Phase 1 design doc §11, unchanged by this plan

## 8. Assumptions Made During Design (flag if any are wrong)

1. The penalty engine skips loans entirely while `Config.penalty_rate <= 0`, rather than charging `$0` penalties — a rule added beyond the original design doc's literal text, to keep the engine inert until an admin opts in.
2. Overpayment (`amount > RemainingBalance`) is rejected outright (400), never clamped to zero or allowed to go negative.
3. Only `Active` loans accept payments; payments against any other status are rejected.
4. Payment recording is admin-only, matching the existing `Release` action's access level.
5. `RecordedBy` is `null` for system-generated `PENALTY` transactions; only `PAYMENT` transactions carry the recording admin's `UserId`.
6. The Transactions table has no GSI yet — listing is always scoped to a single loan via its partition key.
7. The penalty-check Lambda runs every 6 hours via EventBridge, sharing the API Lambda's existing IAM role.
8. `penalty_charged_for_current_cycle` resets to `false` on every payment (not just a full payoff), so a partial payment still re-arms the penalty for the next missed due date.
9. `NextDueDate` is anchored to midnight (`00:00`) of its stored calendar date before the grace period is added, since the field itself carries no time component.
