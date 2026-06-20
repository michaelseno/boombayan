from datetime import date
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, require_admin
from ..db import get_config, get_member_by_id, list_members, put_member
from ..models.member import (
    CreateMemberRequest,
    Member,
    MemberStatus,
    PurchaseSharesRequest,
    ShareHistoryEntry,
    UpdateMemberRequest,
)
from ..models.user import User

router = APIRouter()


@router.post("/members", response_model=Member, status_code=201)
def create_member(body: CreateMemberRequest, user: User = Depends(require_admin)) -> Member:
    member = Member(
        member_id=str(uuid4()),
        first_name=body.first_name,
        last_name=body.last_name,
        email=body.email,
        phone=body.phone,
        date_joined=body.date_joined or date.today().isoformat(),
        status=MemberStatus.ACTIVE,
    )
    put_member(member)
    return member


@router.get("/members", response_model=list[Member])
def get_members(user: User = Depends(get_current_user)) -> list[Member]:
    return list_members()


@router.get("/members/{member_id}", response_model=Member)
def get_member(member_id: str, user: User = Depends(get_current_user)) -> Member:
    member = get_member_by_id(member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    return member


@router.put("/members/{member_id}", response_model=Member)
def update_member(
    member_id: str, body: UpdateMemberRequest, user: User = Depends(require_admin)
) -> Member:
    member = get_member_by_id(member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if body.first_name is not None:
        member.first_name = body.first_name
    if body.last_name is not None:
        member.last_name = body.last_name
    if body.email is not None:
        member.email = body.email
    if body.phone is not None:
        member.phone = body.phone
    if body.status is not None:
        member.status = body.status
    put_member(member)
    return member


@router.post("/members/{member_id}/shares", response_model=Member)
def purchase_shares(
    member_id: str, body: PurchaseSharesRequest, user: User = Depends(require_admin)
) -> Member:
    member = get_member_by_id(member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")

    config = get_config()
    if config.share_value <= 0:
        raise HTTPException(status_code=400, detail="Share value has not been configured yet")

    new_total_shares = member.current_shares + body.shares_purchased
    if new_total_shares > config.max_shares_per_member:
        raise HTTPException(
            status_code=400,
            detail=f"Purchase would exceed the maximum of {config.max_shares_per_member} shares per member",
        )

    amount_paid = body.shares_purchased * config.share_value
    member.share_history.append(
        ShareHistoryEntry(
            cycle_id=None,
            shares_purchased=body.shares_purchased,
            share_value_at_purchase=config.share_value,
            amount_paid=amount_paid,
            date=date.today().isoformat(),
        )
    )
    member.current_shares = new_total_shares
    member.current_capital_amount += amount_paid
    put_member(member)
    return member
