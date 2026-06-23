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
