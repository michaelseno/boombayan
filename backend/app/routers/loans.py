from datetime import date
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, require_admin
from ..db import get_config, get_loan_by_id, get_member_by_id, list_loans, list_users, put_loan
from ..models.loan import ApprovalEntry, ApprovalVoteStatus, CastVoteRequest, CreateLoanRequest, Loan, LoanStatus
from ..models.member import MemberStatus
from ..models.user import User

router = APIRouter()


@router.post("/loans", response_model=Loan, status_code=201)
def create_loan(body: CreateLoanRequest, user: User = Depends(require_admin)) -> Loan:
    member = get_member_by_id(body.member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.status != MemberStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Only active members are eligible for a loan")

    config = get_config()
    approvers = list_users()
    loan = Loan(
        loan_id=str(uuid4()),
        member_id=member.member_id,
        requested_amount=body.requested_amount,
        repayment_interval_days=body.repayment_interval_days,
        interest_rate=config.default_interest_rate,
        application_date=date.today().isoformat(),
        remarks=body.remarks,
        status=LoanStatus.PENDING_BOARD_APPROVAL,
        is_exception_case=body.requested_amount > member.current_capital_amount,
        approvals={
            approver.user_id: ApprovalEntry(email=approver.email, status=ApprovalVoteStatus.PENDING)
            for approver in approvers
        },
    )
    put_loan(loan)
    return loan


@router.get("/loans", response_model=list[Loan])
def get_loans(
    member_id: str | None = None,
    status: LoanStatus | None = None,
    user: User = Depends(get_current_user),
) -> list[Loan]:
    loans = list_loans()
    if member_id is not None:
        loans = [loan for loan in loans if loan.member_id == member_id]
    if status is not None:
        loans = [loan for loan in loans if loan.status == status]
    return loans


@router.get("/loans/{loan_id}", response_model=Loan)
def get_loan(loan_id: str, user: User = Depends(get_current_user)) -> Loan:
    loan = get_loan_by_id(loan_id)
    if loan is None:
        raise HTTPException(status_code=404, detail="Loan not found")
    return loan


@router.post("/loans/{loan_id}/approvals", response_model=Loan)
def cast_vote(loan_id: str, body: CastVoteRequest, user: User = Depends(get_current_user)) -> Loan:
    loan = get_loan_by_id(loan_id)
    if loan is None:
        raise HTTPException(status_code=404, detail="Loan not found")
    if loan.status != LoanStatus.PENDING_BOARD_APPROVAL:
        raise HTTPException(status_code=400, detail="This loan is no longer pending board approval")
    entry = loan.approvals.get(user.user_id)
    if entry is None:
        raise HTTPException(status_code=403, detail="You are not eligible to vote on this loan")
    if entry.status != ApprovalVoteStatus.PENDING:
        raise HTTPException(status_code=400, detail="You have already voted on this loan")

    entry.status = body.status
    entry.date = date.today().isoformat()
    entry.comments = body.comments

    if body.status == ApprovalVoteStatus.REJECTED:
        loan.status = LoanStatus.REJECTED
    elif all(e.status == ApprovalVoteStatus.APPROVED for e in loan.approvals.values()):
        loan.status = LoanStatus.APPROVED
        loan.approved_amount = loan.requested_amount

    put_loan(loan)
    return loan
