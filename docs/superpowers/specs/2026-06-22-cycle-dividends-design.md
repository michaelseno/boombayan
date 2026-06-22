# Plan 5: Cycle Close & Dividend Distribution — Design

Status: Approved for planning
Source: `docs/superpowers/specs/2026-06-19-boombayan-phase1-design.md` §4, §7, refined through brainstorming
Scope: The `Cycle` entity (manual open/close lifecycle), the dividend distribution and Top 3 ranking engine run at cycle close, and the Config/Settings fields the board needs to drive it. The Reporting Module (§8) and the UI/visual polish pass are explicitly out of scope — see "Out of Scope" below.

## 1. Purpose

Plans 1-4 (Infra & Auth, Member & Share Management, Loan Lifecycle, Payments & Penalties) are merged. Interest is earned on every loan release and penalties accrue on every missed due date, but nothing yet groups that activity into a cycle or pays it out to members as a dividend. This plan adds the `Cycle` entity, the dividend/Top 3 calculation engine, and the minimal admin workflow to open a cycle, preview its close, and commit it — per §7 of the Phase 1 design doc.

## 2. Data Model

### Cycles (new table)
- PK: `CycleId`.
- Attributes: `StartDate`, `EndDate` (null until closed), `Status` (`Open` | `Closed`), `TotalInterestEarned`, `TotalPenaltiesCollected`, `Top3BonusPercentage` (snapshotted from Config at close, not live), `Top3BonusPool`, `RemainingProfit`, `TotalSharesAtClose`, `ClosedAt`.
- No GSI. Consistent with every other table in this codebase (Loans, Members, Transactions all scan rather than use a GSI, despite the original Phase 1 design doc sketching a couple) — at this scale a scan is simpler and the cost difference is negligible.
- Invariant: at most one `Open` cycle at a time, enforced at the API layer (`POST /cycles` checks via scan before creating).

