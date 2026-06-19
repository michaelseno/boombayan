from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user_id
from ..db import get_user_by_id
from ..models.user import User

router = APIRouter()


@router.get("/me", response_model=User)
def get_me(user_id: str = Depends(get_current_user_id)) -> User:
    user = get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user
