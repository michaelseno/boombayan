from datetime import date, datetime, time, timedelta, timezone
from uuid import uuid4

from .db import get_config, list_loans, put_loan, put_transaction
from .models.loan import LoanStatus
from .models.transaction import Transaction, TransactionType


def run_penalty_check() -> int:
    config = get_config()
    if config.penalty_rate <= 0:
        return 0

    now = datetime.now(timezone.utc)
    charged_count = 0
    for loan in list_loans():
        if loan.status != LoanStatus.ACTIVE:
            continue
        if loan.penalty_charged_for_current_cycle:
            continue

        # NextDueDate is a date-only string, so it's anchored to midnight
        # (00:00 UTC) of that calendar day before the grace period is added.
        due_midnight = datetime.combine(date.fromisoformat(loan.next_due_date), time.min, tzinfo=timezone.utc)
        due_with_grace = due_midnight + timedelta(hours=config.penalty_grace_period_hours)
        if now <= due_with_grace:
            continue

        penalty = loan.remaining_balance * config.penalty_rate
        loan.remaining_balance += penalty
        loan.penalty_charged_for_current_cycle = True
        put_loan(loan)

        put_transaction(
            Transaction(
                transaction_id=str(uuid4()),
                loan_id=loan.loan_id,
                timestamp=now.isoformat(),
                type=TransactionType.PENALTY,
                amount=penalty,
                remaining_balance_after=loan.remaining_balance,
                recorded_by=None,
                notes=None,
            )
        )
        charged_count += 1

    return charged_count
