import jwt
import pytest
from fastapi import HTTPException

from app.auth import get_current_user, get_current_user_id, require_admin
from app.db import put_user
from app.models.user import User


def test_get_current_user_id_returns_sub_for_valid_token(monkeypatch):
    monkeypatch.setattr(
        "app.auth.decode_token",
        lambda token: {"sub": "user-123", "token_use": "id"},
    )
    user_id = get_current_user_id(authorization="Bearer faketoken")
    assert user_id == "user-123"


def test_get_current_user_id_rejects_missing_bearer_scheme():
    with pytest.raises(HTTPException) as exc_info:
        get_current_user_id(authorization="faketoken")
    assert exc_info.value.status_code == 401


def test_get_current_user_id_rejects_invalid_token(monkeypatch):
    def raise_invalid(token):
        raise jwt.InvalidTokenError("bad token")

    monkeypatch.setattr("app.auth.decode_token", raise_invalid)
    with pytest.raises(HTTPException) as exc_info:
        get_current_user_id(authorization="Bearer faketoken")
    assert exc_info.value.status_code == 401


def test_get_current_user_returns_user_when_found(dynamodb_users_table):
    put_user(User(user_id="abc123", email="board@boombayan.org", is_administrator=False))

    user = get_current_user(user_id="abc123")

    assert user.email == "board@boombayan.org"


def test_get_current_user_raises_404_when_missing(dynamodb_users_table):
    with pytest.raises(HTTPException) as exc_info:
        get_current_user(user_id="no-such-user")
    assert exc_info.value.status_code == 404


def test_require_admin_passes_through_administrator():
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)

    result = require_admin(user=admin)

    assert result == admin


def test_require_admin_rejects_non_administrator():
    member = User(user_id="member-1", email="member@boombayan.org", is_administrator=False)

    with pytest.raises(HTTPException) as exc_info:
        require_admin(user=member)
    assert exc_info.value.status_code == 403
