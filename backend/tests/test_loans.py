from app.auth import get_current_user_id
from app.db import put_config, put_member, put_user
from app.models.config import Config
from app.models.member import Member, MemberStatus
from app.models.user import User
from app.main import app


def _put_active_member(member_id="mem-1", current_capital_amount=0.0):
    put_member(
        Member(
            member_id=member_id, first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
            current_capital_amount=current_capital_amount,
        )
    )


def test_create_loan_succeeds_for_administrator(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    _put_active_member(current_capital_amount=20000)
    put_config(Config(default_interest_rate=0.05))
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/loans",
        json={"member_id": "mem-1", "requested_amount": 10000, "repayment_interval_days": 30},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["member_id"] == "mem-1"
    assert body["requested_amount"] == 10000
    assert body["approved_amount"] is None
    assert body["interest_rate"] == 0.05
    assert body["status"] == "Pending Board Approval"
    assert body["is_exception_case"] is False
    assert body["loan_id"]


def test_create_loan_snapshots_approvals_for_all_current_users(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    _put_active_member(current_capital_amount=20000)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(admin)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/loans",
        json={"member_id": "mem-1", "requested_amount": 10000, "repayment_interval_days": 30},
    )

    approvals = response.json()["approvals"]
    assert set(approvals.keys()) == {"admin-1", "board-1"}
    assert approvals["admin-1"] == {"email": "admin@boombayan.org", "status": "Pending", "date": None, "comments": None}


def test_create_loan_flags_exception_case_when_requested_amount_exceeds_capital(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    _put_active_member(current_capital_amount=5000)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/loans",
        json={"member_id": "mem-1", "requested_amount": 10000, "repayment_interval_days": 30},
    )

    assert response.json()["is_exception_case"] is True


def test_create_loan_rejected_for_non_administrator(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    _put_active_member(current_capital_amount=20000)
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post(
        "/loans",
        json={"member_id": "mem-1", "requested_amount": 10000, "repayment_interval_days": 30},
    )

    assert response.status_code == 403


def test_create_loan_rejects_when_member_not_found(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/loans",
        json={"member_id": "does-not-exist", "requested_amount": 10000, "repayment_interval_days": 30},
    )

    assert response.status_code == 404


def test_create_loan_rejects_when_member_not_active(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
            status=MemberStatus.WITHDRAWN, current_capital_amount=20000,
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/loans",
        json={"member_id": "mem-1", "requested_amount": 10000, "repayment_interval_days": 30},
    )

    assert response.status_code == 400


def test_create_loan_rejects_non_positive_requested_amount(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    _put_active_member(current_capital_amount=20000)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/loans",
        json={"member_id": "mem-1", "requested_amount": 0, "repayment_interval_days": 30},
    )

    assert response.status_code == 422


def test_list_loans_returns_all_loans_for_any_authenticated_user(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/loans")

    assert response.status_code == 200
    assert len(response.json()) == 1


def test_list_loans_filters_by_member_id(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
        )
    )
    put_loan(
        Loan(
            loan_id="loan-2", member_id="mem-2", requested_amount=5000,
            repayment_interval_days=15, interest_rate=0.05, application_date="2026-06-22",
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/loans", params={"member_id": "mem-2"})

    assert response.status_code == 200
    assert [loan["loan_id"] for loan in response.json()] == ["loan-2"]


def test_list_loans_filters_by_status(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import Loan, LoanStatus

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            status=LoanStatus.REJECTED,
        )
    )
    put_loan(
        Loan(
            loan_id="loan-2", member_id="mem-2", requested_amount=5000,
            repayment_interval_days=15, interest_rate=0.05, application_date="2026-06-22",
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/loans", params={"status": "Rejected"})

    assert response.status_code == 200
    assert [loan["loan_id"] for loan in response.json()] == ["loan-1"]


def test_get_loan_returns_loan_for_any_authenticated_user(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/loans/loan-1")

    assert response.status_code == 200
    assert response.json()["member_id"] == "mem-1"


def test_get_loan_returns_404_when_missing(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/loans/does-not-exist")

    assert response.status_code == 404
