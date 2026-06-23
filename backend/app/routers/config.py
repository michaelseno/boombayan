from fastapi import APIRouter, Depends

from ..auth import get_current_user, require_admin
from ..db import get_config, put_config
from ..models.config import Config, UpdateConfigRequest
from ..models.user import User

router = APIRouter()


@router.get("/config", response_model=Config)
def read_config(user: User = Depends(get_current_user)) -> Config:
    return get_config()


@router.put("/config", response_model=Config)
def update_config(body: UpdateConfigRequest, user: User = Depends(require_admin)) -> Config:
    config = get_config()
    if body.share_value is not None:
        config.share_value = body.share_value
    if body.max_shares_per_member is not None:
        config.max_shares_per_member = body.max_shares_per_member
    if body.default_interest_rate is not None:
        config.default_interest_rate = body.default_interest_rate
    if body.penalty_rate is not None:
        config.penalty_rate = body.penalty_rate
    if body.penalty_grace_period_hours is not None:
        config.penalty_grace_period_hours = body.penalty_grace_period_hours
    if body.top3_bonus_percentage is not None:
        config.top3_bonus_percentage = body.top3_bonus_percentage
    if body.top3_ranking_weight_amount is not None:
        config.top3_ranking_weight_amount = body.top3_ranking_weight_amount
    if body.top3_ranking_weight_count is not None:
        config.top3_ranking_weight_count = body.top3_ranking_weight_count
    put_config(config)
    return config
