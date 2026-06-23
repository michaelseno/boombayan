from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

from .config import settings
from .models.config import Config
from .models.cycle import Cycle, CycleStatus, Dividend
from .models.loan import ApprovalEntry, ApprovalVoteStatus, Loan, LoanStatus
from .models.member import Member, MemberStatus, ShareHistoryEntry
from .models.transaction import Transaction, TransactionType
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


def list_users() -> list[User]:
    response = get_users_table().scan()
    return [
        User(
            user_id=item["UserId"],
            email=item["Email"],
            is_administrator=item.get("IsAdministrator", False),
            member_id=item.get("MemberId"),
        )
        for item in response["Items"]
    ]


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
        default_interest_rate=float(item.get("DefaultInterestRate", 0)),
        penalty_rate=float(item.get("PenaltyRate", 0)),
        penalty_grace_period_hours=int(item.get("PenaltyGracePeriodHours", 0)),
        top3_bonus_percentage=float(item.get("Top3BonusPercentage", 0)),
        top3_ranking_weight_amount=float(item.get("Top3RankingWeightAmount", 0)),
        top3_ranking_weight_count=float(item.get("Top3RankingWeightCount", 0)),
    )


# Performs full replacement of config. Callers needing partial updates must call
# get_config() first, modify the returned object, then pass it here.
def put_config(config: Config) -> None:
    get_config_table().put_item(
        Item={
            "ConfigKey": CONFIG_KEY,
            "ShareValue": Decimal(str(config.share_value)),
            "MaxSharesPerMember": config.max_shares_per_member,
            "DefaultInterestRate": Decimal(str(config.default_interest_rate)),
            "PenaltyRate": Decimal(str(config.penalty_rate)),
            "PenaltyGracePeriodHours": config.penalty_grace_period_hours,
            "Top3BonusPercentage": Decimal(str(config.top3_bonus_percentage)),
            "Top3RankingWeightAmount": Decimal(str(config.top3_ranking_weight_amount)),
            "Top3RankingWeightCount": Decimal(str(config.top3_ranking_weight_count)),
        }
    )


def get_loans_table():
    return _dynamodb().Table(settings.loans_table)


def _approvals_from_item(item: dict) -> dict[str, ApprovalEntry]:
    return {
        user_id: ApprovalEntry(
            email=entry["Email"],
            status=ApprovalVoteStatus(entry["Status"]),
            date=entry.get("Date"),
            comments=entry.get("Comments"),
        )
        for user_id, entry in item.get("Approvals", {}).items()
    }


def _item_from_approvals(approvals: dict[str, ApprovalEntry]) -> dict:
    item = {}
    for user_id, entry in approvals.items():
        entry_item = {"Email": entry.email, "Status": entry.status.value}
        if entry.date is not None:
            entry_item["Date"] = entry.date
        if entry.comments is not None:
            entry_item["Comments"] = entry.comments
        item[user_id] = entry_item
    return item


def _loan_from_item(item: dict) -> Loan:
    return Loan(
        loan_id=item["LoanId"],
        member_id=item["MemberId"],
        requested_amount=float(item["RequestedAmount"]),
        approved_amount=float(item["ApprovedAmount"]) if "ApprovedAmount" in item else None,
        repayment_interval_days=int(item["RepaymentIntervalDays"]),
        interest_rate=float(item["InterestRate"]),
        application_date=item["ApplicationDate"],
        remarks=item.get("Remarks"),
        status=LoanStatus(item["Status"]),
        is_exception_case=bool(item["IsExceptionCase"]),
        release_date=item.get("ReleaseDate"),
        interest_deduction=float(item["InterestDeduction"]) if "InterestDeduction" in item else None,
        net_release_amount=float(item["NetReleaseAmount"]) if "NetReleaseAmount" in item else None,
        remaining_balance=float(item["RemainingBalance"]) if "RemainingBalance" in item else None,
        next_due_date=item.get("NextDueDate"),
        cycle_id=item.get("CycleId"),
        # .get(..., False), not direct indexing: loans written before this
        # field existed have no PenaltyChargedForCurrentCycle attribute at all.
        penalty_charged_for_current_cycle=bool(item.get("PenaltyChargedForCurrentCycle", False)),
        approvals=_approvals_from_item(item),
    )


