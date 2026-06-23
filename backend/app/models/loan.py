from enum import Enum

from pydantic import BaseModel, Field, field_validator


class LoanStatus(str, Enum):
    PENDING_BOARD_APPROVAL = "Pending Board Approval"
    APPROVED = "Approved"
    ACTIVE = "Active"
    REJECTED = "Rejected"
    COMPLETED = "Completed"


class ApprovalVoteStatus(str, Enum):
    PENDING = "Pending"
    APPROVED = "Approved"
    REJECTED = "Rejected"


class ApprovalEntry(BaseModel):
    # Email is snapshotted from the User at loan-creation time, purely for
    # display — this avoids needing a GET /users endpoint just to label
    # votes in the frontend's approvals table.
    email: str
    status: ApprovalVoteStatus = ApprovalVoteStatus.PENDING
    date: str | None = None
    comments: str | None = None


class Loan(BaseModel):
    loan_id: str
    member_id: str
    requested_amount: float
    approved_amount: float | None = None
    repayment_interval_days: int
    interest_rate: float
    application_date: str
    remarks: str | None = None
    status: LoanStatus = LoanStatus.PENDING_BOARD_APPROVAL
    is_exception_case: bool = False
    release_date: str | None = None
    interest_deduction: float | None = None
    net_release_amount: float | None = None
    remaining_balance: float | None = None
    next_due_date: str | None = None
    penalty_charged_for_current_cycle: bool = False
    cycle_id: str | None = None
    approvals: dict[str, ApprovalEntry] = {}


class CreateLoanRequest(BaseModel):
    member_id: str
    requested_amount: float = Field(gt=0)
    repayment_interval_days: int = Field(gt=0)
    remarks: str | None = None


class CastVoteRequest(BaseModel):
    status: ApprovalVoteStatus
    comments: str | None = None

    @field_validator("status")
    @classmethod
    def status_must_be_decided(cls, value: ApprovalVoteStatus) -> ApprovalVoteStatus:
        if value == ApprovalVoteStatus.PENDING:
            raise ValueError("status must be Approved or Rejected")
        return value


class ReleaseLoanRequest(BaseModel):
    release_date: str | None = None


class CreatePaymentRequest(BaseModel):
    amount: float = Field(gt=0)
    payment_date: str | None = None
    notes: str | None = None
