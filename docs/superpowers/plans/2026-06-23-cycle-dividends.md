# Plan 5: Cycle Close & Dividend Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the board open a cycle, accrue interest/penalties/share purchases against it, preview the computed dividend distribution and Top 3 ranking before committing, and close the cycle to pay out dividends — completing the core lending domain per design doc §7.

**Architecture:** Same FastAPI/Lambda/DynamoDB/React stack as Plans 1-4. Two new DynamoDB tables — `Cycles` (PK `CycleId`) and `Dividends` (PK `CycleId`, SK `MemberId`) — track cycle lifecycle and computed payouts. Existing write paths (loan release, payment/penalty transactions, share purchases) stamp a `cycle_id` from whichever cycle is currently `Open`. A new plain function `compute_cycle_close()` is the single calculation engine shared by a read-only preview endpoint and the irreversible close endpoint. `Config` gains three Top 3 fields. Frontend adds a Cycles list/detail page and three Settings fields — no other route changes.

**Tech Stack:** Same as Plans 1-4 — no new dependencies required.

## Global Constraints

- Backend: Python 3.12, FastAPI 0.115.0, boto3 1.35.36, pydantic 2.9.2 — exact versions pinned in `backend/requirements.txt`, unchanged by this plan.
- Frontend: no new npm dependencies.
- AWS region `us-east-1`, stage `dev` (`infra/serverless.yml`'s existing `${opt:stage, 'dev'}`), unchanged by this plan.
- DynamoDB attribute names are PascalCase (`CycleId`, `TotalInterestEarned`); Python/TypeScript field names are snake_case, matching 1:1 between `backend/app/models/*.py` Pydantic models and `frontend/src/api/types.ts` interfaces.
- Pydantic v2 `BaseModel` defaults to `extra='ignore'` in this codebase (no model sets `model_config`) — passing an undefined keyword argument to a model constructor is silently dropped, not an error. Keep this in mind when reading "Expected: FAIL" messages below; some failures surface as `AttributeError` on access, not a constructor-time error.
- Every code task follows TDD: write the failing test, run it to confirm it fails, write the minimal implementation, run it to confirm it passes, commit.
- Backend test count starts at 99 passing (verified before this plan was written). Frontend test count starts at 54 passing across 14 files (verified before this plan was written). Each task below states the expected running total after that task.

---

### Task 1: Cycle & Dividend data models, DynamoDB tables, and repository functions

**Files:**
- Create: `backend/app/models/cycle.py`
- Modify: `backend/app/config.py`
- Modify: `backend/app/db.py`
- Modify: `backend/tests/conftest.py`
- Modify: `backend/tests/test_db.py`
- Modify: `infra/serverless.yml`

**Interfaces:**
- Produces: `Cycle(cycle_id: str, start_date: str, end_date: str|None=None, status: CycleStatus=OPEN, total_interest_earned: float|None=None, total_penalties_collected: float|None=None, top3_bonus_percentage: float|None=None, top3_bonus_pool: float|None=None, remaining_profit: float|None=None, total_shares_at_close: int|None=None, closed_at: str|None=None)`; `CycleStatus.OPEN` / `CycleStatus.CLOSED`; `OpenCycleRequest(start_date: str|None)`; `CloseCycleRequest(end_date: str|None)`; `Dividend(cycle_id: str, member_id: str, share_based_amount: float, top3_bonus_amount: float, total_amount: float, shares_at_calculation: int, rank: int|None=None)`; db functions `get_cycle_by_id(cycle_id: str) -> Cycle | None`, `put_cycle(cycle: Cycle) -> None`, `list_cycles() -> list[Cycle]`, `get_open_cycle() -> Cycle | None`, `put_dividend(dividend: Dividend) -> None`, `list_dividends_for_cycle(cycle_id: str) -> list[Dividend]`; `settings.cycles_table`, `settings.dividends_table`; conftest fixtures `dynamodb_cycles_table`, `dynamodb_dividends_table`.

- [ ] **Step 1: Add the `dynamodb_cycles_table` and `dynamodb_dividends_table` fixtures** — append to `backend/tests/conftest.py` (after the existing `dynamodb_transactions_table` fixture):

```python
@pytest.fixture
def dynamodb_cycles_table(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "cycles_table", "test-cycles")

    with mock_aws():
        dynamo_client = boto3.client("dynamodb", region_name="us-east-1")
        dynamo_client.create_table(
            TableName="test-cycles",
            AttributeDefinitions=[{"AttributeName": "CycleId", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "CycleId", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield


@pytest.fixture
def dynamodb_dividends_table(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "dividends_table", "test-dividends")

    with mock_aws():
        dynamo_client = boto3.client("dynamodb", region_name="us-east-1")
        dynamo_client.create_table(
            TableName="test-dividends",
            AttributeDefinitions=[
                {"AttributeName": "CycleId", "AttributeType": "S"},
                {"AttributeName": "MemberId", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "CycleId", "KeyType": "HASH"},
                {"AttributeName": "MemberId", "KeyType": "RANGE"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        yield
```

- [ ] **Step 2: Write the failing tests** — append to `backend/tests/test_db.py`:

```python
def test_put_and_get_cycle_roundtrip(dynamodb_cycles_table):
    from app.db import get_cycle_by_id, put_cycle
    from app.models.cycle import Cycle, CycleStatus

    cycle = Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN)
    put_cycle(cycle)

    fetched = get_cycle_by_id("cycle-1")
    assert fetched == cycle


def test_get_cycle_by_id_returns_none_when_missing(dynamodb_cycles_table):
    from app.db import get_cycle_by_id

    assert get_cycle_by_id("does-not-exist") is None


def test_put_cycle_persists_close_fields(dynamodb_cycles_table):
    from app.db import get_cycle_by_id, put_cycle
    from app.models.cycle import Cycle, CycleStatus

    cycle = Cycle(
        cycle_id="cycle-1",
        start_date="2026-01-01",
        end_date="2026-06-30",
        status=CycleStatus.CLOSED,
        total_interest_earned=1000,
        total_penalties_collected=50,
        top3_bonus_percentage=0.1,
        top3_bonus_pool=100,
        remaining_profit=900,
        total_shares_at_close=20,
        closed_at="2026-06-30T10:00:00+00:00",
    )
    put_cycle(cycle)

    fetched = get_cycle_by_id("cycle-1")
    assert fetched == cycle


def test_list_cycles_returns_all_cycles(dynamodb_cycles_table):
    from app.db import list_cycles, put_cycle
    from app.models.cycle import Cycle, CycleStatus

    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.CLOSED))
    put_cycle(Cycle(cycle_id="cycle-2", start_date="2026-07-01", status=CycleStatus.OPEN))

    cycles = list_cycles()
    assert {c.cycle_id for c in cycles} == {"cycle-1", "cycle-2"}


def test_get_open_cycle_returns_the_open_cycle(dynamodb_cycles_table):
    from app.db import get_open_cycle, put_cycle
    from app.models.cycle import Cycle, CycleStatus

    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.CLOSED))
    put_cycle(Cycle(cycle_id="cycle-2", start_date="2026-07-01", status=CycleStatus.OPEN))

    open_cycle = get_open_cycle()
    assert open_cycle is not None
    assert open_cycle.cycle_id == "cycle-2"


def test_get_open_cycle_returns_none_when_no_cycle_is_open(dynamodb_cycles_table):
    from app.db import get_open_cycle, put_cycle
    from app.models.cycle import Cycle, CycleStatus

    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.CLOSED))

    assert get_open_cycle() is None


def test_put_and_get_dividend_roundtrip(dynamodb_dividends_table):
    from app.db import list_dividends_for_cycle, put_dividend
    from app.models.cycle import Dividend

    dividend = Dividend(
        cycle_id="cycle-1", member_id="mem-1", share_based_amount=250, top3_bonus_amount=50,
        total_amount=300, shares_at_calculation=2, rank=1,
    )
    put_dividend(dividend)

    fetched = list_dividends_for_cycle("cycle-1")
    assert fetched == [dividend]


def test_list_dividends_for_cycle_returns_only_that_cycles_dividends(dynamodb_dividends_table):
    from app.db import list_dividends_for_cycle, put_dividend
    from app.models.cycle import Dividend

    put_dividend(Dividend(
        cycle_id="cycle-1", member_id="mem-1", share_based_amount=250, top3_bonus_amount=0,
        total_amount=250, shares_at_calculation=2,
    ))
    put_dividend(Dividend(
        cycle_id="cycle-2", member_id="mem-1", share_based_amount=100, top3_bonus_amount=0,
        total_amount=100, shares_at_calculation=2,
    ))

    dividends = list_dividends_for_cycle("cycle-1")
    assert [d.cycle_id for d in dividends] == ["cycle-1"]
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd backend && .venv/bin/python -m pytest tests/test_db.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models.cycle'`

- [ ] **Step 4: Create `backend/app/models/cycle.py`**

```python
from enum import Enum

from pydantic import BaseModel


class CycleStatus(str, Enum):
    OPEN = "Open"
    CLOSED = "Closed"


class Cycle(BaseModel):
    cycle_id: str
    start_date: str
    end_date: str | None = None
    status: CycleStatus = CycleStatus.OPEN
    total_interest_earned: float | None = None
    total_penalties_collected: float | None = None
    top3_bonus_percentage: float | None = None
    top3_bonus_pool: float | None = None
    remaining_profit: float | None = None
    total_shares_at_close: int | None = None
    closed_at: str | None = None


class OpenCycleRequest(BaseModel):
    start_date: str | None = None


class CloseCycleRequest(BaseModel):
    end_date: str | None = None


class Dividend(BaseModel):
    cycle_id: str
    member_id: str
    share_based_amount: float
    top3_bonus_amount: float
    total_amount: float
    shares_at_calculation: int
    rank: int | None = None
```

- [ ] **Step 5: Add the `cycles_table` and `dividends_table` settings** — modify `backend/app/config.py` to read:

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    users_table: str = "boombayan-api-dev-users"
    config_table: str = "boombayan-api-dev-config"
    members_table: str = "boombayan-api-dev-members"
    loans_table: str = "boombayan-api-dev-loans"
    transactions_table: str = "boombayan-api-dev-transactions"
    cycles_table: str = "boombayan-api-dev-cycles"
    dividends_table: str = "boombayan-api-dev-dividends"
    cognito_user_pool_id: str = ""
    cognito_client_id: str = ""
    aws_region: str = "us-east-1"
    cors_allowed_origins: str = "http://localhost:5173"


settings = Settings()
```

- [ ] **Step 6: Update `backend/app/db.py`** — add `from .models.cycle import Cycle, CycleStatus, Dividend` to the imports at the top (alongside the existing model imports), then append the Cycle and Dividend repository functions at the end of the file (after `list_transactions_for_loan`):

```python
def get_cycles_table():
    return _dynamodb().Table(settings.cycles_table)


def _cycle_from_item(item: dict) -> Cycle:
    return Cycle(
        cycle_id=item["CycleId"],
        start_date=item["StartDate"],
        end_date=item.get("EndDate"),
        status=CycleStatus(item["Status"]),
        total_interest_earned=float(item["TotalInterestEarned"]) if "TotalInterestEarned" in item else None,
        total_penalties_collected=float(item["TotalPenaltiesCollected"]) if "TotalPenaltiesCollected" in item else None,
        top3_bonus_percentage=float(item["Top3BonusPercentage"]) if "Top3BonusPercentage" in item else None,
        top3_bonus_pool=float(item["Top3BonusPool"]) if "Top3BonusPool" in item else None,
        remaining_profit=float(item["RemainingProfit"]) if "RemainingProfit" in item else None,
        total_shares_at_close=int(item["TotalSharesAtClose"]) if "TotalSharesAtClose" in item else None,
        closed_at=item.get("ClosedAt"),
    )


def _item_from_cycle(cycle: Cycle) -> dict:
    item = {
        "CycleId": cycle.cycle_id,
        "StartDate": cycle.start_date,
        "Status": cycle.status.value,
    }
    if cycle.end_date is not None:
        item["EndDate"] = cycle.end_date
    if cycle.total_interest_earned is not None:
        item["TotalInterestEarned"] = Decimal(str(cycle.total_interest_earned))
    if cycle.total_penalties_collected is not None:
        item["TotalPenaltiesCollected"] = Decimal(str(cycle.total_penalties_collected))
    if cycle.top3_bonus_percentage is not None:
        item["Top3BonusPercentage"] = Decimal(str(cycle.top3_bonus_percentage))
    if cycle.top3_bonus_pool is not None:
        item["Top3BonusPool"] = Decimal(str(cycle.top3_bonus_pool))
    if cycle.remaining_profit is not None:
        item["RemainingProfit"] = Decimal(str(cycle.remaining_profit))
    if cycle.total_shares_at_close is not None:
        item["TotalSharesAtClose"] = cycle.total_shares_at_close
    if cycle.closed_at is not None:
        item["ClosedAt"] = cycle.closed_at
    return item


def get_cycle_by_id(cycle_id: str) -> Cycle | None:
    response = get_cycles_table().get_item(Key={"CycleId": cycle_id})
    item = response.get("Item")
    if item is None:
        return None
    return _cycle_from_item(item)


def put_cycle(cycle: Cycle) -> None:
    get_cycles_table().put_item(Item=_item_from_cycle(cycle))


def list_cycles() -> list[Cycle]:
    response = get_cycles_table().scan()
    return [_cycle_from_item(item) for item in response["Items"]]


def get_open_cycle() -> Cycle | None:
    for cycle in list_cycles():
        if cycle.status == CycleStatus.OPEN:
            return cycle
    return None


def get_dividends_table():
    return _dynamodb().Table(settings.dividends_table)


def _dividend_from_item(item: dict) -> Dividend:
    return Dividend(
        cycle_id=item["CycleId"],
        member_id=item["MemberId"],
        share_based_amount=float(item["ShareBasedAmount"]),
        top3_bonus_amount=float(item["Top3BonusAmount"]),
        total_amount=float(item["TotalAmount"]),
        shares_at_calculation=int(item["SharesAtCalculation"]),
        rank=int(item["Rank"]) if "Rank" in item else None,
    )


def _item_from_dividend(dividend: Dividend) -> dict:
    item = {
        "CycleId": dividend.cycle_id,
        "MemberId": dividend.member_id,
        "ShareBasedAmount": Decimal(str(dividend.share_based_amount)),
        "Top3BonusAmount": Decimal(str(dividend.top3_bonus_amount)),
        "TotalAmount": Decimal(str(dividend.total_amount)),
        "SharesAtCalculation": dividend.shares_at_calculation,
    }
    if dividend.rank is not None:
        item["Rank"] = dividend.rank
    return item


def put_dividend(dividend: Dividend) -> None:
    get_dividends_table().put_item(Item=_item_from_dividend(dividend))


def list_dividends_for_cycle(cycle_id: str) -> list[Dividend]:
    response = get_dividends_table().query(KeyConditionExpression=Key("CycleId").eq(cycle_id))
    return [_dividend_from_item(item) for item in response["Items"]]
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd backend && .venv/bin/python -m pytest tests/test_db.py -v
```
Expected: PASS (107 total tests in the suite once you run the full `pytest -q`; this file alone gains 8 new passing tests)

- [ ] **Step 8: Provision the tables in infra** — modify `infra/serverless.yml`'s `provider.environment` block to read:

```yaml
  environment:
    USERS_TABLE: ${self:service}-${sls:stage}-users
    CONFIG_TABLE: ${self:service}-${sls:stage}-config
    MEMBERS_TABLE: ${self:service}-${sls:stage}-members
    LOANS_TABLE: ${self:service}-${sls:stage}-loans
    TRANSACTIONS_TABLE: ${self:service}-${sls:stage}-transactions
    CYCLES_TABLE: ${self:service}-${sls:stage}-cycles
    DIVIDENDS_TABLE: ${self:service}-${sls:stage}-dividends
    COGNITO_USER_POOL_ID: !Ref CognitoUserPool
    COGNITO_CLIENT_ID: !Ref CognitoUserPoolClient
    CORS_ALLOWED_ORIGINS: http://localhost:5173,http://localhost:5174
```

Update `provider.iam.role.statements[0].Resource` to read:

```yaml
          Resource:
            - !GetAtt UsersTable.Arn
            - !GetAtt ConfigTable.Arn
            - !GetAtt MembersTable.Arn
            - !GetAtt LoansTable.Arn
            - !GetAtt TransactionsTable.Arn
            - !GetAtt CyclesTable.Arn
            - !GetAtt DividendsTable.Arn
```

Insert these two resources under `resources.Resources`, immediately after `TransactionsTable` (before `CognitoUserPool`):

```yaml
    CyclesTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:provider.environment.CYCLES_TABLE}
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: CycleId
            AttributeType: S
        KeySchema:
          - AttributeName: CycleId
            KeyType: HASH
        PointInTimeRecoverySpecification:
          PointInTimeRecoveryEnabled: true

    DividendsTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:provider.environment.DIVIDENDS_TABLE}
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: CycleId
            AttributeType: S
          - AttributeName: MemberId
            AttributeType: S
        KeySchema:
          - AttributeName: CycleId
            KeyType: HASH
          - AttributeName: MemberId
            KeyType: RANGE
        PointInTimeRecoverySpecification:
          PointInTimeRecoveryEnabled: true
