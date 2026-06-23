from datetime import date, timedelta

from app.db import get_loan_by_id, list_transactions_for_loan, put_config, put_loan
from app.models.config import Config
from app.models.loan import Loan, LoanStatus


def _put_active_loan(loan_id="loan-1", remaining_balance=10000.0, next_due_date=None, penalty_charged_for_current_cycle=False):
    put_loan(
        Loan(
            loan_id=loan_id,
            member_id="mem-1",
            requested_amount=10000,
            approved_amount=10000,
            repayment_interval_days=30,
            interest_rate=0.05,
            application_date="2026-05-01",
            status=LoanStatus.ACTIVE,
            release_date="2026-05-01",
            interest_deduction=500,
            net_release_amount=9500,
            remaining_balance=remaining_balance,
            next_due_date=next_due_date or date.today().isoformat(),
            penalty_charged_for_current_cycle=penalty_charged_for_current_cycle,
        )
    )


def test_run_penalty_check_charges_penalty_past_grace_period(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table, dynamodb_cycles_table
):
    from app.penalty_engine import run_penalty_check

    put_config(Config(penalty_rate=0.02, penalty_grace_period_hours=0))
    overdue_date = (date.today() - timedelta(days=2)).isoformat()
    _put_active_loan(remaining_balance=10000.0, next_due_date=overdue_date)

    charged = run_penalty_check()

    assert charged == 1
    loan = get_loan_by_id("loan-1")
    assert loan.remaining_balance == 10200.0
    assert loan.penalty_charged_for_current_cycle is True


def test_run_penalty_check_records_a_penalty_transaction(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table, dynamodb_cycles_table
):
    from app.penalty_engine import run_penalty_check

    put_config(Config(penalty_rate=0.02, penalty_grace_period_hours=0))
    overdue_date = (date.today() - timedelta(days=2)).isoformat()
    _put_active_loan(remaining_balance=10000.0, next_due_date=overdue_date)

    run_penalty_check()

    transactions = list_transactions_for_loan("loan-1")
    assert len(transactions) == 1
    assert transactions[0].type.value == "PENALTY"
    assert transactions[0].amount == 200.0
    assert transactions[0].remaining_balance_after == 10200.0
    assert transactions[0].recorded_by is None


def test_run_penalty_check_skips_before_grace_period_elapses(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table
):
    from app.penalty_engine import run_penalty_check

    put_config(Config(penalty_rate=0.02, penalty_grace_period_hours=24))
    due_today = date.today().isoformat()
    _put_active_loan(remaining_balance=10000.0, next_due_date=due_today)

    charged = run_penalty_check()

    assert charged == 0
    assert get_loan_by_id("loan-1").remaining_balance == 10000.0


def test_run_penalty_check_skips_when_already_charged_for_current_cycle(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table
):
    from app.penalty_engine import run_penalty_check

    put_config(Config(penalty_rate=0.02, penalty_grace_period_hours=0))
    overdue_date = (date.today() - timedelta(days=2)).isoformat()
    _put_active_loan(remaining_balance=10000.0, next_due_date=overdue_date, penalty_charged_for_current_cycle=True)

    charged = run_penalty_check()

    assert charged == 0
    assert get_loan_by_id("loan-1").remaining_balance == 10000.0


def test_run_penalty_check_skips_when_penalty_rate_is_zero(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table
):
    from app.penalty_engine import run_penalty_check

    put_config(Config(penalty_rate=0, penalty_grace_period_hours=0))
    overdue_date = (date.today() - timedelta(days=2)).isoformat()
    _put_active_loan(remaining_balance=10000.0, next_due_date=overdue_date)

    charged = run_penalty_check()

    assert charged == 0
    assert get_loan_by_id("loan-1").remaining_balance == 10000.0


def test_run_penalty_check_skips_non_active_loans(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table
):
    from app.penalty_engine import run_penalty_check

    put_config(Config(penalty_rate=0.02, penalty_grace_period_hours=0))
    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-05-01",
            status=LoanStatus.REJECTED,
        )
    )

    charged = run_penalty_check()

    assert charged == 0


def test_run_penalty_check_processes_multiple_loans_independently(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table, dynamodb_cycles_table
):
    from app.penalty_engine import run_penalty_check

    put_config(Config(penalty_rate=0.02, penalty_grace_period_hours=0))
    overdue_date = (date.today() - timedelta(days=2)).isoformat()
    not_due_date = (date.today() + timedelta(days=5)).isoformat()
    _put_active_loan(loan_id="loan-1", remaining_balance=10000.0, next_due_date=overdue_date)
    _put_active_loan(loan_id="loan-2", remaining_balance=5000.0, next_due_date=not_due_date)

    charged = run_penalty_check()

    assert charged == 1
    assert get_loan_by_id("loan-1").remaining_balance == 10200.0
    assert get_loan_by_id("loan-2").remaining_balance == 5000.0


def test_run_penalty_check_stamps_current_open_cycle_id_on_penalty_transaction(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table, dynamodb_cycles_table
):
    from app.db import list_transactions_for_loan, put_cycle
    from app.models.cycle import Cycle, CycleStatus
    from app.penalty_engine import run_penalty_check

    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    put_config(Config(penalty_rate=0.02, penalty_grace_period_hours=0))
    overdue_date = (date.today() - timedelta(days=2)).isoformat()
    _put_active_loan(remaining_balance=10000.0, next_due_date=overdue_date)

    run_penalty_check()

    transactions = list_transactions_for_loan("loan-1")
    assert transactions[0].cycle_id == "cycle-1"


def test_run_penalty_check_leaves_transaction_cycle_id_null_when_no_cycle_is_open(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table, dynamodb_cycles_table
):
    from app.db import list_transactions_for_loan
    from app.penalty_engine import run_penalty_check

    put_config(Config(penalty_rate=0.02, penalty_grace_period_hours=0))
    overdue_date = (date.today() - timedelta(days=2)).isoformat()
    _put_active_loan(remaining_balance=10000.0, next_due_date=overdue_date)

    run_penalty_check()

    transactions = list_transactions_for_loan("loan-1")
    assert transactions[0].cycle_id is None
