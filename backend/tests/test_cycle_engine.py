from app.db import put_config, put_loan, put_member, put_transaction
from app.models.config import Config
from app.models.cycle import Cycle, CycleStatus
from app.models.loan import Loan, LoanStatus
from app.models.member import Member, MemberStatus
from app.models.transaction import Transaction, TransactionType


def _cycle(cycle_id="cycle-1"):
    return Cycle(cycle_id=cycle_id, start_date="2026-01-01", status=CycleStatus.OPEN)


def _loan(loan_id, member_id, approved_amount, interest_deduction, cycle_id="cycle-1", application_date="2026-01-10"):
    return Loan(
        loan_id=loan_id, member_id=member_id, requested_amount=approved_amount, approved_amount=approved_amount,
        repayment_interval_days=30, interest_rate=0.1, application_date=application_date,
        status=LoanStatus.ACTIVE, release_date=application_date, interest_deduction=interest_deduction,
        net_release_amount=approved_amount - interest_deduction, remaining_balance=approved_amount,
        next_due_date="2026-02-10", cycle_id=cycle_id,
    )


def _member(member_id, current_shares, status=MemberStatus.ACTIVE):
    return Member(
        member_id=member_id, first_name="A", last_name="B", email=f"{member_id}@x.com",
        phone="1", date_joined="2026-01-01", status=status, current_shares=current_shares,
    )


def test_compute_cycle_close_sums_interest_from_loans_in_cycle(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config())
    put_loan(_loan("loan-1", "mem-1", 10000, 500))
    put_loan(_loan("loan-2", "mem-1", 5000, 250, cycle_id="cycle-2"))
    put_member(_member("mem-1", current_shares=2))

    result = compute_cycle_close(_cycle())

    assert result.total_interest_earned == 500


def test_compute_cycle_close_sums_penalties_from_transactions_in_cycle(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config())
    put_transaction(Transaction(
        transaction_id="t1", loan_id="loan-1", timestamp="2026-01-15T00:00:00+00:00",
        type=TransactionType.PENALTY, amount=100, remaining_balance_after=9000, cycle_id="cycle-1",
    ))
    put_transaction(Transaction(
        transaction_id="t2", loan_id="loan-1", timestamp="2026-01-16T00:00:00+00:00",
        type=TransactionType.PAYMENT, amount=1000, remaining_balance_after=8000, cycle_id="cycle-1",
    ))
    put_transaction(Transaction(
        transaction_id="t3", loan_id="loan-2", timestamp="2026-01-17T00:00:00+00:00",
        type=TransactionType.PENALTY, amount=50, remaining_balance_after=4000, cycle_id="cycle-2",
    ))

    result = compute_cycle_close(_cycle())

    assert result.total_penalties_collected == 100


def test_compute_cycle_close_splits_top3_bonus_among_qualifying_members(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config(top3_bonus_percentage=0.1, top3_ranking_weight_amount=1, top3_ranking_weight_count=0))
    put_loan(_loan("loan-1", "mem-1", 10000, 1000))
    put_member(_member("mem-1", current_shares=1))
    put_member(_member("mem-2", current_shares=1))

    result = compute_cycle_close(_cycle())

    assert result.total_interest_earned == 1000
    assert result.top3_bonus_pool == 100
    dividend_for_mem1 = next(d for d in result.dividends if d.member_id == "mem-1")
    assert dividend_for_mem1.rank == 1
    assert dividend_for_mem1.top3_bonus_amount == 100
    dividend_for_mem2 = next(d for d in result.dividends if d.member_id == "mem-2")
    assert dividend_for_mem2.rank is None
    assert dividend_for_mem2.top3_bonus_amount == 0


def test_compute_cycle_close_ranks_by_weighted_score_and_caps_at_three(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config(top3_bonus_percentage=0.1, top3_ranking_weight_amount=1, top3_ranking_weight_count=0))
    put_loan(_loan("loan-1", "mem-1", 1000, 100))
    put_loan(_loan("loan-2", "mem-2", 2000, 200))
    put_loan(_loan("loan-3", "mem-3", 3000, 300))
    put_loan(_loan("loan-4", "mem-4", 4000, 400))
    for member_id in ["mem-1", "mem-2", "mem-3", "mem-4"]:
        put_member(_member(member_id, current_shares=1))

    result = compute_cycle_close(_cycle())

    ranked = {d.member_id: d.rank for d in result.dividends if d.rank is not None}
    assert ranked == {"mem-4": 1, "mem-3": 2, "mem-2": 3}
    assert next(d for d in result.dividends if d.member_id == "mem-1").rank is None


def test_compute_cycle_close_breaks_ties_by_earliest_application_date(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config(top3_bonus_percentage=0.1, top3_ranking_weight_amount=1, top3_ranking_weight_count=0))
    put_loan(_loan("loan-1", "mem-1", 1000, 100, application_date="2026-01-20"))
    put_loan(_loan("loan-2", "mem-2", 1000, 100, application_date="2026-01-05"))
    put_member(_member("mem-1", current_shares=1))
    put_member(_member("mem-2", current_shares=1))

    result = compute_cycle_close(_cycle())

    ranked = {d.member_id: d.rank for d in result.dividends if d.rank is not None}
    assert ranked == {"mem-2": 1, "mem-1": 2}


def test_compute_cycle_close_distributes_share_based_amount_proportionally(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config(top3_bonus_percentage=0))
    put_loan(_loan("loan-1", "mem-1", 10000, 1000))
    put_member(_member("mem-1", current_shares=1))
    put_member(_member("mem-2", current_shares=3))

    result = compute_cycle_close(_cycle())

    assert result.remaining_profit == 1000
    assert result.total_shares_at_close == 4
    dividend_for_mem1 = next(d for d in result.dividends if d.member_id == "mem-1")
    dividend_for_mem2 = next(d for d in result.dividends if d.member_id == "mem-2")
    assert dividend_for_mem1.share_based_amount == 250
    assert dividend_for_mem2.share_based_amount == 750


def test_compute_cycle_close_excludes_non_active_members(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config())
    put_loan(_loan("loan-1", "mem-1", 10000, 1000))
    put_member(_member("mem-1", current_shares=1, status=MemberStatus.WITHDRAWN))
    put_member(_member("mem-2", current_shares=1, status=MemberStatus.ACTIVE))

    result = compute_cycle_close(_cycle())

    member_ids_in_dividends = {d.member_id for d in result.dividends}
    assert member_ids_in_dividends == {"mem-2"}


def test_compute_cycle_close_handles_zero_total_shares_without_dividing_by_zero(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config())
    put_member(_member("mem-1", current_shares=0))

    result = compute_cycle_close(_cycle())

    assert result.total_shares_at_close == 0
    assert result.dividends[0].share_based_amount == 0


def test_compute_cycle_close_with_no_qualifying_members_awards_no_top3_bonus(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config(top3_bonus_percentage=0.1))
    put_member(_member("mem-1", current_shares=1))

    result = compute_cycle_close(_cycle())

    assert result.top3_bonus_pool == 0
    assert result.dividends[0].rank is None
    assert result.dividends[0].top3_bonus_amount == 0
