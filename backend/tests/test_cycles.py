from app.auth import get_current_user_id
from app.db import get_cycle_by_id, put_cycle, put_user
from app.main import app
from app.models.cycle import Cycle, CycleStatus
from app.models.user import User


def test_open_cycle_succeeds_for_administrator(client, dynamodb_users_table, dynamodb_cycles_table):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/cycles", json={"start_date": "2026-01-01"})

    assert response.status_code == 201
    body = response.json()
    assert body["start_date"] == "2026-01-01"
    assert body["status"] == "Open"
    assert body["end_date"] is None


def test_open_cycle_defaults_start_date_to_today(client, dynamodb_users_table, dynamodb_cycles_table):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/cycles", json={})

    assert response.status_code == 201
    assert response.json()["start_date"]


def test_open_cycle_rejects_when_a_cycle_is_already_open(client, dynamodb_users_table, dynamodb_cycles_table):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/cycles", json={"start_date": "2026-02-01"})

    assert response.status_code == 400


def test_open_cycle_allowed_after_the_previous_cycle_is_closed(client, dynamodb_users_table, dynamodb_cycles_table):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", end_date="2026-06-01", status=CycleStatus.CLOSED))
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/cycles", json={"start_date": "2026-06-02"})

    assert response.status_code == 201


def test_open_cycle_rejected_for_non_administrator(client, dynamodb_users_table, dynamodb_cycles_table):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/cycles", json={})

    assert response.status_code == 403


def test_list_cycles_returns_all_cycles_for_any_authenticated_user(
    client, dynamodb_users_table, dynamodb_cycles_table
):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.CLOSED))
    put_cycle(Cycle(cycle_id="cycle-2", start_date="2026-06-02", status=CycleStatus.OPEN))
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/cycles")

    assert response.status_code == 200
    assert {c["cycle_id"] for c in response.json()} == {"cycle-1", "cycle-2"}


def test_get_cycle_returns_cycle_for_any_authenticated_user(client, dynamodb_users_table, dynamodb_cycles_table):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/cycles/cycle-1")

    assert response.status_code == 200
    assert response.json()["cycle_id"] == "cycle-1"


def test_get_cycle_returns_404_when_missing(client, dynamodb_users_table, dynamodb_cycles_table):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/cycles/does-not-exist")

    assert response.status_code == 404


def test_preview_close_cycle_returns_computed_totals_without_persisting(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_loans_table, dynamodb_members_table,
    dynamodb_transactions_table, dynamodb_config_table, dynamodb_dividends_table,
):
    from app.db import list_dividends_for_cycle, put_loan, put_member
    from app.models.loan import Loan, LoanStatus
    from app.models.member import Member

    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000, approved_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-01-10",
            status=LoanStatus.ACTIVE, release_date="2026-01-10", interest_deduction=500,
            net_release_amount=9500, remaining_balance=10000, next_due_date="2026-02-09",
            cycle_id="cycle-1",
        )
    )
    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes", email="ana@example.com",
            phone="1", date_joined="2026-01-01", current_shares=2,
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.get("/cycles/cycle-1/preview-close")

    assert response.status_code == 200
    body = response.json()
    assert body["total_interest_earned"] == 500
    assert body["dividends"][0]["member_id"] == "mem-1"
    assert get_cycle_by_id("cycle-1").status == CycleStatus.OPEN
    assert list_dividends_for_cycle("cycle-1") == []


def test_preview_close_cycle_rejects_when_cycle_not_open(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_loans_table, dynamodb_members_table,
    dynamodb_transactions_table, dynamodb_config_table,
):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", end_date="2026-06-01", status=CycleStatus.CLOSED))
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.get("/cycles/cycle-1/preview-close")

    assert response.status_code == 400


def test_preview_close_cycle_rejected_for_non_administrator(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_loans_table, dynamodb_members_table,
    dynamodb_transactions_table, dynamodb_config_table,
):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/cycles/cycle-1/preview-close")

    assert response.status_code == 403


def test_close_cycle_persists_totals_and_dividends(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_loans_table, dynamodb_members_table,
    dynamodb_transactions_table, dynamodb_config_table, dynamodb_dividends_table,
):
    from app.db import list_dividends_for_cycle, put_loan, put_member
    from app.models.loan import Loan, LoanStatus
    from app.models.member import Member

    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000, approved_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-01-10",
            status=LoanStatus.ACTIVE, release_date="2026-01-10", interest_deduction=500,
            net_release_amount=9500, remaining_balance=10000, next_due_date="2026-02-09",
            cycle_id="cycle-1",
        )
    )
    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes", email="ana@example.com",
            phone="1", date_joined="2026-01-01", current_shares=2,
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/cycles/cycle-1/close", json={"end_date": "2026-06-30"})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "Closed"
    assert body["end_date"] == "2026-06-30"
    assert body["total_interest_earned"] == 500
    assert body["closed_at"]

    dividends = list_dividends_for_cycle("cycle-1")
    assert len(dividends) == 1
    assert dividends[0].member_id == "mem-1"
    assert dividends[0].total_amount == 500


def test_close_cycle_rejects_when_cycle_not_open(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_loans_table, dynamodb_members_table,
    dynamodb_transactions_table, dynamodb_config_table,
):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", end_date="2026-06-01", status=CycleStatus.CLOSED))
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/cycles/cycle-1/close", json={})

    assert response.status_code == 400


def test_close_cycle_rejected_for_non_administrator(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_loans_table, dynamodb_members_table,
    dynamodb_transactions_table, dynamodb_config_table,
):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/cycles/cycle-1/close", json={})

    assert response.status_code == 403


def test_close_cycle_returns_404_when_missing(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_loans_table, dynamodb_members_table,
    dynamodb_transactions_table, dynamodb_config_table,
):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/cycles/does-not-exist/close", json={})

    assert response.status_code == 404


def test_get_cycle_dividends_returns_empty_list_for_open_cycle(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_dividends_table
):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/cycles/cycle-1/dividends")

    assert response.status_code == 200
    assert response.json() == []


def test_get_cycle_dividends_returns_persisted_dividends_after_close(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_loans_table, dynamodb_members_table,
    dynamodb_transactions_table, dynamodb_config_table, dynamodb_dividends_table,
):
    from app.db import put_loan, put_member
    from app.models.loan import Loan, LoanStatus
    from app.models.member import Member

    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000, approved_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-01-10",
            status=LoanStatus.ACTIVE, release_date="2026-01-10", interest_deduction=500,
            net_release_amount=9500, remaining_balance=10000, next_due_date="2026-02-09",
            cycle_id="cycle-1",
        )
    )
    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes", email="ana@example.com",
            phone="1", date_joined="2026-01-01", current_shares=2,
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"
    client.post("/cycles/cycle-1/close", json={"end_date": "2026-06-30"})

    response = client.get("/cycles/cycle-1/dividends")

    assert response.status_code == 200
    assert response.json()[0]["member_id"] == "mem-1"
