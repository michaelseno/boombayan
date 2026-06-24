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


def test_cast_vote_records_approval(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import ApprovalEntry, Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            approvals={
                "admin-1": ApprovalEntry(email="admin@boombayan.org"),
                "board-1": ApprovalEntry(email="board@boombayan.org"),
            },
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/approvals", json={"status": "Approved", "comments": "Looks good"})

    assert response.status_code == 200
    body = response.json()
    assert body["approvals"]["board-1"]["status"] == "Approved"
    assert body["approvals"]["board-1"]["comments"] == "Looks good"
    assert body["approvals"]["board-1"]["date"]
    assert body["status"] == "Pending Board Approval"


def test_cast_vote_completing_unanimous_approval_sets_status_approved_and_approved_amount(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import ApprovalEntry, ApprovalVoteStatus, Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            approvals={
                "admin-1": ApprovalEntry(email="admin@boombayan.org", status=ApprovalVoteStatus.APPROVED),
                "board-1": ApprovalEntry(email="board@boombayan.org"),
            },
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/approvals", json={"status": "Approved"})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "Approved"
    assert body["approved_amount"] == 10000


def test_cast_vote_rejection_sets_status_rejected(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import ApprovalEntry, Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            approvals={
                "admin-1": ApprovalEntry(email="admin@boombayan.org"),
                "board-1": ApprovalEntry(email="board@boombayan.org"),
            },
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/approvals", json={"status": "Rejected", "comments": "Too risky"})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "Rejected"
    assert body["approvals"]["admin-1"]["status"] == "Pending"


def test_cast_vote_rejects_voting_twice(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import ApprovalEntry, ApprovalVoteStatus, Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            approvals={"board-1": ApprovalEntry(email="board@boombayan.org", status=ApprovalVoteStatus.APPROVED)},
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/approvals", json={"status": "Approved"})

    assert response.status_code == 400


def test_cast_vote_rejects_when_loan_not_pending(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import ApprovalEntry, Loan, LoanStatus

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            status=LoanStatus.REJECTED,
            approvals={"board-1": ApprovalEntry(email="board@boombayan.org")},
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/approvals", json={"status": "Approved"})

    assert response.status_code == 400


def test_cast_vote_rejects_for_user_not_in_approvals(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import ApprovalEntry, Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            approvals={"admin-1": ApprovalEntry(email="admin@boombayan.org")},
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/approvals", json={"status": "Approved"})

    assert response.status_code == 403


def test_cast_vote_rejects_pending_as_a_status_value(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import ApprovalEntry, Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            approvals={"board-1": ApprovalEntry(email="board@boombayan.org")},
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/approvals", json={"status": "Pending"})

    assert response.status_code == 422


def test_cast_vote_returns_404_when_loan_missing(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/does-not-exist/approvals", json={"status": "Approved"})

    assert response.status_code == 404


def test_release_loan_computes_interest_and_balance(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table,
    dynamodb_cycles_table,
):
    from app.db import put_loan
    from app.models.loan import Loan, LoanStatus

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000, approved_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            status=LoanStatus.APPROVED,
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/release", json={"release_date": "2026-06-22"})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "Active"
    assert body["release_date"] == "2026-06-22"
    assert body["interest_deduction"] == 500
    assert body["net_release_amount"] == 9500
    assert body["remaining_balance"] == 10000
    assert body["next_due_date"] == "2026-07-22"


def test_release_loan_defaults_release_date_to_today(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table,
    dynamodb_cycles_table,
):
    from app.db import put_loan
    from app.models.loan import Loan, LoanStatus

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000, approved_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            status=LoanStatus.APPROVED,
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/release", json={})

    assert response.status_code == 200
    assert response.json()["release_date"]


def test_release_loan_rejects_when_not_approved(
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
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/release", json={})

    assert response.status_code == 400


def test_release_loan_rejected_for_non_administrator(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import Loan, LoanStatus

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000, approved_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            status=LoanStatus.APPROVED,
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/release", json={})

    assert response.status_code == 403


def test_release_loan_returns_404_when_missing(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/does-not-exist/release", json={})

    assert response.status_code == 404


def test_release_loan_stamps_current_open_cycle_id(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table,
    dynamodb_cycles_table,
):
    from app.db import put_cycle, put_loan
    from app.models.cycle import Cycle, CycleStatus
    from app.models.loan import Loan, LoanStatus

    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000, approved_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            status=LoanStatus.APPROVED,
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/release", json={"release_date": "2026-06-22"})

    assert response.json()["cycle_id"] == "cycle-1"


def test_release_loan_leaves_cycle_id_null_when_no_cycle_is_open(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table,
    dynamodb_cycles_table,
):
    from app.db import put_loan
    from app.models.loan import Loan, LoanStatus

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000, approved_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            status=LoanStatus.APPROVED,
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/release", json={"release_date": "2026-06-22"})

    assert response.json()["cycle_id"] is None
