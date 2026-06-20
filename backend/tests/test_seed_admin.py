import sys

import boto3
import pytest
from moto import mock_aws


@pytest.fixture
def cognito_user_pool(monkeypatch):
    from app.config import settings

    with mock_aws():
        client = boto3.client("cognito-idp", region_name="us-east-1")
        pool = client.create_user_pool(PoolName="test-pool")
        pool_id = pool["UserPool"]["Id"]
        app_client = client.create_user_pool_client(UserPoolId=pool_id, ClientName="test-client")
        monkeypatch.setattr(settings, "cognito_user_pool_id", pool_id)
        monkeypatch.setattr(settings, "cognito_client_id", app_client["UserPoolClient"]["ClientId"])
        yield pool_id


def test_create_cognito_user_returns_sub(cognito_user_pool):
    from scripts.seed_admin import create_cognito_user

    user_id = create_cognito_user("board@boombayan.org", "TempPass123!")
    assert user_id


def test_create_cognito_user_leaves_force_change_password_status(cognito_user_pool):
    from scripts.seed_admin import create_cognito_user

    create_cognito_user("board@boombayan.org", "TempPass123!")

    client = boto3.client("cognito-idp", region_name="us-east-1")
    response = client.admin_get_user(UserPoolId=cognito_user_pool, Username="board@boombayan.org")
    assert response["UserStatus"] == "FORCE_CHANGE_PASSWORD"


def test_create_cognito_user_is_idempotent_on_existing_email(cognito_user_pool):
    from scripts.seed_admin import create_cognito_user

    first_user_id = create_cognito_user("board@boombayan.org", "TempPass123!")
    second_user_id = create_cognito_user("board@boombayan.org", "AnotherTempPass123!")

    assert first_user_id == second_user_id


def test_main_creates_cognito_user_and_users_table_record(
    cognito_user_pool, dynamodb_users_table, monkeypatch, capsys
):
    from app.db import get_users_table
    from scripts.seed_admin import main

    monkeypatch.setattr(
        sys,
        "argv",
        ["seed_admin.py", "--email", "board@boombayan.org", "--temporary-password", "TempPass123!"],
    )
    main()

    captured = capsys.readouterr()
    assert "Created admin user board@boombayan.org" in captured.out

    items = get_users_table().scan()["Items"]
    assert len(items) == 1
    assert items[0]["Email"] == "board@boombayan.org"
    assert items[0]["IsAdministrator"] is True
