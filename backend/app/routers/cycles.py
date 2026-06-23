from datetime import date
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, require_admin
from ..db import get_cycle_by_id, get_open_cycle, list_cycles, put_cycle
from ..models.cycle import Cycle, CycleStatus, OpenCycleRequest
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
