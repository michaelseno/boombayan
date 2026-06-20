from app.auth import get_current_user_id
from app.db import put_user
from app.main import app
from app.models.user import User


def test_create_member_succeeds_for_administrator(client, dynamodb_users_table, dynamodb_members_table):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/members",
        json={
            "first_name": "Ana",
            "last_name": "Reyes",
            "email": "ana@example.com",
            "phone": "09171234567",
            "date_joined": "2026-01-15",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["first_name"] == "Ana"
    assert body["status"] == "Active"
    assert body["current_shares"] == 0
    assert body["member_id"]


def test_create_member_defaults_date_joined_to_today(client, dynamodb_users_table, dynamodb_members_table):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/members",
        json={"first_name": "Ana", "last_name": "Reyes", "email": "ana@example.com", "phone": "1"},
    )

    assert response.status_code == 201
    assert response.json()["date_joined"]


def test_create_member_rejected_for_non_administrator(client, dynamodb_users_table):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post(
        "/members",
        json={"first_name": "Ana", "last_name": "Reyes", "email": "ana@example.com", "phone": "1"},
    )

    assert response.status_code == 403


def test_list_members_returns_all_members_for_any_authenticated_user(
    client, dynamodb_users_table, dynamodb_members_table
):
    from app.db import put_member
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/members")

    assert response.status_code == 200
    assert len(response.json()) == 1


def test_get_member_returns_member_for_any_authenticated_user(
    client, dynamodb_users_table, dynamodb_members_table
):
    from app.db import put_member
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/members/mem-1")

    assert response.status_code == 200
    assert response.json()["first_name"] == "Ana"


def test_get_member_returns_404_when_missing(client, dynamodb_users_table, dynamodb_members_table):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/members/does-not-exist")

    assert response.status_code == 404


def test_update_member_succeeds_for_administrator(client, dynamodb_users_table, dynamodb_members_table):
    from app.db import put_member
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.put("/members/mem-1", json={"status": "Withdrawn"})

    assert response.status_code == 200
    assert response.json()["status"] == "Withdrawn"
    assert response.json()["first_name"] == "Ana"


def test_update_member_rejected_for_non_administrator(client, dynamodb_users_table, dynamodb_members_table):
    from app.db import put_member
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.put("/members/mem-1", json={"status": "Withdrawn"})

    assert response.status_code == 403


def test_update_member_returns_404_when_missing(client, dynamodb_users_table, dynamodb_members_table):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.put("/members/does-not-exist", json={"status": "Withdrawn"})

    assert response.status_code == 404


def test_purchase_shares_updates_totals_and_history(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table
):
    from app.db import put_config, put_member
    from app.models.config import Config
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
        )
    )
    put_config(Config(share_value=500, max_shares_per_member=5))
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/members/mem-1/shares", json={"shares_purchased": 2})

    assert response.status_code == 200
    body = response.json()
    assert body["current_shares"] == 2
    assert body["current_capital_amount"] == 1000
    assert len(body["share_history"]) == 1
    assert body["share_history"][0]["share_value_at_purchase"] == 500
    assert body["share_history"][0]["cycle_id"] is None


def test_purchase_shares_rejects_when_exceeding_cap(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table
):
    from app.db import put_config, put_member
    from app.models.config import Config
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15", current_shares=4,
        )
    )
    put_config(Config(share_value=500, max_shares_per_member=5))
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/members/mem-1/shares", json={"shares_purchased": 2})

    assert response.status_code == 400


def test_purchase_shares_rejects_when_share_value_not_configured(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table
):
    from app.db import put_member
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/members/mem-1/shares", json={"shares_purchased": 2})

    assert response.status_code == 400


def test_purchase_shares_rejects_non_positive_amount(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table
):
    from app.db import put_config, put_member
    from app.models.config import Config
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
        )
    )
    put_config(Config(share_value=500, max_shares_per_member=5))
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/members/mem-1/shares", json={"shares_purchased": 0})

    assert response.status_code == 422


def test_purchase_shares_rejected_for_non_administrator(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table
):
    from app.db import put_member
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/members/mem-1/shares", json={"shares_purchased": 2})

    assert response.status_code == 403
