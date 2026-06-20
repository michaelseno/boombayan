from datetime import date
from uuid import uuid4

from fastapi import APIRouter, Depends

from ..auth import require_admin
from ..db import put_member
from ..models.member import CreateMemberRequest, Member, MemberStatus
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
