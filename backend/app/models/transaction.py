from enum import Enum

from pydantic import BaseModel


class TransactionType(str, Enum):
    PAYMENT = "PAYMENT"
    PENALTY = "PENALTY"


class Transaction(BaseModel):
    transaction_id: str
    loan_id: str
    timestamp: str
    type: TransactionType
    amount: float
    remaining_balance_after: float
    recorded_by: str | None = None
    notes: str | None = None
    cycle_id: str | None = None
