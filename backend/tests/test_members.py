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
