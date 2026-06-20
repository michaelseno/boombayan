"""Creates the first board administrator: a Cognito user (with a temporary
password the board member must change on first login) plus a matching
Users-table record.

Usage (run from the backend/ directory, as a module so `app` is importable — see Step 1):
    python -m scripts.seed_admin --email board@boombayan.org --temporary-password 'TempPass123!'
"""

import argparse

import boto3

from app.config import settings
from app.db import put_user
from app.models.user import User


def create_cognito_user(email: str, temporary_password: str) -> str:
    client = boto3.client("cognito-idp", region_name=settings.aws_region)
    try:
        client.admin_create_user(
            UserPoolId=settings.cognito_user_pool_id,
            Username=email,
            UserAttributes=[
                {"Name": "email", "Value": email},
                {"Name": "email_verified", "Value": "true"},
            ],
            TemporaryPassword=temporary_password,
            MessageAction="SUPPRESS",
        )
    except client.exceptions.UsernameExistsException:
        # Re-running for the same email (e.g. recovering from a prior partial
        # failure, where Cognito creation succeeded but put_user below did
        # not) is safe: skip creation and fall through to fetch the existing
        # user's sub.
        pass
    # Deliberately left in FORCE_CHANGE_PASSWORD state: the board member sets
    # their own permanent password on first login via Cognito's
    # NEW_PASSWORD_REQUIRED challenge (handled by the frontend's login()
    # function, Task 12, and LoginPage, Task 15). The admin running this
    # script never learns anyone's real password.
    response = client.admin_get_user(
        UserPoolId=settings.cognito_user_pool_id,
        Username=email,
    )
    return next(a["Value"] for a in response["UserAttributes"] if a["Name"] == "sub")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--temporary-password", required=True)
    args = parser.parse_args()

    user_id = create_cognito_user(args.email, args.temporary_password)
    put_user(User(user_id=user_id, email=args.email, is_administrator=True))
    print(f"Created admin user {args.email} with UserId {user_id}")


if __name__ == "__main__":
    main()