### Dividends (new table)
- PK: `CycleId`, SK: `MemberId`.
- Attributes: `ShareBasedAmount`, `Top3BonusAmount`, `TotalAmount`, `SharesAtCalculation`, `Rank` (1-3 if Top 3 that cycle, else null).
- Queried only by `CycleId` for now. No `MemberId`-history GSI (a member's dividend history across cycles) — deferred until a future Reporting plan actually needs it, same rationale Plan 4 applied to the Transactions table's cross-loan GSI.

### Loans (extended)
- New attribute: `cycle_id: str | None`, stamped with the currently-`Open` cycle's `CycleId` when the loan is released (`POST /loans/{id}/release`). `null` if no cycle is open at release time. Drives both `TotalInterestEarned` (sum of `InterestDeduction` over loans with this `cycle_id`) and Top 3 eligibility.

### Transactions (extended)
- New attribute: `cycle_id: str | None`, stamped at creation time (both `PAYMENT` and `PENALTY` transactions) with the currently-`Open` cycle's `CycleId`, or `null` if none is open. Only `PENALTY`-typed transactions feed `TotalPenaltiesCollected`; `PAYMENT` transactions carry the field for consistency but nothing reads it yet.

### Members.ShareHistoryEntry (existing field, now populated)
- `cycle_id` already exists on this embedded entry but has been hardcoded `null` since Plan 2 (no `Cycle` entity existed). The purchase-shares endpoint now stamps it with the currently-`Open` cycle's `CycleId`, or `null` if none is open.

### Config (extended)
- New attributes: `top3_bonus_percentage: float = 0`, `top3_ranking_weight_amount: float = 0`, `top3_ranking_weight_count: float = 0`. All default to `0`, mirroring the `penalty_rate` convention from Plan 4 — with a `0` bonus percentage, `Top3BonusPool` computes to `0` until the board sets a real value, so this ships safely ahead of that board decision. Editable from the existing Settings page.

## 3. Cycle Lifecycle

`POST /cycles` (admin-only). Body: `{start_date?: str}`, defaulting to today.
- 400 if a cycle with `Status == Open` already exists — only one cycle can be open at a time.
- Creates `Cycle(cycle_id=uuid4(), start_date=..., status=Open)` with all totals unset/zero and `end_date=None`.

From the moment a cycle is `Open`, the following existing write paths look up the open cycle (`get_open_cycle()` — a scan filtered to `Status == Open`, returning `None` if none exists) and stamp its `CycleId`:
- `POST /loans/{id}/release` → `Loan.cycle_id`
- `POST /loans/{id}/payments` → the resulting `Transaction.cycle_id` (type `PAYMENT`)
- the penalty engine (`run_penalty_check()`) → the resulting `Transaction.cycle_id` (type `PENALTY`)
- `POST /members/{id}/shares` (purchase shares) → the new `ShareHistoryEntry.cycle_id`

If no cycle is open when one of these fires, `cycle_id` stays `null` and that event is permanently excluded from any future cycle's close calculation — there is no backfill.

`GET /cycles/{id}/preview-close` (admin-only). Runs the full calculation in §4 and returns the result **without writing anything** — lets the board sanity-check the numbers (especially a freshly-changed Top 3 bonus % or weights) before the irreversible close. 400 if `Status != Open`.

`POST /cycles/{id}/close` (admin-only). Body: `{end_date?: str}`, defaulting to today. 400 if `Status != Open`. Runs the identical calculation and persists it: updates the `Cycle` (`EndDate`, `Status=Closed`, the five computed totals, `Top3BonusPercentage` snapshotted from Config, `ClosedAt=now`) and writes one `Dividend` record per `Active` member. Closed cycles are immutable — no reopen/edit endpoint exists, matching the Phase 1 design doc's audit-trail requirement (§17) and its explicit non-support for cycle reopening (§11).

`GET /cycles` (any user) and `GET /cycles/{id}` (any user) — list/read, no calculation involved.

`GET /cycles/{id}/dividends` (any user) — lists the persisted `Dividend` records for a cycle (only meaningful once `Closed`; returns an empty list for an `Open` cycle since none have been written yet).

## 4. Dividend & Top 3 Calculation Engine

One plain function (no FastAPI/HTTP layer), shared verbatim by `preview-close` and `close` — same pattern as `run_penalty_check()`. Given a `Cycle` and the current `Config`:

1. `TotalInterestEarned` = sum of `InterestDeduction` over all `Loan`s with `cycle_id == cycle.cycle_id`.
2. `TotalPenaltiesCollected` = sum of `Amount` over all `Transaction`s with `cycle_id == cycle.cycle_id` and `type == PENALTY`. (Tracked for the record only — excluded from the distributable pool, per §7.2 of the Phase 1 design doc.)
3. `Top3BonusPool = TotalInterestEarned × Config.top3_bonus_percentage`.
4. `RemainingProfit = TotalInterestEarned - Top3BonusPool`.
5. **Qualifying members** = members with `Status == Active` who have ≥1 loan with `cycle_id == cycle.cycle_id`. For each: `TotalLoanAmount` (sum of `ApprovedAmount` over their qualifying loans), `NumberOfLoans` (count of their qualifying loans).
6. Min-max normalize `TotalLoanAmount` and `NumberOfLoans` independently across the qualifying members to a 0-1 scale. If every qualifying member ties on a given metric, that metric normalizes to `1` for everyone (avoids a divide-by-zero from a zero range).
7. `Score = normalize(TotalLoanAmount) × Config.top3_ranking_weight_amount + normalize(NumberOfLoans) × Config.top3_ranking_weight_count`.
8. Rank qualifying members descending by `Score`. Ties are broken by the earliest `ApplicationDate` among each tied member's most recent loan (an engineering tie-break, not a board policy, per §7's note). Take the top `min(3, qualifying_count)` as the ranked set.
9. `Top3BonusPool` splits equally among the ranked set — by however many actually rank (1, 2, or 3), not always ÷3. If zero members qualify, the pool is computed and recorded on the `Cycle` but distributed to no one.
10. `TotalSharesAtClose` = sum of `CurrentShares` over all `Active` members.
11. For **every `Active` member** (regardless of whether they hold any shares or rank in the Top 3): `ShareBasedAmount = RemainingProfit × (CurrentShares / TotalSharesAtClose)`, or `0` for everyone if `TotalSharesAtClose == 0`; `Top3BonusAmount` = their equal share of `Top3BonusPool` if ranked, else `0`; `TotalAmount = ShareBasedAmount + Top3BonusAmount`. A `Dividend` record is produced for every `Active` member, even a `$0` one, for a complete audit trail of who was considered.

`Inactive`/`Withdrawn` members never receive a dividend or rank in the Top 3, regardless of their `CurrentShares` value — member withdrawal doesn't zero out shares yet (still an open board decision, §11 unchanged), so excluding by `Status` is the only reliable gate today.

## 5. API Surface

| Endpoint | Access | Purpose |
|---|---|---|
| `POST /cycles` | Admin | Open a new cycle |
| `GET /cycles` | Any User | List all cycles |
| `GET /cycles/{id}` | Any User | Get a single cycle |
| `GET /cycles/{id}/preview-close` | Admin | Compute (no writes) the would-be close totals, rankings, and dividends |
| `POST /cycles/{id}/close` | Admin | Commit the close: persist totals and write `Dividend` records |
| `GET /cycles/{id}/dividends` | Any User | List dividends for a cycle |

`GET`/`PUT /config` (existing) extended to read/write `top3_bonus_percentage`, `top3_ranking_weight_amount`, `top3_ranking_weight_count`.

Existing endpoints gain a side effect (stamping `cycle_id`) but no new request/response shape: `POST /loans/{id}/release`, `POST /loans/{id}/payments`, the `penaltyCheck` Lambda, `POST /members/{id}/shares`.

## 6. Frontend

- **New `CyclesPage.tsx`**: a list of cycles (status, start/end dates). Admin-only "Open new cycle" action when no cycle is currently `Open`. Clicking into a cycle shows its detail:
  - `Open` cycle (admin): a "Preview close" action that calls `GET /cycles/{id}/preview-close` and renders the computed totals plus a dividend breakdown table (member, shares, score/rank if Top 3, share-based amount, bonus amount, total); a separate "Confirm close" action that calls `POST /cycles/{id}/close`.
  - `Closed` cycle (any user): the final persisted totals and its `Dividend` table, fetched from `GET /cycles/{id}/dividends`.
- **`SettingsPage.tsx`**: add `top3_bonus_percentage`, `top3_ranking_weight_amount`, `top3_ranking_weight_count` fields, matching the existing field pattern exactly (same as `penalty_rate` in Plan 4).
- **Dashboard nav**: add a "Cycles" link alongside the existing Loans/Members links.
- **`api/types.ts`**: add `Cycle` and `Dividend` interfaces; extend `Loan` with `cycle_id: string | null`; extend `Transaction` with `cycle_id: string | null`; extend `Config` with the three new fields.

## 7. Out of Scope (carried to later plans)

- The Reporting Module and its 8 report types (§8 of the Phase 1 design doc) — a separate future plan.
- Any UI/visual polish pass (Plan 6, per the existing sequencing decision carried from Plan 3's and Plan 4's brainstorming).
- Member withdrawal process mechanics (request flow, capital payout timing, automatic share zeroing) — still an open board decision per §11, unchanged by this plan.
- Cycle reopening — not supported; closed cycles are immutable by design (§11, §17).
- Loan approval timeout/escalation policy, policy for insufficient pooled available capital — unchanged open items from §11.
- A `Dividends` table GSI for "a member's dividend history across cycles" — deferred until a future Reporting plan actually needs that query.

## 8. Assumptions Made During Design (flag if any are wrong)

1. Cycle opening/closing is fully manual (admin-driven); there is no auto-open-on-close or fixed-duration auto-rolling behavior.
2. `cycle_id` is stamped at event time (loan release, payment/penalty transaction, share purchase) from whichever cycle is currently `Open`; events with no open cycle get `cycle_id = null` and are permanently excluded from any future close — there is no backfill mechanism.
3. Dividend and Top 3 eligibility is gated on `Member.Status == Active` only, regardless of `CurrentShares` value — `Inactive`/`Withdrawn` members receive nothing, even though their shares aren't actually zeroed out yet (that's still unimplemented per §11).
4. `Top3BonusPool` splits equally among however many members actually qualify and rank (1, 2, or 3) — not always divided by 3. If zero members qualify, the pool is computed and recorded but distributed to no one.
5. A `Dividend` record is written for every `Active` member at close, even at `$0`, for audit completeness — not just for members who received a nonzero amount.
6. Both `PAYMENT` and `PENALTY` transactions get `cycle_id` stamped for consistency, though only `PENALTY` transactions feed `TotalPenaltiesCollected`.
7. `preview-close` and `close` are both admin-only — they expose/commit sensitive financial allocation data, same access level as `release_loan` and `record_payment`.
8. No GSIs are added to the new `Cycles` or `Dividends` tables, consistent with the rest of this codebase's scan-based convention.
9. Top 3 bonus percentage and ranking weights default to `0` in Config (board decisions still pending per §11), so the feature ships safely and is configurable from Settings once the board decides.
