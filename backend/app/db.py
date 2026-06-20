from decimal import Decimal

import boto3

from .config import settings
from .models.config import Config
from .models.member import Member, MemberStatus, ShareHistoryEntry
from .models.user import User


def _dynamodb():
    # Created fresh on every call (not cached at module scope) so tests can
    # activate moto's mock_aws() before any AWS client/resource is constructed.
    return boto3.resource("dynamodb", region_name=settings.aws_region)


def get_users_table():
    return _dynamodb().Table(settings.users_table)


def get_config_table():
    return _dynamodb().Table(settings.config_table)


def get_members_table():
    return _dynamodb().Table(settings.members_table)


def get_user_by_id(user_id: str) -> User | None:
    response = get_users_table().get_item(Key={"UserId": user_id})
    item = response.get("Item")
    if item is None:
        return None
    return User(
        user_id=item["UserId"],
        email=item["Email"],
        is_administrator=item.get("IsAdministrator", False),
        member_id=item.get("MemberId"),
    )


def put_user(user: User) -> None:
    item = {
        "UserId": user.user_id,
        "Email": user.email,
        "IsAdministrator": user.is_administrator,
    }
    if user.member_id is not None:
        item["MemberId"] = user.member_id
    get_users_table().put_item(Item=item)


def _share_history_from_items(items: list[dict]) -> list[ShareHistoryEntry]:
    return [
        ShareHistoryEntry(
            cycle_id=entry.get("CycleId"),
            shares_purchased=int(entry["SharesPurchased"]),
            share_value_at_purchase=float(entry["ShareValueAtPurchase"]),
            amount_paid=float(entry["AmountPaid"]),
            date=entry["Date"],
        )
        for entry in items
    ]


def _member_from_item(item: dict) -> Member:
    return Member(
        member_id=item["MemberId"],
        first_name=item["FirstName"],
        last_name=item["LastName"],
        email=item["Email"],
        phone=item["Phone"],
        date_joined=item["DateJoined"],
        status=MemberStatus(item["Status"]),
        current_shares=int(item["CurrentShares"]),
        current_capital_amount=float(item["CurrentCapitalAmount"]),
        share_history=_share_history_from_items(item.get("ShareHistory", [])),
    )


def _item_from_member(member: Member) -> dict:
    return {
        "MemberId": member.member_id,
        "FirstName": member.first_name,
        "LastName": member.last_name,
        "Email": member.email,
        "Phone": member.phone,
        "DateJoined": member.date_joined,
        "Status": member.status.value,
        "CurrentShares": member.current_shares,
        "CurrentCapitalAmount": Decimal(str(member.current_capital_amount)),
        "ShareHistory": [
            {
                "CycleId": entry.cycle_id,
                "SharesPurchased": entry.shares_purchased,
                "ShareValueAtPurchase": Decimal(str(entry.share_value_at_purchase)),
                "AmountPaid": Decimal(str(entry.amount_paid)),
                "Date": entry.date,
            }
            for entry in member.share_history
        ],
    }


def get_member_by_id(member_id: str) -> Member | None:
    response = get_members_table().get_item(Key={"MemberId": member_id})
    item = response.get("Item")
    if item is None:
        return None
    return _member_from_item(item)


def put_member(member: Member) -> None:
    get_members_table().put_item(Item=_item_from_member(member))


def list_members() -> list[Member]:
    response = get_members_table().scan()
    return [_member_from_item(item) for item in response["Items"]]


CONFIG_KEY = "global"


def get_config() -> Config:
    response = get_config_table().get_item(Key={"ConfigKey": CONFIG_KEY})
    item = response.get("Item")
    if item is None:
        return Config()
    return Config(
        share_value=float(item.get("ShareValue", 0)),
        max_shares_per_member=int(item.get("MaxSharesPerMember", 5)),
    )


# Performs full replacement of config. Callers needing partial updates must call
# get_config() first, modify the returned object, then pass it here.
def put_config(config: Config) -> None:
    get_config_table().put_item(
        Item={
            "ConfigKey": CONFIG_KEY,
            "ShareValue": Decimal(str(config.share_value)),
            "MaxSharesPerMember": config.max_shares_per_member,
        }
    )
