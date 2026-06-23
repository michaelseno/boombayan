from datetime import date, datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, require_admin
from ..cycle_engine import compute_cycle_close
from ..db import get_cycle_by_id, get_open_cycle, list_cycles, list_dividends_for_cycle, put_cycle, put_dividend
from ..models.cycle import (
    CloseCycleRequest,
    Cycle,
    CycleCloseResult,
    CycleStatus,
    Dividend,
    OpenCycleRequest,
)
from ..models.user import User

router = APIRouter()


@router.post("/cycles", response_model=Cycle, status_code=201)
def open_cycle(body: OpenCycleRequest, user: User = Depends(require_admin)) -> Cycle:
    if get_open_cycle() is not None:
        raise HTTPException(status_code=400, detail="A cycle is already open")
    cycle = Cycle(
        cycle_id=str(uuid4()),
        start_date=body.start_date or date.today().isoformat(),
        status=CycleStatus.OPEN,
    )
    put_cycle(cycle)
    return cycle


@router.get("/cycles", response_model=list[Cycle])
def get_cycles(user: User = Depends(get_current_user)) -> list[Cycle]:
    return list_cycles()


@router.get("/cycles/{cycle_id}", response_model=Cycle)
def get_cycle(cycle_id: str, user: User = Depends(get_current_user)) -> Cycle:
    cycle = get_cycle_by_id(cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail="Cycle not found")
    return cycle


@router.get("/cycles/{cycle_id}/preview-close", response_model=CycleCloseResult)
def preview_close_cycle(cycle_id: str, user: User = Depends(require_admin)) -> CycleCloseResult:
    cycle = get_cycle_by_id(cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail="Cycle not found")
    if cycle.status != CycleStatus.OPEN:
        raise HTTPException(status_code=400, detail="Only an open cycle can be previewed for close")
    return compute_cycle_close(cycle)


@router.post("/cycles/{cycle_id}/close", response_model=Cycle)
def close_cycle(cycle_id: str, body: CloseCycleRequest, user: User = Depends(require_admin)) -> Cycle:
    cycle = get_cycle_by_id(cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail="Cycle not found")
    if cycle.status != CycleStatus.OPEN:
        raise HTTPException(status_code=400, detail="Only an open cycle can be closed")

    result = compute_cycle_close(cycle)

    cycle.end_date = body.end_date or date.today().isoformat()
    cycle.status = CycleStatus.CLOSED
    cycle.total_interest_earned = result.total_interest_earned
    cycle.total_penalties_collected = result.total_penalties_collected
    cycle.top3_bonus_percentage = result.top3_bonus_percentage
    cycle.top3_bonus_pool = result.top3_bonus_pool
    cycle.remaining_profit = result.remaining_profit
    cycle.total_shares_at_close = result.total_shares_at_close
    cycle.closed_at = datetime.now(timezone.utc).isoformat()
    put_cycle(cycle)

    for breakdown in result.dividends:
        put_dividend(
            Dividend(
                cycle_id=cycle.cycle_id,
                member_id=breakdown.member_id,
                share_based_amount=breakdown.share_based_amount,
                top3_bonus_amount=breakdown.top3_bonus_amount,
                total_amount=breakdown.total_amount,
                shares_at_calculation=breakdown.shares_at_calculation,
                rank=breakdown.rank,
            )
        )

    return cycle


@router.get("/cycles/{cycle_id}/dividends", response_model=list[Dividend])
def get_cycle_dividends(cycle_id: str, user: User = Depends(get_current_user)) -> list[Dividend]:
    cycle = get_cycle_by_id(cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail="Cycle not found")
    return list_dividends_for_cycle(cycle_id)
