from enum import Enum

from pydantic import BaseModel


class CycleStatus(str, Enum):
    OPEN = "Open"
    CLOSED = "Closed"


class Cycle(BaseModel):
    cycle_id: str
    start_date: str
    end_date: str | None = None
    status: CycleStatus = CycleStatus.OPEN
    total_interest_earned: float | None = None
    total_penalties_collected: float | None = None
    top3_bonus_percentage: float | None = None
    top3_bonus_pool: float | None = None
    remaining_profit: float | None = None
    total_shares_at_close: int | None = None
    closed_at: str | None = None


class OpenCycleRequest(BaseModel):
    start_date: str | None = None


class CloseCycleRequest(BaseModel):
    end_date: str | None = None


class Dividend(BaseModel):
    cycle_id: str
    member_id: str
    share_based_amount: float
    top3_bonus_amount: float
    total_amount: float
    shares_at_calculation: int
    rank: int | None = None