```

- [ ] **Step 9: Commit**

```bash
git add backend/app/models/cycle.py backend/app/config.py backend/app/db.py backend/tests/conftest.py backend/tests/test_db.py infra/serverless.yml
git commit -m "feat: add Cycle and Dividend models, tables, and repository functions"
```

---

### Task 2: Extend Loan & Transaction models with `cycle_id`

**Files:**
- Modify: `backend/app/models/loan.py`
- Modify: `backend/app/models/transaction.py`
- Modify: `backend/app/db.py`
- Modify: `backend/tests/test_db.py`

**Interfaces:**
- Consumes: nothing new from Task 1.
- Produces: `Loan.cycle_id: str | None = None`, `Transaction.cycle_id: str | None = None`, both read/written by `db.py`.

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/test_db.py`:

```python
def test_put_and_get_loan_persists_cycle_id(dynamodb_loans_table):
    from app.db import get_loan_by_id, put_loan
    from app.models.loan import Loan, LoanStatus

    loan = Loan(
        loan_id="loan-1", member_id="mem-1", requested_amount=10000, approved_amount=10000,
        repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
        status=LoanStatus.ACTIVE, release_date="2026-06-21", interest_deduction=500,
        net_release_amount=9500, remaining_balance=10000, next_due_date="2026-07-21",
        cycle_id="cycle-1",
    )
    put_loan(loan)

    fetched = get_loan_by_id("loan-1")
    assert fetched.cycle_id == "cycle-1"


def test_put_and_get_loan_persists_null_cycle_id_by_default(dynamodb_loans_table):
    from app.db import get_loan_by_id, put_loan
    from app.models.loan import Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
        )
    )

    assert get_loan_by_id("loan-1").cycle_id is None


def test_put_and_get_transaction_persists_cycle_id(dynamodb_transactions_table):
    from app.db import list_transactions_for_loan, put_transaction
    from app.models.transaction import Transaction, TransactionType

    put_transaction(
        Transaction(
            transaction_id="txn-1", loan_id="loan-1", timestamp="2026-07-21T10:00:00+00:00",
            type=TransactionType.PAYMENT, amount=3000, remaining_balance_after=7000,
            cycle_id="cycle-1",
        )
    )

    fetched = list_transactions_for_loan("loan-1")
    assert fetched[0].cycle_id == "cycle-1"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && .venv/bin/python -m pytest tests/test_db.py -v
```
Expected: FAIL — `AttributeError: 'Loan' object has no attribute 'cycle_id'` (pydantic v2's default `extra='ignore'` silently drops the unrecognized `cycle_id` kwarg at construction time rather than raising there, so the error only surfaces on attribute access).

- [ ] **Step 3: Add `cycle_id` to `Loan`** — modify `backend/app/models/loan.py`'s `Loan` class so the field list reads:

```python
class Loan(BaseModel):
    loan_id: str
    member_id: str
    requested_amount: float
    approved_amount: float | None = None
    repayment_interval_days: int
    interest_rate: float
    application_date: str
    remarks: str | None = None
    status: LoanStatus = LoanStatus.PENDING_BOARD_APPROVAL
    is_exception_case: bool = False
    release_date: str | None = None
    interest_deduction: float | None = None
    net_release_amount: float | None = None
    remaining_balance: float | None = None
    next_due_date: str | None = None
    penalty_charged_for_current_cycle: bool = False
    cycle_id: str | None = None
    approvals: dict[str, ApprovalEntry] = {}
```

- [ ] **Step 4: Add `cycle_id` to `Transaction`** — modify `backend/app/models/transaction.py`'s `Transaction` class so the field list reads:

```python
class Transaction(BaseModel):
    transaction_id: str
    loan_id: str
    timestamp: str
    type: TransactionType
    amount: float
    remaining_balance_after: float
    recorded_by: str | None = None
    notes: str | None = None
    cycle_id: str | None = None
```

- [ ] **Step 5: Update `backend/app/db.py`** — in `_loan_from_item`, add a `cycle_id` line right after `next_due_date=item.get("NextDueDate"),`:

```python
        next_due_date=item.get("NextDueDate"),
        cycle_id=item.get("CycleId"),
```

In `_item_from_loan`, add this block right after the `if loan.next_due_date is not None:` block (before `return item`):

```python
    if loan.cycle_id is not None:
        item["CycleId"] = loan.cycle_id
```

In `_transaction_from_item`, add a `cycle_id` line right after `notes=item.get("Notes"),`:

```python
        notes=item.get("Notes"),
        cycle_id=item.get("CycleId"),
```

In `_item_from_transaction`, add this block right after the `if transaction.notes is not None:` block (before `return item`):

```python
    if transaction.cycle_id is not None:
        item["CycleId"] = transaction.cycle_id
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd backend && .venv/bin/python -m pytest tests/test_db.py -v
```
Expected: PASS (110 total tests in the full suite; this file gains 3 more passing tests)

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/loan.py backend/app/models/transaction.py backend/app/db.py backend/tests/test_db.py
git commit -m "feat: add cycle_id to Loan and Transaction"
```

---

### Task 3: Extend Config with Top 3 bonus percentage and ranking weights

**Files:**
- Modify: `backend/app/models/config.py`
- Modify: `backend/app/db.py`
- Modify: `backend/app/routers/config.py`
- Modify: `backend/tests/test_db.py`
- Modify: `backend/tests/test_config.py`

**Interfaces:**
- Produces: `Config.top3_bonus_percentage: float = 0`, `Config.top3_ranking_weight_amount: float = 0`, `Config.top3_ranking_weight_count: float = 0`; matching optional fields on `UpdateConfigRequest`; `PUT /config` accepts and persists them.

- [ ] **Step 1: Write the failing test** — in `backend/tests/test_db.py`, replace `test_put_and_get_config_roundtrip` with:

```python
def test_put_and_get_config_roundtrip(dynamodb_config_table):
    from app.db import get_config, put_config
    from app.models.config import Config

    config = Config(
        share_value=500,
        max_shares_per_member=5,
        default_interest_rate=0.05,
        penalty_rate=0.02,
        penalty_grace_period_hours=24,
        top3_bonus_percentage=0.1,
        top3_ranking_weight_amount=0.6,
        top3_ranking_weight_count=0.4,
    )
    put_config(config)

    assert get_config() == config
```

- [ ] **Step 2: Write the failing tests** — in `backend/tests/test_config.py`, replace the three existing tests with:

```python
def test_read_config_returns_defaults_for_any_authenticated_user(
    client, dynamodb_users_table, dynamodb_config_table
):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/config")

    assert response.status_code == 200
    assert response.json() == {
        "share_value": 0,
        "max_shares_per_member": 5,
        "default_interest_rate": 0,
        "penalty_rate": 0,
        "penalty_grace_period_hours": 0,
        "top3_bonus_percentage": 0,
        "top3_ranking_weight_amount": 0,
        "top3_ranking_weight_count": 0,
    }


def test_update_config_succeeds_for_administrator(client, dynamodb_users_table, dynamodb_config_table):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.put(
        "/config",
        json={
            "share_value": 500,
            "max_shares_per_member": 5,
            "default_interest_rate": 0.05,
            "penalty_rate": 0.02,
            "penalty_grace_period_hours": 24,
            "top3_bonus_percentage": 0.1,
            "top3_ranking_weight_amount": 0.6,
            "top3_ranking_weight_count": 0.4,
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "share_value": 500,
        "max_shares_per_member": 5,
        "default_interest_rate": 0.05,
        "penalty_rate": 0.02,
        "penalty_grace_period_hours": 24,
        "top3_bonus_percentage": 0.1,
        "top3_ranking_weight_amount": 0.6,
        "top3_ranking_weight_count": 0.4,
    }


def test_update_config_partial_update_preserves_other_fields(
    client, dynamodb_users_table, dynamodb_config_table
):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    client.put(
        "/config",
        json={
            "share_value": 500,
            "max_shares_per_member": 10,
            "default_interest_rate": 0.05,
            "penalty_rate": 0.02,
            "penalty_grace_period_hours": 24,
            "top3_bonus_percentage": 0.1,
            "top3_ranking_weight_amount": 0.6,
            "top3_ranking_weight_count": 0.4,
        },
    )
    response = client.put("/config", json={"share_value": 600})

    assert response.status_code == 200
    assert response.json() == {
        "share_value": 600,
        "max_shares_per_member": 10,
        "default_interest_rate": 0.05,
        "penalty_rate": 0.02,
        "penalty_grace_period_hours": 24,
        "top3_bonus_percentage": 0.1,
        "top3_ranking_weight_amount": 0.6,
        "top3_ranking_weight_count": 0.4,
    }


def test_update_config_rejected_for_non_administrator(client, dynamodb_users_table, dynamodb_config_table):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.put("/config", json={"share_value": 500})

    assert response.status_code == 403
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd backend && .venv/bin/python -m pytest tests/test_db.py tests/test_config.py -v
```
Expected: FAIL — `test_put_and_get_config_roundtrip` fails with `AssertionError` (round-tripped `Config` is missing the new fields' values); the three `test_config.py` tests fail with `AssertionError` (response JSON missing the three new keys).

- [ ] **Step 4: Extend `Config` and `UpdateConfigRequest`** — replace `backend/app/models/config.py` in full:

```python
from pydantic import BaseModel


class Config(BaseModel):
    share_value: float = 0
    max_shares_per_member: int = 5
    default_interest_rate: float = 0
    penalty_rate: float = 0
    penalty_grace_period_hours: int = 0
    top3_bonus_percentage: float = 0
    top3_ranking_weight_amount: float = 0
    top3_ranking_weight_count: float = 0


class UpdateConfigRequest(BaseModel):
    share_value: float | None = None
    max_shares_per_member: int | None = None
    default_interest_rate: float | None = None
    penalty_rate: float | None = None
    penalty_grace_period_hours: int | None = None
    top3_bonus_percentage: float | None = None
    top3_ranking_weight_amount: float | None = None
    top3_ranking_weight_count: float | None = None
```

- [ ] **Step 5: Update `backend/app/db.py`** — replace `get_config` and `put_config` in full:

```python
def get_config() -> Config:
    response = get_config_table().get_item(Key={"ConfigKey": CONFIG_KEY})
    item = response.get("Item")
    if item is None:
        return Config()
    return Config(
        share_value=float(item.get("ShareValue", 0)),
        max_shares_per_member=int(item.get("MaxSharesPerMember", 5)),
        default_interest_rate=float(item.get("DefaultInterestRate", 0)),
        penalty_rate=float(item.get("PenaltyRate", 0)),
        penalty_grace_period_hours=int(item.get("PenaltyGracePeriodHours", 0)),
        top3_bonus_percentage=float(item.get("Top3BonusPercentage", 0)),
        top3_ranking_weight_amount=float(item.get("Top3RankingWeightAmount", 0)),
        top3_ranking_weight_count=float(item.get("Top3RankingWeightCount", 0)),
    )


# Performs full replacement of config. Callers needing partial updates must call
# get_config() first, modify the returned object, then pass it here.
def put_config(config: Config) -> None:
    get_config_table().put_item(
        Item={
            "ConfigKey": CONFIG_KEY,
            "ShareValue": Decimal(str(config.share_value)),
            "MaxSharesPerMember": config.max_shares_per_member,
            "DefaultInterestRate": Decimal(str(config.default_interest_rate)),
            "PenaltyRate": Decimal(str(config.penalty_rate)),
            "PenaltyGracePeriodHours": config.penalty_grace_period_hours,
            "Top3BonusPercentage": Decimal(str(config.top3_bonus_percentage)),
            "Top3RankingWeightAmount": Decimal(str(config.top3_ranking_weight_amount)),
            "Top3RankingWeightCount": Decimal(str(config.top3_ranking_weight_count)),
        }
    )
```

- [ ] **Step 6: Update `backend/app/routers/config.py`** — replace `update_config` in full:

```python
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
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd backend && .venv/bin/python -m pytest tests/test_db.py tests/test_config.py -v
```
Expected: PASS (110 total tests in the full suite — same count as Task 2 since these tests were replaced in place, not added)

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/config.py backend/app/db.py backend/app/routers/config.py backend/tests/test_db.py backend/tests/test_config.py
git commit -m "feat: add Top 3 bonus percentage and ranking weights to Config"
```

---

### Task 4: Cycle lifecycle endpoints — open, list, get

**Files:**
- Create: `backend/app/routers/cycles.py`
- Create: `backend/tests/test_cycles.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes (from Task 1): `Cycle`, `CycleStatus`, `OpenCycleRequest`, `get_cycle_by_id`, `put_cycle`, `list_cycles`, `get_open_cycle`.
- Produces: `POST /cycles` (admin) → `Cycle`; `GET /cycles` (any user) → `list[Cycle]`; `GET /cycles/{cycle_id}` (any user) → `Cycle`. Router registered on `app` as `cycles.router`.

- [ ] **Step 1: Write the failing tests** — create `backend/tests/test_cycles.py`:

```python
from app.auth import get_current_user_id
from app.db import get_cycle_by_id, put_cycle, put_user
from app.main import app
from app.models.cycle import Cycle, CycleStatus
from app.models.user import User


def test_open_cycle_succeeds_for_administrator(client, dynamodb_users_table, dynamodb_cycles_table):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/cycles", json={"start_date": "2026-01-01"})

    assert response.status_code == 201
    body = response.json()
    assert body["start_date"] == "2026-01-01"
    assert body["status"] == "Open"
    assert body["end_date"] is None


def test_open_cycle_defaults_start_date_to_today(client, dynamodb_users_table, dynamodb_cycles_table):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/cycles", json={})

    assert response.status_code == 201
    assert response.json()["start_date"]


def test_open_cycle_rejects_when_a_cycle_is_already_open(client, dynamodb_users_table, dynamodb_cycles_table):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/cycles", json={"start_date": "2026-02-01"})

    assert response.status_code == 400


def test_open_cycle_allowed_after_the_previous_cycle_is_closed(client, dynamodb_users_table, dynamodb_cycles_table):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", end_date="2026-06-01", status=CycleStatus.CLOSED))
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/cycles", json={"start_date": "2026-06-02"})

    assert response.status_code == 201


def test_open_cycle_rejected_for_non_administrator(client, dynamodb_users_table, dynamodb_cycles_table):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/cycles", json={})

    assert response.status_code == 403


def test_list_cycles_returns_all_cycles_for_any_authenticated_user(
    client, dynamodb_users_table, dynamodb_cycles_table
):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.CLOSED))
    put_cycle(Cycle(cycle_id="cycle-2", start_date="2026-06-02", status=CycleStatus.OPEN))
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/cycles")

    assert response.status_code == 200
    assert {c["cycle_id"] for c in response.json()} == {"cycle-1", "cycle-2"}


def test_get_cycle_returns_cycle_for_any_authenticated_user(client, dynamodb_users_table, dynamodb_cycles_table):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/cycles/cycle-1")

    assert response.status_code == 200
    assert response.json()["cycle_id"] == "cycle-1"


def test_get_cycle_returns_404_when_missing(client, dynamodb_users_table, dynamodb_cycles_table):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/cycles/does-not-exist")

    assert response.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && .venv/bin/python -m pytest tests/test_cycles.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'app.routers.cycles'`

- [ ] **Step 3: Create `backend/app/routers/cycles.py`**

```python
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
```

- [ ] **Step 4: Register the router** — modify `backend/app/main.py` to read:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import config, cycles, health, loans, members, users


def _parse_allowed_origins(value: str) -> list[str]:
    """Split a comma-separated origin list, trimming whitespace around each
    entry so "a, b" (the natural way most people write a multi-origin list)
    works the same as "a,b"."""
    return [origin.strip() for origin in value.split(",") if origin.strip()]


app = FastAPI(title="Boombayan LMS API")
# API Gateway HTTP API's automatic CORS handling doesn't engage for OPTIONS
# requests against a $default catch-all route (this Lambda's only route,
# per infra/serverless.yml's `httpApi: '*'`) - the preflight just falls
# through to the Lambda, which returned 405 with no CORSMiddleware. Handling
# CORS here instead works regardless of routing and needs no serverless.yml
# changes as new routes are added. allow_origins is an explicit allowlist
# (CORS_ALLOWED_ORIGINS, comma-separated) rather than "*": every endpoint
# requires a valid bearer token regardless of origin today, but an explicit
# allowlist is one less thing to reason about once any cookie-based or
# unauthenticated endpoint is ever added.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_allowed_origins(settings.cors_allowed_origins),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health.router)
app.include_router(users.router)
app.include_router(members.router)
app.include_router(config.router)
app.include_router(loans.router)
app.include_router(cycles.router)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && .venv/bin/python -m pytest tests/test_cycles.py -v
```
Expected: PASS (118 total tests in the full suite; this new file contributes 8 passing tests)

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/cycles.py backend/app/main.py backend/tests/test_cycles.py
git commit -m "feat: add cycle open/list/get endpoints"
```

---

### Task 5: Stamp `cycle_id` on loan release

**Files:**
- Modify: `backend/app/routers/loans.py`
- Modify: `backend/tests/test_loans.py`

**Interfaces:**
- Consumes (from Task 1): `get_open_cycle() -> Cycle | None`.

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/test_loans.py`:

```python
def test_release_loan_stamps_current_open_cycle_id(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table,
    dynamodb_cycles_table,
):
    from app.db import put_cycle, put_loan
    from app.models.cycle import Cycle, CycleStatus
    from app.models.loan import Loan, LoanStatus

    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000, approved_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            status=LoanStatus.APPROVED,
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/release", json={"release_date": "2026-06-22"})

    assert response.json()["cycle_id"] == "cycle-1"


def test_release_loan_leaves_cycle_id_null_when_no_cycle_is_open(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table,
    dynamodb_cycles_table,
):
    from app.db import put_loan
    from app.models.loan import Loan, LoanStatus

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000, approved_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            status=LoanStatus.APPROVED,
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/release", json={"release_date": "2026-06-22"})

    assert response.json()["cycle_id"] is None
```

- [ ] **Step 2: Add the `dynamodb_cycles_table` fixture to the two existing successful release tests** — in `backend/tests/test_loans.py`, modify the parameter lists of `test_release_loan_computes_interest_and_balance` and `test_release_loan_defaults_release_date_to_today` (both currently take `client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table`) to also include `dynamodb_cycles_table`:

```python
def test_release_loan_computes_interest_and_balance(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table,
    dynamodb_cycles_table,
):
```

```python
def test_release_loan_defaults_release_date_to_today(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table,
    dynamodb_cycles_table,
):
```

(Both function bodies are unchanged — only the parameter list gains `dynamodb_cycles_table`, since `release_loan` will call `get_open_cycle()` unconditionally on every successful release once Step 4 below lands, and that requires the Cycles table to exist in the moto mock.)

- [ ] **Step 3: Run tests to verify the new ones fail**

```bash
cd backend && .venv/bin/python -m pytest tests/test_loans.py -v
```
Expected: `test_release_loan_stamps_current_open_cycle_id` FAILS (`AssertionError: assert None == 'cycle-1'`); `test_release_loan_leaves_cycle_id_null_when_no_cycle_is_open` already PASSES (the field already defaults to `None`, so this test documents/locks in behavior that happens to hold before the implementation too); all other tests still PASS.

- [ ] **Step 4: Stamp `cycle_id` on release** — modify `backend/app/routers/loans.py`: add `get_open_cycle` to the `from ..db import (...)` import block, then replace `release_loan`'s body from `loan.status = LoanStatus.ACTIVE` onward:

```python
from ..db import (
    get_config,
    get_loan_by_id,
    get_member_by_id,
    get_open_cycle,
    list_loans,
    list_transactions_for_loan,
    list_users,
    put_loan,
    put_transaction,
)
```

```python
    loan.status = LoanStatus.ACTIVE
    open_cycle = get_open_cycle()
    loan.cycle_id = open_cycle.cycle_id if open_cycle else None
    put_loan(loan)
    return loan
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && .venv/bin/python -m pytest tests/test_loans.py -v
```
Expected: PASS (120 total tests in the full suite; this file gains 2 more passing tests)

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/loans.py backend/tests/test_loans.py
git commit -m "feat: stamp cycle_id on loan release"
```

---

### Task 6: Stamp `cycle_id` on payment & penalty transactions

**Files:**
- Modify: `backend/app/routers/loans.py`
- Modify: `backend/app/penalty_engine.py`
- Modify: `backend/tests/test_payments.py`
- Modify: `backend/tests/test_penalty_engine.py`

**Interfaces:**
- Consumes (from Task 1): `get_open_cycle() -> Cycle | None`.

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/test_payments.py`:

