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


@pytest.fixture
def dynamodb_members_table(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "members_table", "test-members")

    with mock_aws():
        dynamo_client = boto3.client("dynamodb", region_name="us-east-1")
        dynamo_client.create_table(
            TableName="test-members",
            AttributeDefinitions=[{"AttributeName": "MemberId", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "MemberId", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield


@pytest.fixture
def dynamodb_config_table(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "config_table", "test-config")

    with mock_aws():
        dynamo_client = boto3.client("dynamodb", region_name="us-east-1")
        dynamo_client.create_table(
            TableName="test-config",
            AttributeDefinitions=[{"AttributeName": "ConfigKey", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "ConfigKey", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield


@pytest.fixture
def dynamodb_loans_table(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "loans_table", "test-loans")

    with mock_aws():
        dynamo_client = boto3.client("dynamodb", region_name="us-east-1")
        dynamo_client.create_table(
            TableName="test-loans",
            AttributeDefinitions=[{"AttributeName": "LoanId", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "LoanId", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield


@pytest.fixture
def dynamodb_transactions_table(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "transactions_table", "test-transactions")

    with mock_aws():
        dynamo_client = boto3.client("dynamodb", region_name="us-east-1")
        dynamo_client.create_table(
            TableName="test-transactions",
            AttributeDefinitions=[
                {"AttributeName": "LoanId", "AttributeType": "S"},
                {"AttributeName": "Timestamp", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "LoanId", "KeyType": "HASH"},
                {"AttributeName": "Timestamp", "KeyType": "RANGE"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        yield


@pytest.fixture
def dynamodb_cycles_table(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "cycles_table", "test-cycles")

    with mock_aws():
        dynamo_client = boto3.client("dynamodb", region_name="us-east-1")
        dynamo_client.create_table(
            TableName="test-cycles",
            AttributeDefinitions=[{"AttributeName": "CycleId", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "CycleId", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield


@pytest.fixture
def dynamodb_dividends_table(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "dividends_table", "test-dividends")

    with mock_aws():
        dynamo_client = boto3.client("dynamodb", region_name="us-east-1")
        dynamo_client.create_table(
            TableName="test-dividends",
            AttributeDefinitions=[
                {"AttributeName": "CycleId", "AttributeType": "S"},
                {"AttributeName": "MemberId", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "CycleId", "KeyType": "HASH"},
                {"AttributeName": "MemberId", "KeyType": "RANGE"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        yield
