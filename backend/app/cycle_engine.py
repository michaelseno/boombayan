from .db import get_config, list_all_transactions, list_loans, list_members
from .models.cycle import Cycle, CycleCloseResult, DividendBreakdown
from .models.member import MemberStatus
from .models.transaction import TransactionType


def compute_cycle_close(cycle: Cycle) -> CycleCloseResult:
    config = get_config()
    loans_in_cycle = [loan for loan in list_loans() if loan.cycle_id == cycle.cycle_id]
    total_interest_earned = sum(loan.interest_deduction or 0 for loan in loans_in_cycle)

    penalties_in_cycle = [
        txn for txn in list_all_transactions()
        if txn.cycle_id == cycle.cycle_id and txn.type == TransactionType.PENALTY
    ]
    total_penalties_collected = sum(txn.amount for txn in penalties_in_cycle)

    top3_bonus_pool = total_interest_earned * config.top3_bonus_percentage
    remaining_profit = total_interest_earned - top3_bonus_pool

    active_members = [m for m in list_members() if m.status == MemberStatus.ACTIVE]

    loans_by_member: dict[str, list] = {}
    for loan in loans_in_cycle:
        loans_by_member.setdefault(loan.member_id, []).append(loan)

    qualifying_member_ids = {
        member.member_id for member in active_members if member.member_id in loans_by_member
    }

    metrics = {
        member_id: {
            "total_loan_amount": sum(loan.approved_amount or 0 for loan in loans_by_member[member_id]),
            "number_of_loans": len(loans_by_member[member_id]),
        }
        for member_id in qualifying_member_ids
    }

    def normalize(values: dict[str, float]) -> dict[str, float]:
        if not values:
            return {}
        low, high = min(values.values()), max(values.values())
        if high == low:
            return {member_id: 1.0 for member_id in values}
        return {member_id: (value - low) / (high - low) for member_id, value in values.items()}

    normalized_amount = normalize({m: metrics[m]["total_loan_amount"] for m in qualifying_member_ids})
    normalized_count = normalize({m: metrics[m]["number_of_loans"] for m in qualifying_member_ids})

    scores = {
        member_id: (
            normalized_amount[member_id] * config.top3_ranking_weight_amount
            + normalized_count[member_id] * config.top3_ranking_weight_count
        )
        for member_id in qualifying_member_ids
    }

    def most_recent_application_date(member_id: str) -> str:
        return max(loan.application_date for loan in loans_by_member[member_id])

    ranked_member_ids = sorted(
        qualifying_member_ids,
        key=lambda member_id: (-scores[member_id], most_recent_application_date(member_id)),
    )[:3]

    bonus_per_ranked_member = top3_bonus_pool / len(ranked_member_ids) if ranked_member_ids else 0.0

    total_shares_at_close = sum(member.current_shares for member in active_members)

    dividends = []
    for member in active_members:
        share_based_amount = (
            remaining_profit * (member.current_shares / total_shares_at_close)
            if total_shares_at_close > 0
            else 0.0
        )
        rank = ranked_member_ids.index(member.member_id) + 1 if member.member_id in ranked_member_ids else None
        top3_bonus_amount = bonus_per_ranked_member if rank is not None else 0.0
        dividends.append(
            DividendBreakdown(
                member_id=member.member_id,
                shares_at_calculation=member.current_shares,
                share_based_amount=share_based_amount,
                top3_bonus_amount=top3_bonus_amount,
                total_amount=share_based_amount + top3_bonus_amount,
                rank=rank,
            )
        )

    return CycleCloseResult(
        cycle_id=cycle.cycle_id,
        total_interest_earned=total_interest_earned,
        total_penalties_collected=total_penalties_collected,
        top3_bonus_percentage=config.top3_bonus_percentage,
        top3_bonus_pool=top3_bonus_pool,
        remaining_profit=remaining_profit,
        total_shares_at_close=total_shares_at_close,
        dividends=dividends,
    )