```python
def test_record_payment_stamps_current_open_cycle_id(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table, dynamodb_cycles_table
):
    from app.db import list_transactions_for_loan, put_cycle
    from app.models.cycle import Cycle, CycleStatus

    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    _put_active_loan(remaining_balance=10000.0)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    client.post("/loans/loan-1/payments", json={"amount": 3000})

    transactions = list_transactions_for_loan("loan-1")
    assert transactions[0].cycle_id == "cycle-1"


def test_record_payment_leaves_transaction_cycle_id_null_when_no_cycle_is_open(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table, dynamodb_cycles_table
):
    from app.db import list_transactions_for_loan

    _put_active_loan(remaining_balance=10000.0)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    client.post("/loans/loan-1/payments", json={"amount": 3000})

    transactions = list_transactions_for_loan("loan-1")
    assert transactions[0].cycle_id is None
```

Append to `backend/tests/test_penalty_engine.py`:

```python
def test_run_penalty_check_stamps_current_open_cycle_id_on_penalty_transaction(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table, dynamodb_cycles_table
):
    from app.db import list_transactions_for_loan, put_cycle
    from app.models.cycle import Cycle, CycleStatus
    from app.penalty_engine import run_penalty_check

    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    put_config(Config(penalty_rate=0.02, penalty_grace_period_hours=0))
    overdue_date = (date.today() - timedelta(days=2)).isoformat()
    _put_active_loan(remaining_balance=10000.0, next_due_date=overdue_date)

    run_penalty_check()

    transactions = list_transactions_for_loan("loan-1")
    assert transactions[0].cycle_id == "cycle-1"


def test_run_penalty_check_leaves_transaction_cycle_id_null_when_no_cycle_is_open(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table, dynamodb_cycles_table
):
    from app.db import list_transactions_for_loan
    from app.penalty_engine import run_penalty_check

    put_config(Config(penalty_rate=0.02, penalty_grace_period_hours=0))
    overdue_date = (date.today() - timedelta(days=2)).isoformat()
    _put_active_loan(remaining_balance=10000.0, next_due_date=overdue_date)

    run_penalty_check()

    transactions = list_transactions_for_loan("loan-1")
    assert transactions[0].cycle_id is None
```

- [ ] **Step 2: Add the `dynamodb_cycles_table` fixture to existing tests that reach the stamping code path** — in `backend/tests/test_payments.py`, add `dynamodb_cycles_table` to the parameter lists of `test_record_payment_reduces_remaining_balance_and_advances_due_date`, `test_record_payment_records_a_transaction`, `test_record_payment_completes_loan_when_balance_reaches_zero`, `test_record_payment_resets_penalty_charged_flag`, and `test_list_transactions_returns_oldest_first` (every test that calls `POST /loans/{id}/payments` and expects it to succeed). In `backend/tests/test_penalty_engine.py`, add `dynamodb_cycles_table` to the parameter lists of `test_run_penalty_check_charges_penalty_past_grace_period`, `test_run_penalty_check_records_a_penalty_transaction`, and `test_run_penalty_check_processes_multiple_loans_independently` (every test where a penalty actually gets charged). Function bodies are unchanged in all eight cases — only the parameter lists gain `dynamodb_cycles_table`.

- [ ] **Step 3: Run tests to verify the new ones fail**

```bash
cd backend && .venv/bin/python -m pytest tests/test_payments.py tests/test_penalty_engine.py -v
```
Expected: `test_record_payment_stamps_current_open_cycle_id` FAILS (`AssertionError: assert None == 'cycle-1'`); `test_run_penalty_check_stamps_current_open_cycle_id_on_penalty_transaction` FAILS the same way; the two "leaves ... null" tests already PASS; all other tests still PASS.

- [ ] **Step 4: Stamp `cycle_id` on payment transactions** — modify `backend/app/routers/loans.py`'s `record_payment`, replacing the `put_transaction(...)` call:

```python
    open_cycle = get_open_cycle()
    put_transaction(
        Transaction(
            transaction_id=str(uuid4()),
            loan_id=loan.loan_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            type=TransactionType.PAYMENT,
            amount=body.amount,
            remaining_balance_after=loan.remaining_balance,
            recorded_by=user.user_id,
            notes=body.notes,
            cycle_id=open_cycle.cycle_id if open_cycle else None,
        )
    )
    return loan
```

- [ ] **Step 5: Stamp `cycle_id` on penalty transactions** — modify `backend/app/penalty_engine.py`: add `get_open_cycle` to the `from .db import (...)` line, then replace the `put_transaction(...)` call inside the loop:

```python
from .db import get_config, get_open_cycle, list_loans, put_loan, put_transaction
```

```python
        open_cycle = get_open_cycle()
        put_transaction(
            Transaction(
                transaction_id=str(uuid4()),
                loan_id=loan.loan_id,
                timestamp=now.isoformat(),
                type=TransactionType.PENALTY,
                amount=penalty,
                remaining_balance_after=loan.remaining_balance,
                recorded_by=None,
                notes=None,
                cycle_id=open_cycle.cycle_id if open_cycle else None,
            )
        )
        charged_count += 1
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd backend && .venv/bin/python -m pytest tests/test_payments.py tests/test_penalty_engine.py -v
```
Expected: PASS (124 total tests in the full suite; these two files gain 4 more passing tests combined)

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/loans.py backend/app/penalty_engine.py backend/tests/test_payments.py backend/tests/test_penalty_engine.py
git commit -m "feat: stamp cycle_id on payment and penalty transactions"
```

---

### Task 7: Stamp `cycle_id` on share purchase

**Files:**
- Modify: `backend/app/routers/members.py`
- Modify: `backend/tests/test_members.py`

**Interfaces:**
- Consumes (from Task 1): `get_open_cycle() -> Cycle | None`.

- [ ] **Step 1: Write the failing test** — append to `backend/tests/test_members.py`:

```python
def test_purchase_shares_stamps_current_open_cycle_id(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_cycles_table
):
    from app.db import put_config, put_cycle, put_member
    from app.models.config import Config
    from app.models.cycle import Cycle, CycleStatus
    from app.models.member import Member

    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
        )
    )
    put_config(Config(share_value=500, max_shares_per_member=5))
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/members/mem-1/shares", json={"shares_purchased": 2})

    assert response.json()["share_history"][0]["cycle_id"] == "cycle-1"
```

- [ ] **Step 2: Add the `dynamodb_cycles_table` fixture to the existing successful-purchase test** — in `backend/tests/test_members.py`, modify `test_purchase_shares_updates_totals_and_history`'s parameter list (currently `client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table`) to also include `dynamodb_cycles_table`. The body and its `assert body["share_history"][0]["cycle_id"] is None` assertion are unchanged and remain correct (no cycle is open in that test).

- [ ] **Step 3: Run tests to verify the new one fails**

```bash
cd backend && .venv/bin/python -m pytest tests/test_members.py -v
```
Expected: `test_purchase_shares_stamps_current_open_cycle_id` FAILS (`AssertionError: assert None == 'cycle-1'`); all other tests still PASS.

- [ ] **Step 4: Stamp `cycle_id` on share purchase** — modify `backend/app/routers/members.py`: add `get_open_cycle` to the `from ..db import (...)` line, then replace the `ShareHistoryEntry(...)` construction inside `purchase_shares`:

```python
from ..db import get_config, get_member_by_id, get_open_cycle, list_members, put_member
```

```python
    open_cycle = get_open_cycle()
    member.share_history.append(
        ShareHistoryEntry(
            cycle_id=open_cycle.cycle_id if open_cycle else None,
            shares_purchased=body.shares_purchased,
            share_value_at_purchase=config.share_value,
            amount_paid=amount_paid,
            date=date.today().isoformat(),
        )
    )
```

(This also removes the old `# No Cycle entity yet (deferred to future plan); always None for now, not a bug` comment, since it's no longer accurate.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && .venv/bin/python -m pytest tests/test_members.py -v
```
Expected: PASS (125 total tests in the full suite; this file gains 1 more passing test)

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/members.py backend/tests/test_members.py
git commit -m "feat: stamp cycle_id on share purchase"
```

---

### Task 8: Cycle close calculation engine

This is the core calculation logic shared verbatim by the preview and close endpoints (Task 9) — no FastAPI/HTTP involvement, matching `run_penalty_check()`'s plain-function pattern. It implements design doc §7's interest/penalty totals, Top 3 normalization/ranking/tie-break, and per-member dividend split, exactly as specified in `docs/superpowers/specs/2026-06-22-cycle-dividends-design.md` §4.

**Files:**
- Modify: `backend/app/models/cycle.py`
- Modify: `backend/app/db.py`
- Create: `backend/app/cycle_engine.py`
- Create: `backend/tests/test_cycle_engine.py`

**Interfaces:**
- Consumes (from Task 1): `get_config`, `list_loans`, `list_members`, `Cycle`. Consumes (from Task 2): `Loan.cycle_id`, `Transaction.cycle_id`. Consumes (from Task 3): `Config.top3_bonus_percentage`, `Config.top3_ranking_weight_amount`, `Config.top3_ranking_weight_count`.
- Produces: `DividendBreakdown(member_id: str, shares_at_calculation: int, share_based_amount: float, top3_bonus_amount: float, total_amount: float, rank: int|None)`; `CycleCloseResult(cycle_id: str, total_interest_earned: float, total_penalties_collected: float, top3_bonus_percentage: float, top3_bonus_pool: float, remaining_profit: float, total_shares_at_close: int, dividends: list[DividendBreakdown])`; `compute_cycle_close(cycle: Cycle) -> CycleCloseResult` in `app/cycle_engine.py`; `list_all_transactions() -> list[Transaction]` in `db.py`.

- [ ] **Step 1: Write the failing tests** — create `backend/tests/test_cycle_engine.py`:

