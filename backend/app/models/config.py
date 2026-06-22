from pydantic import BaseModel


class Config(BaseModel):
    share_value: float = 0
    max_shares_per_member: int = 5
    default_interest_rate: float = 0
    penalty_rate: float = 0
    penalty_grace_period_hours: int = 0


class UpdateConfigRequest(BaseModel):
    share_value: float | None = None
    max_shares_per_member: int | None = None
    default_interest_rate: float | None = None
    penalty_rate: float | None = None
    penalty_grace_period_hours: int | None = None
