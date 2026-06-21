from datetime import date
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, require_admin
from ..db import get_config, get_member_by_id, list_users, put_loan
from ..models.loan import ApprovalEntry, ApprovalVoteStatus, CreateLoanRequest, Loan, LoanStatus
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
