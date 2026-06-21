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
