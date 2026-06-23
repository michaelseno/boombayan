from app.auth import get_current_user_id
from app.db import put_loan, put_user
from app.main import app
from app.models.loan import Loan, LoanStatus
from app.models.user import User


def _put_active_loan(loan_id="loan-1", remaining_balance=10000.0, next_due_date=None, penalty_charged_for_current_cycle=False):
    put_loan(
        Loan(
            loan_id=loan_id,
            member_id="mem-1",
            requested_amount=10000,
            approved_amount=10000,
            repayment_interval_days=30,
            interest_rate=0.05,
            application_date="2026-06-21",
            status=LoanStatus.ACTIVE,
            release_date="2026-06-21",
            interest_deduction=500,
            net_release_amount=9500,
            remaining_balance=remaining_balance,
            next_due_date=next_due_date or "2026-07-21",
            penalty_charged_for_current_cycle=penalty_charged_for_current_cycle,
        )
    )


def test_record_payment_reduces_remaining_balance_and_advances_due_date(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table, dynamodb_cycles_table
):
    _put_active_loan(remaining_balance=10000.0)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/loans/loan-1/payments",
        json={"amount": 3000, "payment_date": "2026-07-21"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["remaining_balance"] == 7000
    assert body["next_due_date"] == "2026-08-20"
    assert body["status"] == "Active"
    assert body["penalty_charged_for_current_cycle"] is False


def test_record_payment_records_a_transaction(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table, dynamodb_cycles_table
):
    _put_active_loan(remaining_balance=10000.0)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    client.post("/loans/loan-1/payments", json={"amount": 3000, "notes": "First installment"})

    from app.db import list_transactions_for_loan

    transactions = list_transactions_for_loan("loan-1")
    assert len(transactions) == 1
    assert transactions[0].type.value == "PAYMENT"
    assert transactions[0].amount == 3000
    assert transactions[0].remaining_balance_after == 7000
    assert transactions[0].recorded_by == "admin-1"
    assert transactions[0].notes == "First installment"


def test_record_payment_completes_loan_when_balance_reaches_zero(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table, dynamodb_cycles_table
):
    _put_active_loan(remaining_balance=5000.0)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/payments", json={"amount": 5000})

    assert response.status_code == 200
    assert response.json()["status"] == "Completed"
    assert response.json()["remaining_balance"] == 0


def test_record_payment_resets_penalty_charged_flag(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table, dynamodb_cycles_table
):
    _put_active_loan(remaining_balance=10000.0, penalty_charged_for_current_cycle=True)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/payments", json={"amount": 1000})

    assert response.json()["penalty_charged_for_current_cycle"] is False


def test_record_payment_rejects_overpayment(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    _put_active_loan(remaining_balance=5000.0)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/payments", json={"amount": 5001})

    assert response.status_code == 400


def test_record_payment_rejects_when_loan_not_active(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/payments", json={"amount": 1000})

    assert response.status_code == 400


def test_record_payment_rejected_for_non_administrator(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    _put_active_loan()
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/payments", json={"amount": 1000})

    assert response.status_code == 403


def test_record_payment_returns_404_when_loan_missing(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/does-not-exist/payments", json={"amount": 1000})

    assert response.status_code == 404


def test_record_payment_rejects_non_positive_amount(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    _put_active_loan()
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/payments", json={"amount": 0})

    assert response.status_code == 422


def test_list_transactions_returns_empty_list_for_loan_with_no_payments(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    _put_active_loan()
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/loans/loan-1/transactions")

    assert response.status_code == 200
    assert response.json() == []


def test_list_transactions_returns_404_when_loan_missing(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/loans/does-not-exist/transactions")

    assert response.status_code == 404


def test_list_transactions_returns_oldest_first(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table, dynamodb_cycles_table
):
    _put_active_loan(remaining_balance=10000.0)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    client.post("/loans/loan-1/payments", json={"amount": 1000})
    client.post("/loans/loan-1/payments", json={"amount": 2000})

    response = client.get("/loans/loan-1/transactions")
    amounts = [t["amount"] for t in response.json()]
    assert amounts == [1000, 2000]


def test_record_payment_stamps_current_open_cycle_id(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table, dynamodb_cycles_table
):
    from app.db import list_transactions_for_loan, put_cycle
    from app.models.cycle import Cycle, CycleStatus

    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    _put_active_loan(remaining_balance=10000.0)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    client.post("/loans/loan-1/payments", json={"amount": 3000})

    transactions = list_transactions_for_loan("loan-1")
    assert transactions[0].cycle_id == "cycle-1"


def test_record_payment_leaves_transaction_cycle_id_null_when_no_cycle_is_open(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table, dynamodb_cycles_table
):
    from app.db import list_transactions_for_loan

    _put_active_loan(remaining_balance=10000.0)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    client.post("/loans/loan-1/payments", json={"amount": 3000})

    transactions = list_transactions_for_loan("loan-1")
    assert transactions[0].cycle_id is None
