def test_put_and_get_user_roundtrip(dynamodb_users_table):
    from app.db import get_user_by_id, put_user
    from app.models.user import User

    user = User(user_id="abc123", email="board@boombayan.org", is_administrator=True, member_id="mem-1")
    put_user(user)

    fetched = get_user_by_id("abc123")
    assert fetched == user


def test_get_user_by_id_returns_none_when_missing(dynamodb_users_table):
    from app.db import get_user_by_id

    assert get_user_by_id("does-not-exist") is None