```python
from app.db import put_config, put_loan, put_member, put_transaction
from app.models.config import Config
from app.models.cycle import Cycle, CycleStatus
from app.models.loan import Loan, LoanStatus
from app.models.member import Member, MemberStatus
from app.models.transaction import Transaction, TransactionType


def _cycle(cycle_id="cycle-1"):
    return Cycle(cycle_id=cycle_id, start_date="2026-01-01", status=CycleStatus.OPEN)


def _loan(loan_id, member_id, approved_amount, interest_deduction, cycle_id="cycle-1", application_date="2026-01-10"):
    return Loan(
        loan_id=loan_id, member_id=member_id, requested_amount=approved_amount, approved_amount=approved_amount,
        repayment_interval_days=30, interest_rate=0.1, application_date=application_date,
        status=LoanStatus.ACTIVE, release_date=application_date, interest_deduction=interest_deduction,
        net_release_amount=approved_amount - interest_deduction, remaining_balance=approved_amount,
        next_due_date="2026-02-10", cycle_id=cycle_id,
    )


def _member(member_id, current_shares, status=MemberStatus.ACTIVE):
    return Member(
        member_id=member_id, first_name="A", last_name="B", email=f"{member_id}@x.com",
        phone="1", date_joined="2026-01-01", status=status, current_shares=current_shares,
    )


def test_compute_cycle_close_sums_interest_from_loans_in_cycle(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config())
    put_loan(_loan("loan-1", "mem-1", 10000, 500))
    put_loan(_loan("loan-2", "mem-1", 5000, 250, cycle_id="cycle-2"))
    put_member(_member("mem-1", current_shares=2))

    result = compute_cycle_close(_cycle())

    assert result.total_interest_earned == 500


def test_compute_cycle_close_sums_penalties_from_transactions_in_cycle(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config())
    put_transaction(Transaction(
        transaction_id="t1", loan_id="loan-1", timestamp="2026-01-15T00:00:00+00:00",
        type=TransactionType.PENALTY, amount=100, remaining_balance_after=9000, cycle_id="cycle-1",
    ))
    put_transaction(Transaction(
        transaction_id="t2", loan_id="loan-1", timestamp="2026-01-16T00:00:00+00:00",
        type=TransactionType.PAYMENT, amount=1000, remaining_balance_after=8000, cycle_id="cycle-1",
    ))
    put_transaction(Transaction(
        transaction_id="t3", loan_id="loan-2", timestamp="2026-01-17T00:00:00+00:00",
        type=TransactionType.PENALTY, amount=50, remaining_balance_after=4000, cycle_id="cycle-2",
    ))

    result = compute_cycle_close(_cycle())

    assert result.total_penalties_collected == 100


def test_compute_cycle_close_splits_top3_bonus_among_qualifying_members(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config(top3_bonus_percentage=0.1, top3_ranking_weight_amount=1, top3_ranking_weight_count=0))
    put_loan(_loan("loan-1", "mem-1", 10000, 1000))
    put_member(_member("mem-1", current_shares=1))
    put_member(_member("mem-2", current_shares=1))

    result = compute_cycle_close(_cycle())

    assert result.total_interest_earned == 1000
    assert result.top3_bonus_pool == 100
    dividend_for_mem1 = next(d for d in result.dividends if d.member_id == "mem-1")
    assert dividend_for_mem1.rank == 1
    assert dividend_for_mem1.top3_bonus_amount == 100
    dividend_for_mem2 = next(d for d in result.dividends if d.member_id == "mem-2")
    assert dividend_for_mem2.rank is None
    assert dividend_for_mem2.top3_bonus_amount == 0


def test_compute_cycle_close_ranks_by_weighted_score_and_caps_at_three(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config(top3_bonus_percentage=0.1, top3_ranking_weight_amount=1, top3_ranking_weight_count=0))
    put_loan(_loan("loan-1", "mem-1", 1000, 100))
    put_loan(_loan("loan-2", "mem-2", 2000, 200))
    put_loan(_loan("loan-3", "mem-3", 3000, 300))
    put_loan(_loan("loan-4", "mem-4", 4000, 400))
    for member_id in ["mem-1", "mem-2", "mem-3", "mem-4"]:
        put_member(_member(member_id, current_shares=1))

    result = compute_cycle_close(_cycle())

    ranked = {d.member_id: d.rank for d in result.dividends if d.rank is not None}
    assert ranked == {"mem-4": 1, "mem-3": 2, "mem-2": 3}
    assert next(d for d in result.dividends if d.member_id == "mem-1").rank is None


def test_compute_cycle_close_breaks_ties_by_earliest_application_date(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config(top3_bonus_percentage=0.1, top3_ranking_weight_amount=1, top3_ranking_weight_count=0))
    put_loan(_loan("loan-1", "mem-1", 1000, 100, application_date="2026-01-20"))
    put_loan(_loan("loan-2", "mem-2", 1000, 100, application_date="2026-01-05"))
    put_member(_member("mem-1", current_shares=1))
    put_member(_member("mem-2", current_shares=1))

    result = compute_cycle_close(_cycle())

    ranked = {d.member_id: d.rank for d in result.dividends if d.rank is not None}
    assert ranked == {"mem-2": 1, "mem-1": 2}


def test_compute_cycle_close_distributes_share_based_amount_proportionally(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config(top3_bonus_percentage=0))
    put_loan(_loan("loan-1", "mem-1", 10000, 1000))
    put_member(_member("mem-1", current_shares=1))
    put_member(_member("mem-2", current_shares=3))

    result = compute_cycle_close(_cycle())

    assert result.remaining_profit == 1000
    assert result.total_shares_at_close == 4
    dividend_for_mem1 = next(d for d in result.dividends if d.member_id == "mem-1")
    dividend_for_mem2 = next(d for d in result.dividends if d.member_id == "mem-2")
    assert dividend_for_mem1.share_based_amount == 250
    assert dividend_for_mem2.share_based_amount == 750


def test_compute_cycle_close_excludes_non_active_members(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config())
    put_loan(_loan("loan-1", "mem-1", 10000, 1000))
    put_member(_member("mem-1", current_shares=1, status=MemberStatus.WITHDRAWN))
    put_member(_member("mem-2", current_shares=1, status=MemberStatus.ACTIVE))

    result = compute_cycle_close(_cycle())

    member_ids_in_dividends = {d.member_id for d in result.dividends}
    assert member_ids_in_dividends == {"mem-2"}


def test_compute_cycle_close_handles_zero_total_shares_without_dividing_by_zero(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config())
    put_member(_member("mem-1", current_shares=0))

    result = compute_cycle_close(_cycle())

    assert result.total_shares_at_close == 0
    assert result.dividends[0].share_based_amount == 0


def test_compute_cycle_close_with_no_qualifying_members_awards_no_top3_bonus(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_members_table, dynamodb_transactions_table
):
    from app.cycle_engine import compute_cycle_close

    put_config(Config(top3_bonus_percentage=0.1))
    put_member(_member("mem-1", current_shares=1))

    result = compute_cycle_close(_cycle())

    assert result.top3_bonus_pool == 0
    assert result.dividends[0].rank is None
    assert result.dividends[0].top3_bonus_amount == 0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && .venv/bin/python -m pytest tests/test_cycle_engine.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'app.cycle_engine'`

- [ ] **Step 3: Add `DividendBreakdown` and `CycleCloseResult`** — append to `backend/app/models/cycle.py`:

```python
class DividendBreakdown(BaseModel):
    member_id: str
    shares_at_calculation: int
    share_based_amount: float
    top3_bonus_amount: float
    total_amount: float
    rank: int | None = None


class CycleCloseResult(BaseModel):
    cycle_id: str
    total_interest_earned: float
    total_penalties_collected: float
    top3_bonus_percentage: float
    top3_bonus_pool: float
    remaining_profit: float
    total_shares_at_close: int
    dividends: list[DividendBreakdown]
```

- [ ] **Step 4: Add `list_all_transactions`** — append to `backend/app/db.py` (after `list_transactions_for_loan`):

```python
def list_all_transactions() -> list[Transaction]:
    response = get_transactions_table().scan()
    return [_transaction_from_item(item) for item in response["Items"]]
```

- [ ] **Step 5: Create `backend/app/cycle_engine.py`**

```python
from .db import get_config, list_all_transactions, list_loans, list_members
from .models.cycle import Cycle, CycleCloseResult, DividendBreakdown
from .models.member import MemberStatus
from .models.transaction import TransactionType


def compute_cycle_close(cycle: Cycle) -> CycleCloseResult:
    config = get_config()
    loans_in_cycle = [loan for loan in list_loans() if loan.cycle_id == cycle.cycle_id]
    total_interest_earned = sum(loan.interest_deduction or 0 for loan in loans_in_cycle)

    penalties_in_cycle = [
        txn for txn in list_all_transactions()
        if txn.cycle_id == cycle.cycle_id and txn.type == TransactionType.PENALTY
    ]
    total_penalties_collected = sum(txn.amount for txn in penalties_in_cycle)

    top3_bonus_pool = total_interest_earned * config.top3_bonus_percentage
    remaining_profit = total_interest_earned - top3_bonus_pool

    active_members = [m for m in list_members() if m.status == MemberStatus.ACTIVE]

    loans_by_member: dict[str, list] = {}
    for loan in loans_in_cycle:
        loans_by_member.setdefault(loan.member_id, []).append(loan)

    qualifying_member_ids = {
        member.member_id for member in active_members if member.member_id in loans_by_member
    }

    metrics = {
        member_id: {
            "total_loan_amount": sum(loan.approved_amount or 0 for loan in loans_by_member[member_id]),
            "number_of_loans": len(loans_by_member[member_id]),
        }
        for member_id in qualifying_member_ids
    }

    def normalize(values: dict[str, float]) -> dict[str, float]:
        if not values:
            return {}
        low, high = min(values.values()), max(values.values())
        if high == low:
            return {member_id: 1.0 for member_id in values}
        return {member_id: (value - low) / (high - low) for member_id, value in values.items()}

    normalized_amount = normalize({m: metrics[m]["total_loan_amount"] for m in qualifying_member_ids})
    normalized_count = normalize({m: metrics[m]["number_of_loans"] for m in qualifying_member_ids})

    scores = {
        member_id: (
            normalized_amount[member_id] * config.top3_ranking_weight_amount
            + normalized_count[member_id] * config.top3_ranking_weight_count
        )
        for member_id in qualifying_member_ids
    }

    def most_recent_application_date(member_id: str) -> str:
        return max(loan.application_date for loan in loans_by_member[member_id])

    ranked_member_ids = sorted(
        qualifying_member_ids,
        key=lambda member_id: (-scores[member_id], most_recent_application_date(member_id)),
    )[:3]

    bonus_per_ranked_member = top3_bonus_pool / len(ranked_member_ids) if ranked_member_ids else 0.0

    total_shares_at_close = sum(member.current_shares for member in active_members)

    dividends = []
    for member in active_members:
        share_based_amount = (
            remaining_profit * (member.current_shares / total_shares_at_close)
            if total_shares_at_close > 0
            else 0.0
        )
        rank = ranked_member_ids.index(member.member_id) + 1 if member.member_id in ranked_member_ids else None
        top3_bonus_amount = bonus_per_ranked_member if rank is not None else 0.0
        dividends.append(
            DividendBreakdown(
                member_id=member.member_id,
                shares_at_calculation=member.current_shares,
                share_based_amount=share_based_amount,
                top3_bonus_amount=top3_bonus_amount,
                total_amount=share_based_amount + top3_bonus_amount,
                rank=rank,
            )
        )

    return CycleCloseResult(
        cycle_id=cycle.cycle_id,
        total_interest_earned=total_interest_earned,
        total_penalties_collected=total_penalties_collected,
        top3_bonus_percentage=config.top3_bonus_percentage,
        top3_bonus_pool=top3_bonus_pool,
        remaining_profit=remaining_profit,
        total_shares_at_close=total_shares_at_close,
        dividends=dividends,
    )
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd backend && .venv/bin/python -m pytest tests/test_cycle_engine.py -v
```
Expected: PASS (134 total tests in the full suite; this new file contributes 9 passing tests)

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/cycle.py backend/app/db.py backend/app/cycle_engine.py backend/tests/test_cycle_engine.py
git commit -m "feat: add cycle close calculation engine"
```

---

### Task 9: Cycle close workflow endpoints — preview-close, close, dividends

**Files:**
- Modify: `backend/app/routers/cycles.py`
- Modify: `backend/tests/test_cycles.py`

**Interfaces:**
- Consumes (from Task 8): `compute_cycle_close(cycle: Cycle) -> CycleCloseResult`, `CycleCloseResult`, `DividendBreakdown`. Consumes (from Task 1): `CloseCycleRequest`, `Dividend`, `put_dividend`, `list_dividends_for_cycle`.
- Produces: `GET /cycles/{cycle_id}/preview-close` (admin) → `CycleCloseResult`; `POST /cycles/{cycle_id}/close` (admin) → `Cycle`; `GET /cycles/{cycle_id}/dividends` (any user) → `list[Dividend]`.

- [ ] **Step 1: Write the failing tests** — first, modify the top of `backend/tests/test_cycles.py` to also import `get_cycle_by_id` (it already does via the existing `from app.db import get_cycle_by_id, put_cycle, put_user` line — no change needed there). Append these tests to `backend/tests/test_cycles.py`:

```python
def test_preview_close_cycle_returns_computed_totals_without_persisting(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_loans_table, dynamodb_members_table,
    dynamodb_transactions_table, dynamodb_config_table, dynamodb_dividends_table,
):
    from app.db import list_dividends_for_cycle, put_loan, put_member
    from app.models.loan import Loan, LoanStatus
    from app.models.member import Member

    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000, approved_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-01-10",
            status=LoanStatus.ACTIVE, release_date="2026-01-10", interest_deduction=500,
            net_release_amount=9500, remaining_balance=10000, next_due_date="2026-02-09",
            cycle_id="cycle-1",
        )
    )
    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes", email="ana@example.com",
            phone="1", date_joined="2026-01-01", current_shares=2,
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.get("/cycles/cycle-1/preview-close")

    assert response.status_code == 200
    body = response.json()
    assert body["total_interest_earned"] == 500
    assert body["dividends"][0]["member_id"] == "mem-1"
    assert get_cycle_by_id("cycle-1").status == CycleStatus.OPEN
    assert list_dividends_for_cycle("cycle-1") == []


def test_preview_close_cycle_rejects_when_cycle_not_open(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_loans_table, dynamodb_members_table,
    dynamodb_transactions_table, dynamodb_config_table,
):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", end_date="2026-06-01", status=CycleStatus.CLOSED))
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.get("/cycles/cycle-1/preview-close")

    assert response.status_code == 400


def test_preview_close_cycle_rejected_for_non_administrator(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_loans_table, dynamodb_members_table,
    dynamodb_transactions_table, dynamodb_config_table,
):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/cycles/cycle-1/preview-close")

    assert response.status_code == 403


def test_close_cycle_persists_totals_and_dividends(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_loans_table, dynamodb_members_table,
    dynamodb_transactions_table, dynamodb_config_table, dynamodb_dividends_table,
):
    from app.db import list_dividends_for_cycle, put_loan, put_member
    from app.models.loan import Loan, LoanStatus
    from app.models.member import Member

    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000, approved_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-01-10",
            status=LoanStatus.ACTIVE, release_date="2026-01-10", interest_deduction=500,
            net_release_amount=9500, remaining_balance=10000, next_due_date="2026-02-09",
            cycle_id="cycle-1",
        )
    )
    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes", email="ana@example.com",
            phone="1", date_joined="2026-01-01", current_shares=2,
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/cycles/cycle-1/close", json={"end_date": "2026-06-30"})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "Closed"
    assert body["end_date"] == "2026-06-30"
    assert body["total_interest_earned"] == 500
    assert body["closed_at"]

    dividends = list_dividends_for_cycle("cycle-1")
    assert len(dividends) == 1
    assert dividends[0].member_id == "mem-1"
    assert dividends[0].total_amount == 500


