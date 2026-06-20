from app.auth import get_current_user_id
from app.db import put_user
from app.main import app
from app.models.user import User


def test_read_config_returns_defaults_for_any_authenticated_user(
    client, dynamodb_users_table, dynamodb_config_table
):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/config")

    assert response.status_code == 200
    assert response.json() == {"share_value": 0, "max_shares_per_member": 5}


def test_update_config_succeeds_for_administrator(client, dynamodb_users_table, dynamodb_config_table):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.put("/config", json={"share_value": 500, "max_shares_per_member": 5})

    assert response.status_code == 200
    assert response.json() == {"share_value": 500, "max_shares_per_member": 5}


def test_update_config_partial_update_preserves_other_field(
    client, dynamodb_users_table, dynamodb_config_table
):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    client.put("/config", json={"share_value": 500, "max_shares_per_member": 10})
    response = client.put("/config", json={"share_value": 600})

    assert response.status_code == 200
    assert response.json() == {"share_value": 600, "max_shares_per_member": 10}


def test_update_config_rejected_for_non_administrator(client, dynamodb_users_table, dynamodb_config_table):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.put("/config", json={"share_value": 500})

    assert response.status_code == 403
