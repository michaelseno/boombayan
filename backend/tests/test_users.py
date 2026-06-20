from app.auth import get_current_user_id
from app.db import put_user
from app.main import app
from app.models.user import User


def test_get_me_returns_current_user(client, dynamodb_users_table):
    user = User(user_id="abc123", email="board@boombayan.org", is_administrator=True, member_id="mem-1")
    put_user(user)
    app.dependency_overrides[get_current_user_id] = lambda: "abc123"

    response = client.get("/me")

    del app.dependency_overrides[get_current_user_id]
    assert response.status_code == 200
    assert response.json() == {
        "user_id": "abc123",
        "email": "board@boombayan.org",
        "is_administrator": True,
        "member_id": "mem-1",
    }


def test_get_me_returns_404_when_user_record_missing(client, dynamodb_users_table):
    app.dependency_overrides[get_current_user_id] = lambda: "no-such-user"

    response = client.get("/me")

    del app.dependency_overrides[get_current_user_id]
    assert response.status_code == 404
