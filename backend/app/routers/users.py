from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..models.user import User

router = APIRouter()


@router.get("/me", response_model=User)
def get_me(user: User = Depends(get_current_user)) -> User:
    return user
