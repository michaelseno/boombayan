import boto3
import pytest
from fastapi.testclient import TestClient
from moto import mock_aws

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clear_dependency_overrides():
    # app.dependency_overrides is a single app-global dict, not per-test —
    # without this, a test that overrides a dependency and raises before its
    # own `del` cleanup would leak that override into every later test.
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def dynamodb_users_table(monkeypatch):
    # app/db.py creates its boto3 resource lazily (inside each function call,
    # not at module import time) specifically so this fixture can swap in a
    # moto-mocked AWS environment per-test without import-order issues.
    from app.config import settings

    monkeypatch.setattr(settings, "users_table", "test-users")

    with mock_aws():
        dynamo_client = boto3.client("dynamodb", region_name="us-east-1")
        dynamo_client.create_table(
            TableName="test-users",
            AttributeDefinitions=[{"AttributeName": "UserId", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "UserId", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield
