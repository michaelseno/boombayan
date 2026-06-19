from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user_id
from ..db import get_user_by_id
from ..models.user import User

router = APIRouter()


@router.get("/me", response_model=User)
def get_me(user_id: str = Depends(get_current_user_id)) -> User:
    # A valid Cognito token with no matching Users-table row is a real,
    # not hypothetical, case: this system has no self-registration, so every
    # account is provisioned by an out-of-band process (the seed script in
    # scripts/seed_admin.py is the only sanctioned one so far). If a Cognito
    # user is ever created some other way, they'll authenticate successfully
    # but land here.
    user = get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user