def test_close_cycle_rejects_when_cycle_not_open(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_loans_table, dynamodb_members_table,
    dynamodb_transactions_table, dynamodb_config_table,
):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", end_date="2026-06-01", status=CycleStatus.CLOSED))
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/cycles/cycle-1/close", json={})

    assert response.status_code == 400


def test_close_cycle_rejected_for_non_administrator(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_loans_table, dynamodb_members_table,
    dynamodb_transactions_table, dynamodb_config_table,
):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/cycles/cycle-1/close", json={})

    assert response.status_code == 403


def test_close_cycle_returns_404_when_missing(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_loans_table, dynamodb_members_table,
    dynamodb_transactions_table, dynamodb_config_table,
):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/cycles/does-not-exist/close", json={})

    assert response.status_code == 404


def test_get_cycle_dividends_returns_empty_list_for_open_cycle(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_dividends_table
):
    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/cycles/cycle-1/dividends")

    assert response.status_code == 200
    assert response.json() == []


def test_get_cycle_dividends_returns_persisted_dividends_after_close(
    client, dynamodb_users_table, dynamodb_cycles_table, dynamodb_loans_table, dynamodb_members_table,
    dynamodb_transactions_table, dynamodb_config_table, dynamodb_dividends_table,
):
    from app.db import put_loan, put_member
    from app.models.loan import Loan, LoanStatus
    from app.models.member import Member

    put_cycle(Cycle(cycle_id="cycle-1", start_date="2026-01-01", status=CycleStatus.OPEN))
    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000, approved_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-01-10",
            status=LoanStatus.ACTIVE, release_date="2026-01-10", interest_deduction=500,
            net_release_amount=9500, remaining_balance=10000, next_due_date="2026-02-09",
            cycle_id="cycle-1",
        )
    )
    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes", email="ana@example.com",
            phone="1", date_joined="2026-01-01", current_shares=2,
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"
    client.post("/cycles/cycle-1/close", json={"end_date": "2026-06-30"})

    response = client.get("/cycles/cycle-1/dividends")

    assert response.status_code == 200
    assert response.json()[0]["member_id"] == "mem-1"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && .venv/bin/python -m pytest tests/test_cycles.py -v
```
Expected: FAIL — `404`/`405`-style failures, since `/preview-close`, `/close`, and `/dividends` don't exist yet (FastAPI returns `404 Not Found` for unregistered routes, so these tests fail their `assert response.status_code == 200/400/403/404` checks against the wrong status code, e.g. expecting `200` but getting `404` for the preview-close request itself).

- [ ] **Step 3: Add the three endpoints** — modify `backend/app/routers/cycles.py` in full:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && .venv/bin/python -m pytest tests/test_cycles.py -v
```
Expected: PASS (143 total tests in the full suite; this file gains 9 more passing tests)

- [ ] **Step 5: Run the full backend suite**

```bash
cd backend && .venv/bin/python -m pytest -v
```
Expected: PASS (143 passed)

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/cycles.py backend/tests/test_cycles.py
git commit -m "feat: add cycle preview-close, close, and dividends endpoints"
```

---

### Task 10: Deploy updated backend to AWS

**Files:** none (deploy + verify only).

- [ ] **Step 1: Run the full backend suite one last time before deploying**

```bash
cd backend && .venv/bin/python -m pytest -v
```
Expected: all tests PASS (143 passed).

- [ ] **Step 2: Deploy**

```bash
cd infra && npx serverless deploy && cd ..
```
Expected: deploy succeeds; output ends with an `endpoints:` section.

- [ ] **Step 3: Verify the Cycles table is healthy**

```bash
aws dynamodb describe-table --table-name boombayan-api-dev-cycles --query 'Table.TableStatus'
```
Expected: `"ACTIVE"`.

- [ ] **Step 4: Verify the Dividends table is healthy**

```bash
aws dynamodb describe-table --table-name boombayan-api-dev-dividends --query 'Table.TableStatus'
```
Expected: `"ACTIVE"`.

- [ ] **Step 5: Verify the deployed health endpoint still responds**

```bash
curl https://<id>.execute-api.us-east-1.amazonaws.com/health
```
Expected: `{"status":"ok"}`

No commit for this task — it's a deploy of work already committed in Tasks 1-9.

---

### Task 11: Shared API types and Settings page Top 3 fields

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/pages/SettingsPage.test.tsx`

**Interfaces:**
- Produces (TypeScript, mirroring Task 1/2/3/8's Pydantic models 1:1): `CycleStatus`, `Cycle`, `Dividend`, `DividendBreakdown`, `CycleCloseResult` interfaces; extends `Config`, `Loan`, `Transaction` with the new fields.

- [ ] **Step 1: Write the failing test** — in `frontend/src/pages/SettingsPage.test.tsx`, replace the `config` constant and the three tests' bodies to read:

```typescript
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { SettingsPage } from './SettingsPage'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

const config = {
  share_value: 500,
  max_shares_per_member: 5,
  default_interest_rate: 0.05,
  penalty_rate: 0.02,
  penalty_grace_period_hours: 24,
  top3_bonus_percentage: 0.1,
  top3_ranking_weight_amount: 0.6,
  top3_ranking_weight_count: 0.4,
}

describe('SettingsPage', () => {
  it('shows the current config values after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue(config)

    render(<SettingsPage />)

    await waitFor(() => expect(screen.getByLabelText('Share value')).toHaveValue(500))
    expect(screen.getByLabelText('Max shares per member')).toHaveValue(5)
    expect(screen.getByLabelText('Default interest rate')).toHaveValue(0.05)
    expect(screen.getByLabelText('Penalty rate')).toHaveValue(0.02)
    expect(screen.getByLabelText('Penalty grace period (hours)')).toHaveValue(24)
    expect(screen.getByLabelText('Top 3 bonus percentage')).toHaveValue(0.1)
    expect(screen.getByLabelText('Top 3 ranking weight (amount)')).toHaveValue(0.6)
    expect(screen.getByLabelText('Top 3 ranking weight (count)')).toHaveValue(0.4)
  })

  it('saves updated config values on submit', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValueOnce(config)

    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByLabelText('Share value')).toHaveValue(500))

    const updatedConfig = { ...config, share_value: 600 }
    vi.mocked(apiFetch).mockResolvedValueOnce(updatedConfig)
    fireEvent.change(screen.getByLabelText('Share value'), { target: { value: '600' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/config', 'fake-id-token', {
        method: 'PUT',
        body: {
          share_value: 600,
          max_shares_per_member: 5,
          default_interest_rate: 0.05,
          penalty_rate: 0.02,
          penalty_grace_period_hours: 24,
          top3_bonus_percentage: 0.1,
          top3_ranking_weight_amount: 0.6,
          top3_ranking_weight_count: 0.4,
        },
      }),
    )
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
  })

  it('shows an error message when saving fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValueOnce(config)

    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByLabelText('Share value')).toHaveValue(500))

    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save settings.')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/pages/SettingsPage.test.tsx
```
Expected: FAIL — `Unable to find a label with the text of: Top 3 bonus percentage` (the field doesn't exist on the page yet).

- [ ] **Step 3: Extend `Config`, `Loan`, and `Transaction`, and add `Cycle`/`Dividend` types** — modify `frontend/src/api/types.ts`: replace the `Config` interface, and append the new interfaces and the `cycle_id` fields:

```typescript
export interface Config {
  share_value: number
  max_shares_per_member: number
  default_interest_rate: number
  penalty_rate: number
  penalty_grace_period_hours: number
  top3_bonus_percentage: number
  top3_ranking_weight_amount: number
  top3_ranking_weight_count: number
}
```

Add `cycle_id: string | null` to `Loan` (after `penalty_charged_for_current_cycle: boolean`):

```typescript
export interface Loan {
  loan_id: string
  member_id: string
  requested_amount: number
  approved_amount: number | null
  repayment_interval_days: number
  interest_rate: number
  application_date: string
  remarks: string | null
  status: LoanStatus
  is_exception_case: boolean
  release_date: string | null
  interest_deduction: number | null
  net_release_amount: number | null
  remaining_balance: number | null
  next_due_date: string | null
  penalty_charged_for_current_cycle: boolean
  cycle_id: string | null
  approvals: Record<string, ApprovalEntry>
}
```

Add `cycle_id: string | null` to `Transaction`, and append the `Cycle`/`Dividend`/`DividendBreakdown`/`CycleCloseResult` types at the end of the file:

```typescript
export interface Transaction {
  transaction_id: string
  loan_id: string
  timestamp: string
  type: TransactionType
  amount: number
  remaining_balance_after: number
  recorded_by: string | null
  notes: string | null
  cycle_id: string | null
}

export type CycleStatus = 'Open' | 'Closed'

export interface Cycle {
  cycle_id: string
  start_date: string
  end_date: string | null
  status: CycleStatus
  total_interest_earned: number | null
  total_penalties_collected: number | null
  top3_bonus_percentage: number | null
  top3_bonus_pool: number | null
  remaining_profit: number | null
  total_shares_at_close: number | null
  closed_at: string | null
}

export interface Dividend {
  cycle_id: string
  member_id: string
  share_based_amount: number
  top3_bonus_amount: number
  total_amount: number
  shares_at_calculation: number
  rank: number | null
}

export interface DividendBreakdown {
  member_id: string
  shares_at_calculation: number
  share_based_amount: number
  top3_bonus_amount: number
  total_amount: number
  rank: number | null
}

export interface CycleCloseResult {
  cycle_id: string
  total_interest_earned: number
  total_penalties_collected: number
  top3_bonus_percentage: number
  top3_bonus_pool: number
  remaining_profit: number
  total_shares_at_close: number
  dividends: DividendBreakdown[]
}
```

- [ ] **Step 4: Add the three Settings fields** — replace `frontend/src/pages/SettingsPage.tsx` in full:

```typescript
import { FormEvent, useEffect, useState } from 'react'
import { apiFetch } from '../api/client'
import { Config } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export function SettingsPage() {
  const { idToken } = useAuth()
  const [config, setConfig] = useState<Config | null>(null)
  const [shareValue, setShareValue] = useState('')
  const [maxShares, setMaxShares] = useState('')
  const [defaultInterestRate, setDefaultInterestRate] = useState('')
  const [penaltyRate, setPenaltyRate] = useState('')
  const [penaltyGracePeriodHours, setPenaltyGracePeriodHours] = useState('')
  const [top3BonusPercentage, setTop3BonusPercentage] = useState('')
  const [top3RankingWeightAmount, setTop3RankingWeightAmount] = useState('')
  const [top3RankingWeightCount, setTop3RankingWeightCount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!idToken) return
    let cancelled = false
    apiFetch<Config>('/config', idToken)
      .then((data) => {
        if (cancelled) return
        setConfig(data)
        setShareValue(String(data.share_value))
        setMaxShares(String(data.max_shares_per_member))
        setDefaultInterestRate(String(data.default_interest_rate))
        setPenaltyRate(String(data.penalty_rate))
        setPenaltyGracePeriodHours(String(data.penalty_grace_period_hours))
        setTop3BonusPercentage(String(data.top3_bonus_percentage))
        setTop3RankingWeightAmount(String(data.top3_ranking_weight_amount))
        setTop3RankingWeightCount(String(data.top3_ranking_weight_count))
      })
      .catch(() => {
        if (!cancelled) setError('Could not load settings.')
      })
    return () => {
      cancelled = true
    }
  }, [idToken])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!idToken) return
    setSaveError(null)
    setSaved(false)
    try {
      const updated = await apiFetch<Config>('/config', idToken, {
        method: 'PUT',
        body: {
          share_value: Number(shareValue),
          max_shares_per_member: Number(maxShares),
          default_interest_rate: Number(defaultInterestRate),
          penalty_rate: Number(penaltyRate),
          penalty_grace_period_hours: Number(penaltyGracePeriodHours),
          top3_bonus_percentage: Number(top3BonusPercentage),
          top3_ranking_weight_amount: Number(top3RankingWeightAmount),
          top3_ranking_weight_count: Number(top3RankingWeightCount),
        },
      })
      setConfig(updated)
      setSaved(true)
    } catch {
      setSaveError('Could not save settings.')
    }
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!config) {
    return <p>Loading...</p>
  }

  return (
    <div>
      <h1>Settings</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="share-value">Share value</label>
        <input
          id="share-value"
          type="number"
          value={shareValue}
          onChange={(e) => setShareValue(e.target.value)}
          required
        />
        <label htmlFor="max-shares">Max shares per member</label>
        <input
          id="max-shares"
          type="number"
          value={maxShares}
          onChange={(e) => setMaxShares(e.target.value)}
          required
        />
        <label htmlFor="default-interest-rate">Default interest rate</label>
        <input
          id="default-interest-rate"
          type="number"
          step="0.01"
          value={defaultInterestRate}
          onChange={(e) => setDefaultInterestRate(e.target.value)}
          required
        />
        <label htmlFor="penalty-rate">Penalty rate</label>
        <input
          id="penalty-rate"
          type="number"
          step="0.01"
          value={penaltyRate}
          onChange={(e) => setPenaltyRate(e.target.value)}
          required
        />
        <label htmlFor="penalty-grace-period-hours">Penalty grace period (hours)</label>
        <input
          id="penalty-grace-period-hours"
          type="number"
          value={penaltyGracePeriodHours}
          onChange={(e) => setPenaltyGracePeriodHours(e.target.value)}
          required
        />
        <label htmlFor="top3-bonus-percentage">Top 3 bonus percentage</label>
        <input
          id="top3-bonus-percentage"
          type="number"
          step="0.01"
          value={top3BonusPercentage}
          onChange={(e) => setTop3BonusPercentage(e.target.value)}
          required
        />
        <label htmlFor="top3-ranking-weight-amount">Top 3 ranking weight (amount)</label>
        <input
          id="top3-ranking-weight-amount"
          type="number"
          step="0.01"
          value={top3RankingWeightAmount}
          onChange={(e) => setTop3RankingWeightAmount(e.target.value)}
          required
        />
        <label htmlFor="top3-ranking-weight-count">Top 3 ranking weight (count)</label>
        <input
          id="top3-ranking-weight-count"
          type="number"
          step="0.01"
          value={top3RankingWeightCount}
          onChange={(e) => setTop3RankingWeightCount(e.target.value)}
          required
        />
        {saveError && <p role="alert">{saveError}</p>}
        {saved && <p>Settings saved.</p>}
        <button type="submit">Save</button>
      </form>
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/pages/SettingsPage.test.tsx
```
Expected: PASS (3 passed)

- [ ] **Step 6: Run the full frontend suite**

```bash
cd frontend && npx vitest run
```
Expected: PASS (54 passed) — same count as baseline since no tests were added, only modified in place.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/pages/SettingsPage.tsx frontend/src/pages/SettingsPage.test.tsx
git commit -m "feat: add Top 3 bonus percentage and ranking weight fields to Settings page"
```

---

### Task 12: CyclesPage — list cycles and open a new one

**Files:**
- Create: `frontend/src/pages/CyclesPage.tsx`
- Create: `frontend/src/pages/CyclesPage.test.tsx`
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/pages/DashboardPage.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes (from Task 11): `Cycle` type, `GET /cycles`, `POST /cycles`.
- Produces: route `/cycles` rendering `CyclesPage`.

- [ ] **Step 1: Write the failing tests** — create `frontend/src/pages/CyclesPage.test.tsx`:

```typescript
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { CyclesPage } from './CyclesPage'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

const openCycle = {
  cycle_id: 'cycle-1',
  start_date: '2026-01-01',
  end_date: null,
  status: 'Open',
  total_interest_earned: null,
  total_penalties_collected: null,
  top3_bonus_percentage: null,
  top3_bonus_pool: null,
  remaining_profit: null,
  total_shares_at_close: null,
  closed_at: null,
}

const admin = { user_id: 'admin-1', email: 'admin@boombayan.org', is_administrator: true, member_id: null }

describe('CyclesPage', () => {
  it('shows the list of cycles after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/cycles' ? Promise.resolve([openCycle]) : Promise.resolve(admin),
    )

    render(
      <MemoryRouter>
        <CyclesPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('2026-01-01')).toBeInTheDocument())
    expect(screen.getByText('Open')).toBeInTheDocument()
  })

  it('hides the open-cycle form when a cycle is already open', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/cycles' ? Promise.resolve([openCycle]) : Promise.resolve(admin),
    )

    render(
      <MemoryRouter>
        <CyclesPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('2026-01-01')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Open cycle' })).not.toBeInTheDocument()
  })

  it('opens a new cycle when none is open', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/cycles' ? Promise.resolve([]) : Promise.resolve(admin),
    )

    render(
      <MemoryRouter>
        <CyclesPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('button', { name: 'Open cycle' })).toBeInTheDocument())

    vi.mocked(apiFetch).mockResolvedValueOnce(openCycle)
    fireEvent.click(screen.getByRole('button', { name: 'Open cycle' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/cycles', 'fake-id-token', {
        method: 'POST',
        body: { start_date: null },
      }),
    )
    expect(await screen.findByText('2026-01-01')).toBeInTheDocument()
  })

  it('shows an error message when the cycles fetch fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    render(
      <MemoryRouter>
        <CyclesPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load cycles.')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/pages/CyclesPage.test.tsx
```
Expected: FAIL — `Failed to resolve import "./CyclesPage"`

- [ ] **Step 3: Create `frontend/src/pages/CyclesPage.tsx`**

```typescript
import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Cycle } from '../api/types'
import { useAuth } from '../auth/AuthContext'

