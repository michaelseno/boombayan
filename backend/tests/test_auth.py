import jwt
import pytest
from fastapi import HTTPException

from app.auth import get_current_user_id


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
