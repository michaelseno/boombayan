from datetime import date
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, require_admin
from ..db import get_member_by_id, list_members, put_member
from ..models.member import CreateMemberRequest, Member, MemberStatus, UpdateMemberRequest
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