interface CurrentUser {
  user_id: string
  email: string
  is_administrator: boolean
  member_id: string | null
}

export function CyclesPage() {
  const { idToken } = useAuth()
  const [cycles, setCycles] = useState<Cycle[] | null>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [startDate, setStartDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  useEffect(() => {
    if (!idToken) return
    let cancelled = false
    Promise.all([apiFetch<Cycle[]>('/cycles', idToken), apiFetch<CurrentUser>('/me', idToken)])
      .then(([cyclesData, userData]) => {
        if (!cancelled) {
          setCycles(cyclesData)
          setCurrentUser(userData)
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load cycles.')
      })
    return () => {
      cancelled = true
    }
  }, [idToken])

  async function handleOpenCycle(event: FormEvent) {
    event.preventDefault()
    if (!idToken) return
    setOpenError(null)
    try {
      const created = await apiFetch<Cycle>('/cycles', idToken, {
        method: 'POST',
        body: { start_date: startDate || null },
      })
      setCycles((prev) => [...(prev ?? []), created])
      setStartDate('')
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : 'Could not open a new cycle.')
    }
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!cycles || !currentUser) {
    return <p>Loading...</p>
  }

  const hasOpenCycle = cycles.some((cycle) => cycle.status === 'Open')

  return (
    <div>
      <h1>Cycles</h1>
      <table>
        <thead>
          <tr>
            <th>Start date</th>
            <th>End date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {cycles.map((cycle) => (
            <tr key={cycle.cycle_id}>
              <td>
                <Link to={`/cycles/${cycle.cycle_id}`}>{cycle.start_date}</Link>
              </td>
              <td>{cycle.end_date ?? '-'}</td>
              <td>{cycle.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {currentUser.is_administrator && !hasOpenCycle && (
        <form onSubmit={handleOpenCycle}>
          <h2>Open a new cycle</h2>
          <label htmlFor="start-date">Start date</label>
          <input id="start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          {openError && <p role="alert">{openError}</p>}
          <button type="submit">Open cycle</button>
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Add the "Cycles" nav link** — modify `frontend/src/pages/DashboardPage.tsx`'s `<nav>` block to read:

```typescript
      <nav>
        <Link to="/members">Members</Link>
        <Link to="/loans">Loans</Link>
        <Link to="/cycles">Cycles</Link>
        {user.is_administrator && <Link to="/settings">Settings</Link>}
      </nav>
```

Add the corresponding assertion to `frontend/src/pages/DashboardPage.test.tsx`'s first test (`'shows the current user email, role, and navigation links after loading'`), right after the existing `Loans` link assertion:

```typescript
    expect(screen.getByRole('link', { name: 'Loans' })).toHaveAttribute('href', '/loans')
    expect(screen.getByRole('link', { name: 'Cycles' })).toHaveAttribute('href', '/cycles')
```

- [ ] **Step 5: Add the `/cycles` route** — modify `frontend/src/App.tsx`:

```typescript
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AddMemberPage } from './pages/AddMemberPage'
import { CyclesPage } from './pages/CyclesPage'
import { DashboardPage } from './pages/DashboardPage'
import { LoanDetailPage } from './pages/LoanDetailPage'
import { LoansPage } from './pages/LoansPage'
import { LoginPage } from './pages/LoginPage'
import { MemberDetailPage } from './pages/MemberDetailPage'
import { MembersPage } from './pages/MembersPage'
import { NewLoanPage } from './pages/NewLoanPage'
import { SettingsPage } from './pages/SettingsPage'

function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/members" element={<MembersPage />} />
            <Route path="/members/new" element={<AddMemberPage />} />
            <Route path="/members/:memberId" element={<MemberDetailPage />} />
            <Route path="/loans" element={<LoansPage />} />
            <Route path="/loans/new" element={<NewLoanPage />} />
            <Route path="/loans/:loanId" element={<LoanDetailPage />} />
            <Route path="/cycles" element={<CyclesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/pages/CyclesPage.test.tsx src/pages/DashboardPage.test.tsx
```
Expected: PASS (8 passed)

- [ ] **Step 7: Run the full frontend suite**

```bash
cd frontend && npx vitest run
```
Expected: PASS (58 passed)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/CyclesPage.tsx frontend/src/pages/CyclesPage.test.tsx frontend/src/pages/DashboardPage.tsx frontend/src/pages/DashboardPage.test.tsx frontend/src/App.tsx
git commit -m "feat: add Cycles list page with open-cycle action"
```

---

### Task 13: CycleDetailPage — preview close, confirm close, and view dividends

**Files:**
- Create: `frontend/src/pages/CycleDetailPage.tsx`
- Create: `frontend/src/pages/CycleDetailPage.test.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes (from Task 11): `Cycle`, `Dividend`, `CycleCloseResult`, `Member` types, `GET /cycles/{id}`, `GET /cycles/{id}/dividends`, `GET /cycles/{id}/preview-close`, `POST /cycles/{id}/close`, `GET /members`.
- Produces: route `/cycles/:cycleId` rendering `CycleDetailPage`.

- [ ] **Step 1: Write the failing tests** — create `frontend/src/pages/CycleDetailPage.test.tsx`:

```typescript
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { CycleDetailPage } from './CycleDetailPage'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

const openCycle = {
  cycle_id: 'cycle-1',
  start_date: '2026-01-01',
  end_date: null,
  status: 'Open',
  total_interest_earned: null,
  total_penalties_collected: null,
  top3_bonus_percentage: null,
  top3_bonus_pool: null,
  remaining_profit: null,
  total_shares_at_close: null,
  closed_at: null,
}

const admin = { user_id: 'admin-1', email: 'admin@boombayan.org', is_administrator: true, member_id: null }

const member = {
  member_id: 'mem-1', first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com',
  phone: '1', date_joined: '2026-01-15', status: 'Active', current_shares: 2,
  current_capital_amount: 1000, share_history: [],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/cycles/cycle-1']}>
      <Routes>
        <Route path="/cycles/:cycleId" element={<CycleDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function mockFetchFor(cycle: typeof openCycle, dividends: unknown[] = []) {
  vi.mocked(apiFetch).mockImplementation((path) => {
    if (path === '/cycles/cycle-1') return Promise.resolve(cycle)
    if (path === '/me') return Promise.resolve(admin)
    if (path === '/cycles/cycle-1/dividends') return Promise.resolve(dividends)
    if (path === '/members') return Promise.resolve([member])
    throw new Error(`Unexpected path: ${path}`)
  })
}

describe('CycleDetailPage', () => {
  it('shows cycle details after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockFetchFor(openCycle)

    renderPage()

    await waitFor(() => expect(screen.getByText('Status: Open')).toBeInTheDocument())
    expect(screen.getByText('Start date: 2026-01-01')).toBeInTheDocument()
  })

  it('previews the close before confirming', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockFetchFor(openCycle)

    renderPage()
    await waitFor(() => expect(screen.getByText('Status: Open')).toBeInTheDocument())

    const previewResult = {
      cycle_id: 'cycle-1',
      total_interest_earned: 1000,
      total_penalties_collected: 0,
      top3_bonus_percentage: 0,
      top3_bonus_pool: 0,
      remaining_profit: 1000,
      total_shares_at_close: 2,
      dividends: [
        {
          member_id: 'mem-1', shares_at_calculation: 2, share_based_amount: 1000,
          top3_bonus_amount: 0, total_amount: 1000, rank: null,
        },
      ],
    }
    vi.mocked(apiFetch).mockResolvedValueOnce(previewResult)
    fireEvent.click(screen.getByRole('button', { name: 'Preview close' }))

    await waitFor(() => expect(screen.getByText('Ana Reyes')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Confirm close' })).toBeInTheDocument()
  })

  it('confirms the close and refreshes the dividend list', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockFetchFor(openCycle)

    renderPage()
    await waitFor(() => expect(screen.getByText('Status: Open')).toBeInTheDocument())

    const previewResult = {
      cycle_id: 'cycle-1', total_interest_earned: 1000, total_penalties_collected: 0,
      top3_bonus_percentage: 0, top3_bonus_pool: 0, remaining_profit: 1000, total_shares_at_close: 2,
      dividends: [
        { member_id: 'mem-1', shares_at_calculation: 2, share_based_amount: 1000, top3_bonus_amount: 0, total_amount: 1000, rank: null },
      ],
    }
    vi.mocked(apiFetch).mockResolvedValueOnce(previewResult)
    fireEvent.click(screen.getByRole('button', { name: 'Preview close' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm close' })).toBeInTheDocument())

    const closedCycle = { ...openCycle, status: 'Closed', end_date: '2026-06-23', remaining_profit: 1000 }
    vi.mocked(apiFetch).mockResolvedValueOnce(closedCycle)
    const dividendRecord = {
      cycle_id: 'cycle-1', member_id: 'mem-1', share_based_amount: 1000,
      top3_bonus_amount: 0, total_amount: 1000, shares_at_calculation: 2, rank: null,
    }
    vi.mocked(apiFetch).mockResolvedValueOnce([dividendRecord])
    fireEvent.click(screen.getByRole('button', { name: 'Confirm close' }))

    await waitFor(() => expect(screen.getByText('Status: Closed')).toBeInTheDocument())
    expect(apiFetch).toHaveBeenCalledWith('/cycles/cycle-1/close', 'fake-id-token', {
      method: 'POST',
      body: { end_date: null },
    })
  })

  it('shows an error message when the cycle fetch fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this cycle.')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/pages/CycleDetailPage.test.tsx
```
Expected: FAIL — `Failed to resolve import "./CycleDetailPage"`

- [ ] **Step 3: Create `frontend/src/pages/CycleDetailPage.tsx`**

```typescript
import { FormEvent, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Cycle, CycleCloseResult, Dividend, Member } from '../api/types'
import { useAuth } from '../auth/AuthContext'

interface CurrentUser {
  user_id: string
  email: string
  is_administrator: boolean
  member_id: string | null
}

export function CycleDetailPage() {
  const { cycleId } = useParams<{ cycleId: string }>()
  const { idToken } = useAuth()
  const [cycle, setCycle] = useState<Cycle | null>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [dividends, setDividends] = useState<Dividend[]>([])
  const [preview, setPreview] = useState<CycleCloseResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [endDate, setEndDate] = useState('')

  useEffect(() => {
    if (!idToken || !cycleId) return
    let cancelled = false
    Promise.all([
      apiFetch<Cycle>(`/cycles/${cycleId}`, idToken),
      apiFetch<CurrentUser>('/me', idToken),
      apiFetch<Dividend[]>(`/cycles/${cycleId}/dividends`, idToken),
      apiFetch<Member[]>('/members', idToken),
    ])
      .then(([cycleData, userData, dividendsData, membersData]) => {
        if (!cancelled) {
          setCycle(cycleData)
          setCurrentUser(userData)
          setDividends(dividendsData)
          setMembers(membersData)
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this cycle.')
      })
    return () => {
      cancelled = true
    }
  }, [idToken, cycleId])

  function memberName(memberId: string): string {
    const member = members.find((m) => m.member_id === memberId)
    return member ? `${member.first_name} ${member.last_name}` : memberId
  }

  async function handlePreviewClose() {
    if (!idToken || !cycleId) return
    setPreviewError(null)
    try {
      const result = await apiFetch<CycleCloseResult>(`/cycles/${cycleId}/preview-close`, idToken)
      setPreview(result)
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Could not preview this close.')
    }
  }

  async function handleConfirmClose(event: FormEvent) {
    event.preventDefault()
    if (!idToken || !cycleId) return
    setCloseError(null)
    try {
      const updated = await apiFetch<Cycle>(`/cycles/${cycleId}/close`, idToken, {
        method: 'POST',
        body: { end_date: endDate || null },
      })
      setCycle(updated)
      setPreview(null)
      const updatedDividends = await apiFetch<Dividend[]>(`/cycles/${cycleId}/dividends`, idToken)
      setDividends(updatedDividends)
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : 'Could not close this cycle.')
    }
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!cycle || !currentUser) {
    return <p>Loading...</p>
  }

  const canClose = currentUser.is_administrator && cycle.status === 'Open'

  return (
    <div>
      <h1>Cycle {cycle.cycle_id}</h1>
      <p>Status: {cycle.status}</p>
      <p>Start date: {cycle.start_date}</p>
      <p>End date: {cycle.end_date ?? '-'}</p>
      <p>Total interest earned: {cycle.total_interest_earned ?? '-'}</p>
      <p>Total penalties collected: {cycle.total_penalties_collected ?? '-'}</p>
      <p>Top 3 bonus pool: {cycle.top3_bonus_pool ?? '-'}</p>
      <p>Remaining profit: {cycle.remaining_profit ?? '-'}</p>
      <p>Total shares at close: {cycle.total_shares_at_close ?? '-'}</p>

      {canClose && (
        <div>
          <h2>Close this cycle</h2>
          <button type="button" onClick={handlePreviewClose}>Preview close</button>
          {previewError && <p role="alert">{previewError}</p>}
          {preview && (
            <form onSubmit={handleConfirmClose}>
              <h3>Preview</h3>
              <p>Total interest earned: {preview.total_interest_earned}</p>
              <p>Total penalties collected: {preview.total_penalties_collected}</p>
              <p>Top 3 bonus pool: {preview.top3_bonus_pool}</p>
              <p>Remaining profit: {preview.remaining_profit}</p>
              <table>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Shares</th>
                    <th>Rank</th>
                    <th>Share-based amount</th>
                    <th>Top 3 bonus</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.dividends.map((dividend) => (
                    <tr key={dividend.member_id}>
                      <td>{memberName(dividend.member_id)}</td>
                      <td>{dividend.shares_at_calculation}</td>
                      <td>{dividend.rank ?? '-'}</td>
                      <td>{dividend.share_based_amount}</td>
                      <td>{dividend.top3_bonus_amount}</td>
                      <td>{dividend.total_amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <label htmlFor="end-date">End date</label>
              <input id="end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              {closeError && <p role="alert">{closeError}</p>}
              <button type="submit">Confirm close</button>
            </form>
          )}
        </div>
      )}

      <h2>Dividends</h2>
      <table>
        <thead>
          <tr>
            <th>Member</th>
            <th>Shares</th>
            <th>Rank</th>
            <th>Share-based amount</th>
            <th>Top 3 bonus</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {dividends.map((dividend) => (
            <tr key={dividend.member_id}>
              <td>{memberName(dividend.member_id)}</td>
              <td>{dividend.shares_at_calculation}</td>
              <td>{dividend.rank ?? '-'}</td>
              <td>{dividend.share_based_amount}</td>
              <td>{dividend.top3_bonus_amount}</td>
              <td>{dividend.total_amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Add the `/cycles/:cycleId` route** — modify `frontend/src/App.tsx`: add the import and route:

```typescript
import { CycleDetailPage } from './pages/CycleDetailPage'
```

```typescript
            <Route path="/cycles" element={<CyclesPage />} />
            <Route path="/cycles/:cycleId" element={<CycleDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/pages/CycleDetailPage.test.tsx
```
Expected: PASS (4 passed)

- [ ] **Step 6: Run the full frontend suite**

```bash
cd frontend && npx vitest run
```
Expected: PASS (62 passed)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/CycleDetailPage.tsx frontend/src/pages/CycleDetailPage.test.tsx frontend/src/App.tsx
git commit -m "feat: add Cycle detail page with preview-close, confirm-close, and dividends"
```

---

### Task 14: End-to-end manual verification

Real proof against the live deployed stack, no mocks — same philosophy as Plans 1-4's final verification tasks. Uses the existing administrator account (`michaelseno@gmail.com`).

**Execution note:** run via a scripted headless-Chromium (Playwright) session against `npm run dev`, same pattern as Plans 1-4.

**Files:** none (manual verification only).

- [ ] **Step 1: Confirm `frontend/.env.local` still has real values**

```bash
cat frontend/.env.local
```
Expected: three lines, no placeholders.

- [ ] **Step 2: Start the frontend dev server**

```bash
cd frontend && npm run dev
```
Expected: prints a local URL, typically `http://localhost:5173/`.

- [ ] **Step 3: Log in as the existing administrator**

Navigate to `http://localhost:5173/`, log in with `michaelseno@gmail.com` and the real password.
Expected: redirected to `/dashboard`, and a "Cycles" link now appears in the nav alongside "Members"/"Loans"/"Settings".

- [ ] **Step 4: Configure the Top 3 bonus percentage and ranking weights**

Click "Settings". Set "Top 3 bonus percentage" to `0.1`, "Top 3 ranking weight (amount)" to `0.6`, "Top 3 ranking weight (count)" to `0.4` (leave the other fields at whatever they're already set to), click "Save".
Expected: "Settings saved." appears. Reload the page — the three new fields still show `0.1`, `0.6`, `0.4`.

- [ ] **Step 5: Open a new cycle**

Click "Cycles".
Expected: an "Open a new cycle" form is visible (no cycle is currently open from prior plans' verification work). Leave "Start date" blank, click "Open cycle".
Expected: a new row appears in the cycles table with today's date and status `Open`; the "Open a new cycle" form disappears (a cycle is now open).

- [ ] **Step 6: Add a fresh member with no capital**

Click "Members", then "Add member". Fill in a first name, last name, email, and phone, click "Create member".
Expected: redirected to `/members/<new-id>`, showing "Current capital: 0".

- [ ] **Step 7: Create, approve, and release a loan against the open cycle**

Click "Loans", then "New loan application". Select the member just created, enter `10000` for "Requested amount" and `30` for "Repayment interval (days)", click "Submit application". On the loan detail page, click "Approve", then leave "Release date" blank and click "Release loan".
Expected: "Status:" ends at `Active`, "Remaining balance: 10000".

- [ ] **Step 8: Record a full payment to complete the loan**

In "Record a payment", enter `10000`, click "Record payment".
Expected: "Status:" updates to `Completed`; "Remaining balance: 0".

- [ ] **Step 9: Preview the cycle close**

Click "Cycles", then click into the open cycle's row. Click "Preview close".
Expected: a "Preview" section appears showing "Total interest earned:" a positive number (the released loan's interest deduction), and a dividend table row for the new member with a "Total" amount.

- [ ] **Step 10: Confirm the close**

Leave "End date" blank, click "Confirm close".
Expected: "Status:" updates to `Closed`; "End date:" shows today's date; the "Dividends" table at the bottom of the page now shows the same row that appeared in the preview.

- [ ] **Step 11: Verify the cycle can't be closed twice**

Reload the page.
Expected: no "Close this cycle" section is visible anymore (the cycle is `Closed`, not `Open`), and the "Dividends" table still shows the persisted row.

- [ ] **Step 12: Verify the Cycles list reflects the update**

Navigate back to "Cycles".
Expected: the cycle's row shows status `Closed` with an end date, and an "Open a new cycle" form is visible again (no cycle is currently open).

- [ ] **Step 13: Stop the dev server**

```bash
# Ctrl+C in the terminal running npm run dev
cd ..
```

No commit for this task — it's verification of work already committed in Tasks 1-13.

---

### Task 15: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document cycle close and dividend distribution, and update the "What's not here yet" section** — modify `README.md`: insert a new section after "Recording payments and the penalty engine" (before "## What's not here yet"):

```markdown
## Cycle close and dividend distribution

An administrator opens a cycle from the Cycles page (`/cycles`) — only one
cycle can be open at a time. While a cycle is open, every loan release,
payment, penalty, and share purchase is stamped with that cycle's ID, so
the close calculation knows exactly what to include. From the open cycle's
detail page, an administrator can "Preview close" to see the computed
interest/penalty totals, Top 3 ranking, and per-member dividend breakdown
without committing anything, then "Confirm close" to persist it. Closing a
cycle is irreversible — there is no reopen action. Any authenticated user
can view a cycle's final totals and dividend table afterward. The Top 3
bonus percentage and ranking weights are configured from the Settings page
and default to `0` (no bonus, no ranking impact) until the board sets real
values.
```

Replace the "## What's not here yet" section to read:

```markdown
## What's not here yet

This is Plan 5 of a multi-plan project — auth, dashboard shell, member/share
management, the loan lifecycle, payments/penalties, and now cycle close with
dividend distribution. A UI/visual polish pass and the Reporting module (8
report types) are designed but not yet built; see `docs/superpowers/plans/`
for the phase breakdown.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document cycle close and dividend distribution"
```

---
