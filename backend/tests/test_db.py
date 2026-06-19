import boto3
import pytest
from moto import mock_aws


@pytest.fixture
def dynamodb_users_table(monkeypatch):
    # app/db.py creates its boto3 resource lazily (inside each function call,
    # not at module import time) specifically so this fixture can swap in a
    # moto-mocked AWS environment per-test without import-order issues.
    from app.config import settings

    monkeypatch.setattr(settings, "users_table", "test-users")

    with mock_aws():
        client = boto3.client("dynamodb", region_name="us-east-1")
        client.create_table(
            TableName="test-users",
            AttributeDefinitions=[{"AttributeName": "UserId", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "UserId", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield


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
