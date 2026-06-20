from enum import Enum

from pydantic import BaseModel, Field


class MemberStatus(str, Enum):
    ACTIVE = "Active"
    INACTIVE = "Inactive"
    WITHDRAWN = "Withdrawn"


class ShareHistoryEntry(BaseModel):
    cycle_id: str | None = None
    shares_purchased: int
    share_value_at_purchase: float
    amount_paid: float
    date: str


class Member(BaseModel):
    member_id: str
    first_name: str
    last_name: str
    email: str
    phone: str
    date_joined: str
    status: MemberStatus = MemberStatus.ACTIVE
    current_shares: int = 0
    current_capital_amount: float = 0
    share_history: list[ShareHistoryEntry] = []


class CreateMemberRequest(BaseModel):
    first_name: str
    last_name: str
    email: str
    phone: str
    date_joined: str | None = None


class UpdateMemberRequest(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    phone: str | None = None
    status: MemberStatus | None = None


class PurchaseSharesRequest(BaseModel):
    shares_purchased: int = Field(gt=0)