def _item_from_loan(loan: Loan) -> dict:
    item = {
        "LoanId": loan.loan_id,
        "MemberId": loan.member_id,
        "RequestedAmount": Decimal(str(loan.requested_amount)),
        "RepaymentIntervalDays": loan.repayment_interval_days,
        "InterestRate": Decimal(str(loan.interest_rate)),
        "ApplicationDate": loan.application_date,
        "Status": loan.status.value,
        "IsExceptionCase": loan.is_exception_case,
        "PenaltyChargedForCurrentCycle": loan.penalty_charged_for_current_cycle,
        "Approvals": _item_from_approvals(loan.approvals),
    }
    if loan.approved_amount is not None:
        item["ApprovedAmount"] = Decimal(str(loan.approved_amount))
    if loan.remarks is not None:
        item["Remarks"] = loan.remarks
    if loan.release_date is not None:
        item["ReleaseDate"] = loan.release_date
    if loan.interest_deduction is not None:
        item["InterestDeduction"] = Decimal(str(loan.interest_deduction))
    if loan.net_release_amount is not None:
        item["NetReleaseAmount"] = Decimal(str(loan.net_release_amount))
    if loan.remaining_balance is not None:
        item["RemainingBalance"] = Decimal(str(loan.remaining_balance))
    if loan.next_due_date is not None:
        item["NextDueDate"] = loan.next_due_date
    if loan.cycle_id is not None:
        item["CycleId"] = loan.cycle_id
    return item


def get_loan_by_id(loan_id: str) -> Loan | None:
    response = get_loans_table().get_item(Key={"LoanId": loan_id})
    item = response.get("Item")
    if item is None:
        return None
    return _loan_from_item(item)


def put_loan(loan: Loan) -> None:
    get_loans_table().put_item(Item=_item_from_loan(loan))


def list_loans() -> list[Loan]:
    response = get_loans_table().scan()
    return [_loan_from_item(item) for item in response["Items"]]


def get_transactions_table():
    return _dynamodb().Table(settings.transactions_table)


def _transaction_from_item(item: dict) -> Transaction:
    return Transaction(
        transaction_id=item["TransactionId"],
        loan_id=item["LoanId"],
        timestamp=item["Timestamp"],
        type=TransactionType(item["Type"]),
        amount=float(item["Amount"]),
        remaining_balance_after=float(item["RemainingBalanceAfter"]),
        recorded_by=item.get("RecordedBy"),
        notes=item.get("Notes"),
        cycle_id=item.get("CycleId"),
    )


def _item_from_transaction(transaction: Transaction) -> dict:
    item = {
        "LoanId": transaction.loan_id,
        "Timestamp": transaction.timestamp,
        "TransactionId": transaction.transaction_id,
        "Type": transaction.type.value,
        "Amount": Decimal(str(transaction.amount)),
        "RemainingBalanceAfter": Decimal(str(transaction.remaining_balance_after)),
    }
    if transaction.recorded_by is not None:
        item["RecordedBy"] = transaction.recorded_by
    if transaction.notes is not None:
        item["Notes"] = transaction.notes
    if transaction.cycle_id is not None:
        item["CycleId"] = transaction.cycle_id
    return item


def put_transaction(transaction: Transaction) -> None:
    get_transactions_table().put_item(Item=_item_from_transaction(transaction))


def list_transactions_for_loan(loan_id: str) -> list[Transaction]:
    response = get_transactions_table().query(KeyConditionExpression=Key("LoanId").eq(loan_id))
    return [_transaction_from_item(item) for item in response["Items"]]


def list_all_transactions() -> list[Transaction]:
    response = get_transactions_table().scan()
    return [_transaction_from_item(item) for item in response["Items"]]


def get_cycles_table():
    return _dynamodb().Table(settings.cycles_table)


def _cycle_from_item(item: dict) -> Cycle:
    return Cycle(
        cycle_id=item["CycleId"],
        start_date=item["StartDate"],
        end_date=item.get("EndDate"),
        status=CycleStatus(item["Status"]),
        total_interest_earned=float(item["TotalInterestEarned"]) if "TotalInterestEarned" in item else None,
        total_penalties_collected=float(item["TotalPenaltiesCollected"]) if "TotalPenaltiesCollected" in item else None,
        top3_bonus_percentage=float(item["Top3BonusPercentage"]) if "Top3BonusPercentage" in item else None,
        top3_bonus_pool=float(item["Top3BonusPool"]) if "Top3BonusPool" in item else None,
        remaining_profit=float(item["RemainingProfit"]) if "RemainingProfit" in item else None,
        total_shares_at_close=int(item["TotalSharesAtClose"]) if "TotalSharesAtClose" in item else None,
        closed_at=item.get("ClosedAt"),
    )


def _item_from_cycle(cycle: Cycle) -> dict:
    item = {
        "CycleId": cycle.cycle_id,
        "StartDate": cycle.start_date,
        "Status": cycle.status.value,
    }
    if cycle.end_date is not None:
        item["EndDate"] = cycle.end_date
    if cycle.total_interest_earned is not None:
        item["TotalInterestEarned"] = Decimal(str(cycle.total_interest_earned))
    if cycle.total_penalties_collected is not None:
        item["TotalPenaltiesCollected"] = Decimal(str(cycle.total_penalties_collected))
    if cycle.top3_bonus_percentage is not None:
        item["Top3BonusPercentage"] = Decimal(str(cycle.top3_bonus_percentage))
    if cycle.top3_bonus_pool is not None:
        item["Top3BonusPool"] = Decimal(str(cycle.top3_bonus_pool))
    if cycle.remaining_profit is not None:
        item["RemainingProfit"] = Decimal(str(cycle.remaining_profit))
    if cycle.total_shares_at_close is not None:
        item["TotalSharesAtClose"] = cycle.total_shares_at_close
    if cycle.closed_at is not None:
        item["ClosedAt"] = cycle.closed_at
    return item


def get_cycle_by_id(cycle_id: str) -> Cycle | None:
    response = get_cycles_table().get_item(Key={"CycleId": cycle_id})
    item = response.get("Item")
    if item is None:
        return None
    return _cycle_from_item(item)


def put_cycle(cycle: Cycle) -> None:
    get_cycles_table().put_item(Item=_item_from_cycle(cycle))


def list_cycles() -> list[Cycle]:
    response = get_cycles_table().scan()
    return [_cycle_from_item(item) for item in response["Items"]]


def get_open_cycle() -> Cycle | None:
    for cycle in list_cycles():
        if cycle.status == CycleStatus.OPEN:
            return cycle
    return None


def get_dividends_table():
    return _dynamodb().Table(settings.dividends_table)


def _dividend_from_item(item: dict) -> Dividend:
    return Dividend(
        cycle_id=item["CycleId"],
        member_id=item["MemberId"],
        share_based_amount=float(item["ShareBasedAmount"]),
        top3_bonus_amount=float(item["Top3BonusAmount"]),
        total_amount=float(item["TotalAmount"]),
        shares_at_calculation=int(item["SharesAtCalculation"]),
        rank=int(item["Rank"]) if "Rank" in item else None,
    )


def _item_from_dividend(dividend: Dividend) -> dict:
    item = {
        "CycleId": dividend.cycle_id,
        "MemberId": dividend.member_id,
        "ShareBasedAmount": Decimal(str(dividend.share_based_amount)),
        "Top3BonusAmount": Decimal(str(dividend.top3_bonus_amount)),
        "TotalAmount": Decimal(str(dividend.total_amount)),
        "SharesAtCalculation": dividend.shares_at_calculation,
    }
    if dividend.rank is not None:
        item["Rank"] = dividend.rank
    return item


def put_dividend(dividend: Dividend) -> None:
    get_dividends_table().put_item(Item=_item_from_dividend(dividend))


def list_dividends_for_cycle(cycle_id: str) -> list[Dividend]:
    response = get_dividends_table().query(KeyConditionExpression=Key("CycleId").eq(cycle_id))
    return [_dividend_from_item(item) for item in response["Items"]]
