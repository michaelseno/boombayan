# Plan 4: Payments & Penalties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an administrator pay down an `Active` loan's `RemainingBalance` to `Completed`, and run an automated penalty engine that charges a loan once per missed due date (design doc §4, §6), on top of Plans 1-3's auth/infra/member/loan foundation.

**Architecture:** Same FastAPI/Lambda/DynamoDB/React stack as Plans 1-3. A new DynamoDB-backed `Transactions` table (PK `LoanId`, SK `Timestamp`, no GSI) records both payments and penalties. A new `POST /loans/{id}/payments` endpoint pays down a loan; a new `GET /loans/{id}/transactions` endpoint lists its history. The penalty engine is a plain Python function (`run_penalty_check()`) wired to a second Lambda function triggered by an EventBridge `rate(6 hours)` schedule, sharing the API Lambda's existing IAM role. `Config` gains `penalty_rate`/`penalty_grace_period_hours`. Frontend adds a payment form and transaction history table to the existing Loan detail page, and two new fields to the existing Settings page — no new routes.

**Tech Stack:** Same as Plans 1-3 — no new dependencies required.

## Global Constraints

- Backend: Python 3.12, FastAPI 0.115.0, boto3 1.35.36, pydantic 2.9.2 — exact versions pinned in `backend/requirements.txt`, unchanged by this plan.
- Frontend: no new npm dependencies.
- AWS region `us-east-1`, stage `dev` (`infra/serverless.yml`'s existing `${opt:stage, 'dev'}`), unchanged by this plan.
- DynamoDB attribute names are PascalCase (`LoanId`, `RemainingBalance`); Python/TypeScript field names are snake_case, matching 1:1 between `backend/app/models/*.py` Pydantic models and `frontend/src/api/types.ts` interfaces.
- Every code task follows TDD: write the failing test, run it to confirm it fails, write the minimal implementation, run it to confirm it passes, commit.

---

### Task 1: Transactions DynamoDB table

**Files:**
- Modify: `infra/serverless.yml`

- [ ] **Step 1: Add the `TRANSACTIONS_TABLE` env var** — modify the `provider.environment` block to read:

```yaml
  environment:
    USERS_TABLE: ${self:service}-${sls:stage}-users
    CONFIG_TABLE: ${self:service}-${sls:stage}-config
    MEMBERS_TABLE: ${self:service}-${sls:stage}-members
    LOANS_TABLE: ${self:service}-${sls:stage}-loans
    TRANSACTIONS_TABLE: ${self:service}-${sls:stage}-transactions
    COGNITO_USER_POOL_ID: !Ref CognitoUserPool
    COGNITO_CLIENT_ID: !Ref CognitoUserPoolClient
    CORS_ALLOWED_ORIGINS: http://localhost:5173,http://localhost:5174
```

- [ ] **Step 2: Add the table's ARN to the IAM statement** — modify the `provider.iam.role.statements[0].Resource` list to read:

```yaml
          Resource:
            - !GetAtt UsersTable.Arn
            - !GetAtt ConfigTable.Arn
            - !GetAtt MembersTable.Arn
            - !GetAtt LoansTable.Arn
            - !GetAtt TransactionsTable.Arn
```

- [ ] **Step 3: Add the `TransactionsTable` resource** — under `resources.Resources`, insert this block immediately after `LoansTable` (before `CognitoUserPool`):

```yaml
    TransactionsTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:provider.environment.TRANSACTIONS_TABLE}
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: LoanId
            AttributeType: S
          - AttributeName: Timestamp
            AttributeType: S
        KeySchema:
          - AttributeName: LoanId
            KeyType: HASH
          - AttributeName: Timestamp
            KeyType: RANGE
        PointInTimeRecoverySpecification:
          PointInTimeRecoveryEnabled: true
```

- [ ] **Step 4: Deploy**

```bash
cd infra && npx serverless deploy && cd ..
```
Expected: deploy succeeds.

- [ ] **Step 5: Verify the table exists**

```bash
aws dynamodb describe-table --table-name boombayan-api-dev-transactions --query 'Table.TableStatus'
```
Expected: prints `"ACTIVE"`.

- [ ] **Step 6: Commit**

```bash
git add infra/serverless.yml
git commit -m "feat: provision Transactions DynamoDB table"
```

---

### Task 2: Extend Config with `penalty_rate` and `penalty_grace_period_hours`

Both default to `0`, matching the existing zero-default convention for unconfigured rates (design doc §2). The penalty engine (Task 6) will treat `penalty_rate <= 0` as "not configured yet" and skip entirely.

**Files:**
- Modify: `backend/app/models/config.py`
- Modify: `backend/app/db.py`
- Modify: `backend/app/routers/config.py`
- Modify: `backend/tests/test_db.py`
- Modify: `backend/tests/test_config.py`

- [ ] **Step 1: Write the failing tests** — in `backend/tests/test_db.py`, replace `test_put_and_get_config_roundtrip` with:

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
    )
    put_config(config)

    assert get_config() == config
```

In `backend/tests/test_config.py`, replace the full file contents:

```python
from app.auth import get_current_user_id
from app.db import put_user
from app.main import app
from app.models.user import User


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
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "share_value": 500,
        "max_shares_per_member": 5,
        "default_interest_rate": 0.05,
        "penalty_rate": 0.02,
        "penalty_grace_period_hours": 24,
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
    }


def test_update_config_rejected_for_non_administrator(client, dynamodb_users_table, dynamodb_config_table):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.put("/config", json={"share_value": 500})

    assert response.status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && source .venv/bin/activate && pytest tests/test_db.py tests/test_config.py -v
```
Expected: FAIL — assertions reference `penalty_rate`/`penalty_grace_period_hours` keys that don't exist yet.

- [ ] **Step 3: Write `backend/app/models/config.py`**

```python
from pydantic import BaseModel


class Config(BaseModel):
    share_value: float = 0
    max_shares_per_member: int = 5
    default_interest_rate: float = 0
    penalty_rate: float = 0
    penalty_grace_period_hours: int = 0


class UpdateConfigRequest(BaseModel):
    share_value: float | None = None
    max_shares_per_member: int | None = None
    default_interest_rate: float | None = None
    penalty_rate: float | None = None
    penalty_grace_period_hours: int | None = None
```

- [ ] **Step 4: Update the repository functions** — in `backend/app/db.py`, replace `get_config`/`put_config` with:

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
    )


def put_config(config: Config) -> None:
    get_config_table().put_item(
        Item={
            "ConfigKey": CONFIG_KEY,
            "ShareValue": Decimal(str(config.share_value)),
            "MaxSharesPerMember": config.max_shares_per_member,
            "DefaultInterestRate": Decimal(str(config.default_interest_rate)),
            "PenaltyRate": Decimal(str(config.penalty_rate)),
            "PenaltyGracePeriodHours": config.penalty_grace_period_hours,
        }
    )
```

- [ ] **Step 5: Update the endpoint** — in `backend/app/routers/config.py`, replace `update_config` with:

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
    put_config(config)
    return config
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pytest tests/test_db.py tests/test_config.py -v
```
Expected: PASS (18 passed)

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/config.py backend/app/db.py backend/app/routers/config.py backend/tests/test_db.py backend/tests/test_config.py
git commit -m "feat: add penalty_rate and penalty_grace_period_hours to Config"
```

---

### Task 3: Loan model extensions, Transaction model, and Transaction DynamoDB repository functions

**Files:**
- Modify: `backend/app/models/loan.py`
- Create: `backend/app/models/transaction.py`
- Modify: `backend/app/config.py`
- Modify: `backend/app/db.py`
- Modify: `backend/tests/conftest.py`
- Modify: `backend/tests/test_db.py`

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/test_db.py`:

```python
def test_put_and_get_loan_persists_penalty_charged_flag_and_completed_status(dynamodb_loans_table):
    from app.db import get_loan_by_id, put_loan
    from app.models.loan import Loan, LoanStatus

    loan = Loan(
        loan_id="loan-1",
        member_id="mem-1",
        requested_amount=10000,
        approved_amount=10000,
        repayment_interval_days=30,
        interest_rate=0.05,
        application_date="2026-06-21",
        status=LoanStatus.COMPLETED,
        release_date="2026-06-21",
        interest_deduction=500,
        net_release_amount=9500,
        remaining_balance=0,
        next_due_date="2026-07-21",
        penalty_charged_for_current_cycle=True,
    )
    put_loan(loan)

    fetched = get_loan_by_id("loan-1")
    assert fetched == loan


def test_put_and_get_transaction_roundtrip(dynamodb_transactions_table):
    from app.db import get_transactions_table, put_transaction
    from app.models.transaction import Transaction, TransactionType

    transaction = Transaction(
        transaction_id="txn-1",
        loan_id="loan-1",
        timestamp="2026-07-21T10:00:00+00:00",
        type=TransactionType.PAYMENT,
        amount=3000,
        remaining_balance_after=7000,
        recorded_by="admin-1",
        notes="First installment",
    )
    put_transaction(transaction)

    response = get_transactions_table().get_item(
        Key={"LoanId": "loan-1", "Timestamp": "2026-07-21T10:00:00+00:00"}
    )
    assert response["Item"]["TransactionId"] == "txn-1"


def test_list_transactions_for_loan_returns_oldest_first(dynamodb_transactions_table):
    from app.db import list_transactions_for_loan, put_transaction
    from app.models.transaction import Transaction, TransactionType

    put_transaction(
        Transaction(
            transaction_id="txn-2", loan_id="loan-1", timestamp="2026-07-21T12:00:00+00:00",
            type=TransactionType.PAYMENT, amount=1000, remaining_balance_after=9000,
        )
    )
    put_transaction(
        Transaction(
            transaction_id="txn-1", loan_id="loan-1", timestamp="2026-07-21T10:00:00+00:00",
            type=TransactionType.PAYMENT, amount=1000, remaining_balance_after=8000,
        )
    )

    transactions = list_transactions_for_loan("loan-1")
    assert [t.transaction_id for t in transactions] == ["txn-1", "txn-2"]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_db.py -v
```
Expected: FAIL — `TypeError` on `penalty_charged_for_current_cycle` (unexpected keyword) and `ModuleNotFoundError: No module named 'app.models.transaction'`.

- [ ] **Step 3: Write `backend/app/models/transaction.py`**

```python
from enum import Enum

from pydantic import BaseModel


class TransactionType(str, Enum):
    PAYMENT = "PAYMENT"
    PENALTY = "PENALTY"


class Transaction(BaseModel):
    transaction_id: str
    loan_id: str
    timestamp: str
    type: TransactionType
    amount: float
    remaining_balance_after: float
    recorded_by: str | None = None
    notes: str | None = None
```

- [ ] **Step 4: Extend `backend/app/models/loan.py`** — add `COMPLETED` to `LoanStatus`, add `penalty_charged_for_current_cycle` to `Loan`, and add `CreatePaymentRequest`. Replace the full file contents:

```python
from enum import Enum

from pydantic import BaseModel, Field, field_validator


class LoanStatus(str, Enum):
    PENDING_BOARD_APPROVAL = "Pending Board Approval"
    APPROVED = "Approved"
    ACTIVE = "Active"
    REJECTED = "Rejected"
    COMPLETED = "Completed"


class ApprovalVoteStatus(str, Enum):
    PENDING = "Pending"
    APPROVED = "Approved"
    REJECTED = "Rejected"


class ApprovalEntry(BaseModel):
    # Email is snapshotted from the User at loan-creation time, purely for
    # display — this avoids needing a GET /users endpoint just to label
    # votes in the frontend's approvals table.
    email: str
    status: ApprovalVoteStatus = ApprovalVoteStatus.PENDING
    date: str | None = None
    comments: str | None = None


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
    approvals: dict[str, ApprovalEntry] = {}


class CreateLoanRequest(BaseModel):
    member_id: str
    requested_amount: float = Field(gt=0)
    repayment_interval_days: int = Field(gt=0)
    remarks: str | None = None


class CastVoteRequest(BaseModel):
    status: ApprovalVoteStatus
    comments: str | None = None

    @field_validator("status")
    @classmethod
    def status_must_be_decided(cls, value: ApprovalVoteStatus) -> ApprovalVoteStatus:
        if value == ApprovalVoteStatus.PENDING:
            raise ValueError("status must be Approved or Rejected")
        return value


class ReleaseLoanRequest(BaseModel):
    release_date: str | None = None


class CreatePaymentRequest(BaseModel):
    amount: float = Field(gt=0)
    payment_date: str | None = None
    notes: str | None = None
```

- [ ] **Step 5: Add `transactions_table` setting** — modify `backend/app/config.py` to read:

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    users_table: str = "boombayan-api-dev-users"
    config_table: str = "boombayan-api-dev-config"
    members_table: str = "boombayan-api-dev-members"
    loans_table: str = "boombayan-api-dev-loans"
    transactions_table: str = "boombayan-api-dev-transactions"
    cognito_user_pool_id: str = ""
    cognito_client_id: str = ""
    aws_region: str = "us-east-1"
    cors_allowed_origins: str = "http://localhost:5173"


settings = Settings()
```

- [ ] **Step 6: Add the `dynamodb_transactions_table` fixture** — modify `backend/tests/conftest.py` to add this fixture after `dynamodb_loans_table`:

```python
@pytest.fixture
def dynamodb_transactions_table(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "transactions_table", "test-transactions")

    with mock_aws():
        dynamo_client = boto3.client("dynamodb", region_name="us-east-1")
        dynamo_client.create_table(
            TableName="test-transactions",
            AttributeDefinitions=[
                {"AttributeName": "LoanId", "AttributeType": "S"},
                {"AttributeName": "Timestamp", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "LoanId", "KeyType": "HASH"},
                {"AttributeName": "Timestamp", "KeyType": "RANGE"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        yield
```

- [ ] **Step 7: Update `backend/app/db.py`** — add `from boto3.dynamodb.conditions import Key` to the imports at the top, add `from .models.transaction import Transaction, TransactionType` alongside the existing model imports, update `_loan_from_item`/`_item_from_loan`, and append the Transaction repository functions.

Update the top of the file to read:

```python
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

from .config import settings
from .models.config import Config
from .models.loan import ApprovalEntry, ApprovalVoteStatus, Loan, LoanStatus
from .models.member import Member, MemberStatus, ShareHistoryEntry
from .models.transaction import Transaction, TransactionType
from .models.user import User
```

Replace `_loan_from_item` with:

```python
def _loan_from_item(item: dict) -> Loan:
    return Loan(
        loan_id=item["LoanId"],
        member_id=item["MemberId"],
        requested_amount=float(item["RequestedAmount"]),
        approved_amount=float(item["ApprovedAmount"]) if "ApprovedAmount" in item else None,
        repayment_interval_days=int(item["RepaymentIntervalDays"]),
        interest_rate=float(item["InterestRate"]),
        application_date=item["ApplicationDate"],
        remarks=item.get("Remarks"),
        status=LoanStatus(item["Status"]),
        is_exception_case=bool(item["IsExceptionCase"]),
        release_date=item.get("ReleaseDate"),
        interest_deduction=float(item["InterestDeduction"]) if "InterestDeduction" in item else None,
        net_release_amount=float(item["NetReleaseAmount"]) if "NetReleaseAmount" in item else None,
        remaining_balance=float(item["RemainingBalance"]) if "RemainingBalance" in item else None,
        next_due_date=item.get("NextDueDate"),
        # .get(..., False), not direct indexing: loans written before this
        # field existed have no PenaltyChargedForCurrentCycle attribute at all.
        penalty_charged_for_current_cycle=bool(item.get("PenaltyChargedForCurrentCycle", False)),
        approvals=_approvals_from_item(item),
    )
```

Replace `_item_from_loan`'s base dict (everything up to and including `"Approvals"`, leaving the `if loan.approved_amount is not None:` block onward unchanged) with:

```python
def _item_from_loan(loan: Loan) -> dict:
    item = {
        "LoanId": loan.loan_id,
        "MemberId": loan.member_id,
        "RequestedAmount": Decimal(str(loan.requested_amount)),
        "RepaymentIntervalDays": loan.repayment_interval_days,
        "InterestRate": Decimal(str(loan.interest_rate)),
        "ApplicationDate": loan.application_date,
        "Status": loan.status.value,
        "IsExceptionCase": loan.is_exception_case,
        "PenaltyChargedForCurrentCycle": loan.penalty_charged_for_current_cycle,
        "Approvals": _item_from_approvals(loan.approvals),
    }
```

Append the Transaction repository functions at the end of the file:

```python
def get_transactions_table():
    return _dynamodb().Table(settings.transactions_table)


def _transaction_from_item(item: dict) -> Transaction:
    return Transaction(
        transaction_id=item["TransactionId"],
        loan_id=item["LoanId"],
        timestamp=item["Timestamp"],
        type=TransactionType(item["Type"]),
        amount=float(item["Amount"]),
        remaining_balance_after=float(item["RemainingBalanceAfter"]),
        recorded_by=item.get("RecordedBy"),
        notes=item.get("Notes"),
    )


def _item_from_transaction(transaction: Transaction) -> dict:
    item = {
        "LoanId": transaction.loan_id,
        "Timestamp": transaction.timestamp,
        "TransactionId": transaction.transaction_id,
        "Type": transaction.type.value,
        "Amount": Decimal(str(transaction.amount)),
        "RemainingBalanceAfter": Decimal(str(transaction.remaining_balance_after)),
    }
    if transaction.recorded_by is not None:
        item["RecordedBy"] = transaction.recorded_by
    if transaction.notes is not None:
        item["Notes"] = transaction.notes
    return item


def put_transaction(transaction: Transaction) -> None:
    get_transactions_table().put_item(Item=_item_from_transaction(transaction))


def list_transactions_for_loan(loan_id: str) -> list[Transaction]:
    response = get_transactions_table().query(KeyConditionExpression=Key("LoanId").eq(loan_id))
    return [_transaction_from_item(item) for item in response["Items"]]
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
pytest tests/test_db.py -v
```
Expected: PASS (17 passed)

- [ ] **Step 9: Commit**

```bash
git add backend/app/models/loan.py backend/app/models/transaction.py backend/app/config.py backend/app/db.py backend/tests/conftest.py backend/tests/test_db.py
git commit -m "feat: add Transaction model, Loan Completed status, and penalty-charged flag"
```

---

### Task 4: `POST /loans/{loan_id}/payments` — record payment endpoint

Admin-only, mirroring `release_loan`. Overpayment (`amount > RemainingBalance`) is rejected outright (400). A successful payment pays down `RemainingBalance`, advances `NextDueDate`, resets `PenaltyChargedForCurrentCycle`, and moves the loan to `Completed` if the balance reaches exactly zero.

**Files:**
- Modify: `backend/app/routers/loans.py`
- Create: `backend/tests/test_payments.py`

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_payments.py`

```python
from app.auth import get_current_user_id
from app.db import put_loan, put_user
from app.main import app
from app.models.loan import Loan, LoanStatus
from app.models.user import User


def _put_active_loan(loan_id="loan-1", remaining_balance=10000.0, next_due_date=None, penalty_charged_for_current_cycle=False):
    put_loan(
        Loan(
            loan_id=loan_id,
            member_id="mem-1",
            requested_amount=10000,
            approved_amount=10000,
            repayment_interval_days=30,
            interest_rate=0.05,
            application_date="2026-06-21",
            status=LoanStatus.ACTIVE,
            release_date="2026-06-21",
            interest_deduction=500,
            net_release_amount=9500,
            remaining_balance=remaining_balance,
            next_due_date=next_due_date or "2026-07-21",
            penalty_charged_for_current_cycle=penalty_charged_for_current_cycle,
        )
    )


def test_record_payment_reduces_remaining_balance_and_advances_due_date(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    _put_active_loan(remaining_balance=10000.0)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/loans/loan-1/payments",
        json={"amount": 3000, "payment_date": "2026-07-21"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["remaining_balance"] == 7000
    assert body["next_due_date"] == "2026-08-20"
    assert body["status"] == "Active"
    assert body["penalty_charged_for_current_cycle"] is False


def test_record_payment_records_a_transaction(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    _put_active_loan(remaining_balance=10000.0)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    client.post("/loans/loan-1/payments", json={"amount": 3000, "notes": "First installment"})

    from app.db import list_transactions_for_loan

    transactions = list_transactions_for_loan("loan-1")
    assert len(transactions) == 1
    assert transactions[0].type.value == "PAYMENT"
    assert transactions[0].amount == 3000
    assert transactions[0].remaining_balance_after == 7000
    assert transactions[0].recorded_by == "admin-1"
    assert transactions[0].notes == "First installment"


def test_record_payment_completes_loan_when_balance_reaches_zero(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    _put_active_loan(remaining_balance=5000.0)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/payments", json={"amount": 5000})

    assert response.status_code == 200
    assert response.json()["status"] == "Completed"
    assert response.json()["remaining_balance"] == 0


def test_record_payment_resets_penalty_charged_flag(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    _put_active_loan(remaining_balance=10000.0, penalty_charged_for_current_cycle=True)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/payments", json={"amount": 1000})

    assert response.json()["penalty_charged_for_current_cycle"] is False


def test_record_payment_rejects_overpayment(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    _put_active_loan(remaining_balance=5000.0)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/payments", json={"amount": 5001})

    assert response.status_code == 400


def test_record_payment_rejects_when_loan_not_active(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/payments", json={"amount": 1000})

    assert response.status_code == 400


def test_record_payment_rejected_for_non_administrator(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    _put_active_loan()
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/payments", json={"amount": 1000})

    assert response.status_code == 403


def test_record_payment_returns_404_when_loan_missing(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/does-not-exist/payments", json={"amount": 1000})

    assert response.status_code == 404


def test_record_payment_rejects_non_positive_amount(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    _put_active_loan()
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/payments", json={"amount": 0})

    assert response.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_payments.py -v
```
Expected: FAIL — `404 Not Found` for `POST /loans/loan-1/payments` (route doesn't exist yet).

- [ ] **Step 3: Add the endpoint** — modify `backend/app/routers/loans.py`. Change the `datetime` import line to read:

```python
from datetime import date, datetime, timedelta, timezone
```

Change the `..db` import to read:

```python
from ..db import (
    get_config,
    get_loan_by_id,
    get_member_by_id,
    list_loans,
    list_users,
    put_loan,
    put_transaction,
)
```

Change the `..models.loan` import to read:

```python
from ..models.loan import (
    ApprovalEntry,
    ApprovalVoteStatus,
    CastVoteRequest,
    CreateLoanRequest,
    CreatePaymentRequest,
    Loan,
    LoanStatus,
    ReleaseLoanRequest,
)
```

Add a new import line immediately after the `..models.member` import:

```python
from ..models.transaction import Transaction, TransactionType
```

Append the endpoint at the end of the file:

```python
@router.post("/loans/{loan_id}/payments", response_model=Loan)
def record_payment(loan_id: str, body: CreatePaymentRequest, user: User = Depends(require_admin)) -> Loan:
    loan = get_loan_by_id(loan_id)
    if loan is None:
        raise HTTPException(status_code=404, detail="Loan not found")
    if loan.status != LoanStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Payments can only be recorded against an active loan")
    if body.amount > loan.remaining_balance:
        raise HTTPException(status_code=400, detail="Payment amount exceeds the remaining balance")

    payment_date = body.payment_date or date.today().isoformat()
    loan.remaining_balance -= body.amount
    loan.next_due_date = (
        date.fromisoformat(payment_date) + timedelta(days=loan.repayment_interval_days)
    ).isoformat()
    loan.penalty_charged_for_current_cycle = False
    if loan.remaining_balance <= 0:
        loan.status = LoanStatus.COMPLETED
    put_loan(loan)

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
        )
    )
    return loan
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_payments.py -v
```
Expected: PASS (9 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/loans.py backend/tests/test_payments.py
git commit -m "feat: add POST /loans/{loan_id}/payments endpoint"
```

---

### Task 5: `GET /loans/{loan_id}/transactions` — transaction history endpoint

**Files:**
- Modify: `backend/app/routers/loans.py`
- Modify: `backend/tests/test_payments.py`

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/test_payments.py`:

```python
def test_list_transactions_returns_empty_list_for_loan_with_no_payments(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    _put_active_loan()
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/loans/loan-1/transactions")

    assert response.status_code == 200
    assert response.json() == []


def test_list_transactions_returns_404_when_loan_missing(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/loans/does-not-exist/transactions")

    assert response.status_code == 404


def test_list_transactions_returns_oldest_first(
    client, dynamodb_users_table, dynamodb_loans_table, dynamodb_transactions_table
):
    _put_active_loan(remaining_balance=10000.0)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    client.post("/loans/loan-1/payments", json={"amount": 1000})
    client.post("/loans/loan-1/payments", json={"amount": 2000})

    response = client.get("/loans/loan-1/transactions")
    amounts = [t["amount"] for t in response.json()]
    assert amounts == [1000, 2000]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_payments.py -v
```
Expected: FAIL — `404 Not Found` for `GET /loans/loan-1/transactions` (route doesn't exist yet).

- [ ] **Step 3: Add the endpoint** — add `list_transactions_for_loan` to the `..db` import in `backend/app/routers/loans.py` (it now reads):

```python
from ..db import (
    get_config,
    get_loan_by_id,
    get_member_by_id,
    list_loans,
    list_transactions_for_loan,
    list_users,
    put_loan,
    put_transaction,
)
```

Append the endpoint at the end of the file:

```python
@router.get("/loans/{loan_id}/transactions", response_model=list[Transaction])
def get_loan_transactions(loan_id: str, user: User = Depends(get_current_user)) -> list[Transaction]:
    loan = get_loan_by_id(loan_id)
    if loan is None:
        raise HTTPException(status_code=404, detail="Loan not found")
    return list_transactions_for_loan(loan_id)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_payments.py -v
```
Expected: PASS (12 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/loans.py backend/tests/test_payments.py
git commit -m "feat: add GET /loans/{loan_id}/transactions endpoint"
```

---

### Task 6: Penalty engine core logic

`run_penalty_check()` is a plain function — no FastAPI/HTTP layer, since it's not user-triggered (design doc §4). It's callable identically from tests now and from a Lambda handler in Task 7. It skips entirely while `Config.penalty_rate <= 0`, so it stays inert until an administrator opts in via Settings.

**Files:**
- Create: `backend/app/penalty_engine.py`
- Create: `backend/tests/test_penalty_engine.py`

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_penalty_engine.py`

```python
from datetime import date, timedelta

from app.db import get_loan_by_id, list_transactions_for_loan, put_config, put_loan
from app.models.config import Config
from app.models.loan import Loan, LoanStatus


def _put_active_loan(loan_id="loan-1", remaining_balance=10000.0, next_due_date=None, penalty_charged_for_current_cycle=False):
    put_loan(
        Loan(
            loan_id=loan_id,
            member_id="mem-1",
            requested_amount=10000,
            approved_amount=10000,
            repayment_interval_days=30,
            interest_rate=0.05,
            application_date="2026-05-01",
            status=LoanStatus.ACTIVE,
            release_date="2026-05-01",
            interest_deduction=500,
            net_release_amount=9500,
            remaining_balance=remaining_balance,
            next_due_date=next_due_date or date.today().isoformat(),
            penalty_charged_for_current_cycle=penalty_charged_for_current_cycle,
        )
    )


def test_run_penalty_check_charges_penalty_past_grace_period(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table
):
    from app.penalty_engine import run_penalty_check

    put_config(Config(penalty_rate=0.02, penalty_grace_period_hours=0))
    overdue_date = (date.today() - timedelta(days=2)).isoformat()
    _put_active_loan(remaining_balance=10000.0, next_due_date=overdue_date)

    charged = run_penalty_check()

    assert charged == 1
    loan = get_loan_by_id("loan-1")
    assert loan.remaining_balance == 10200.0
    assert loan.penalty_charged_for_current_cycle is True


def test_run_penalty_check_records_a_penalty_transaction(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table
):
    from app.penalty_engine import run_penalty_check

    put_config(Config(penalty_rate=0.02, penalty_grace_period_hours=0))
    overdue_date = (date.today() - timedelta(days=2)).isoformat()
    _put_active_loan(remaining_balance=10000.0, next_due_date=overdue_date)

    run_penalty_check()

    transactions = list_transactions_for_loan("loan-1")
    assert len(transactions) == 1
    assert transactions[0].type.value == "PENALTY"
    assert transactions[0].amount == 200.0
    assert transactions[0].remaining_balance_after == 10200.0
    assert transactions[0].recorded_by is None


def test_run_penalty_check_skips_before_grace_period_elapses(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table
):
    from app.penalty_engine import run_penalty_check

    put_config(Config(penalty_rate=0.02, penalty_grace_period_hours=24))
    due_today = date.today().isoformat()
    _put_active_loan(remaining_balance=10000.0, next_due_date=due_today)

    charged = run_penalty_check()

    assert charged == 0
    assert get_loan_by_id("loan-1").remaining_balance == 10000.0


def test_run_penalty_check_skips_when_already_charged_for_current_cycle(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table
):
    from app.penalty_engine import run_penalty_check

    put_config(Config(penalty_rate=0.02, penalty_grace_period_hours=0))
    overdue_date = (date.today() - timedelta(days=2)).isoformat()
    _put_active_loan(remaining_balance=10000.0, next_due_date=overdue_date, penalty_charged_for_current_cycle=True)

    charged = run_penalty_check()

    assert charged == 0
    assert get_loan_by_id("loan-1").remaining_balance == 10000.0


def test_run_penalty_check_skips_when_penalty_rate_is_zero(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table
):
    from app.penalty_engine import run_penalty_check

    put_config(Config(penalty_rate=0, penalty_grace_period_hours=0))
    overdue_date = (date.today() - timedelta(days=2)).isoformat()
    _put_active_loan(remaining_balance=10000.0, next_due_date=overdue_date)

    charged = run_penalty_check()

    assert charged == 0
    assert get_loan_by_id("loan-1").remaining_balance == 10000.0


def test_run_penalty_check_skips_non_active_loans(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table
):
    from app.penalty_engine import run_penalty_check

    put_config(Config(penalty_rate=0.02, penalty_grace_period_hours=0))
    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-05-01",
            status=LoanStatus.REJECTED,
        )
    )

    charged = run_penalty_check()

    assert charged == 0


def test_run_penalty_check_processes_multiple_loans_independently(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table
):
    from app.penalty_engine import run_penalty_check

    put_config(Config(penalty_rate=0.02, penalty_grace_period_hours=0))
    overdue_date = (date.today() - timedelta(days=2)).isoformat()
    not_due_date = (date.today() + timedelta(days=5)).isoformat()
    _put_active_loan(loan_id="loan-1", remaining_balance=10000.0, next_due_date=overdue_date)
    _put_active_loan(loan_id="loan-2", remaining_balance=5000.0, next_due_date=not_due_date)

    charged = run_penalty_check()

    assert charged == 1
    assert get_loan_by_id("loan-1").remaining_balance == 10200.0
    assert get_loan_by_id("loan-2").remaining_balance == 5000.0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_penalty_engine.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'app.penalty_engine'`

- [ ] **Step 3: Write `backend/app/penalty_engine.py`**

```python
from datetime import date, datetime, time, timedelta, timezone
from uuid import uuid4

from .db import get_config, list_loans, put_loan, put_transaction
from .models.loan import LoanStatus
from .models.transaction import Transaction, TransactionType


def run_penalty_check() -> int:
    config = get_config()
    if config.penalty_rate <= 0:
        return 0

    now = datetime.now(timezone.utc)
    charged_count = 0
    for loan in list_loans():
        if loan.status != LoanStatus.ACTIVE:
            continue
        if loan.penalty_charged_for_current_cycle:
            continue

        # NextDueDate is a date-only string, so it's anchored to midnight
        # (00:00 UTC) of that calendar day before the grace period is added.
        due_midnight = datetime.combine(date.fromisoformat(loan.next_due_date), time.min, tzinfo=timezone.utc)
        due_with_grace = due_midnight + timedelta(hours=config.penalty_grace_period_hours)
        if now <= due_with_grace:
            continue

        penalty = loan.remaining_balance * config.penalty_rate
        loan.remaining_balance += penalty
        loan.penalty_charged_for_current_cycle = True
        put_loan(loan)

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
            )
        )
        charged_count += 1

    return charged_count
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_penalty_engine.py -v
```
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/penalty_engine.py backend/tests/test_penalty_engine.py
git commit -m "feat: add penalty engine core logic"
```

---

### Task 7: `penaltyCheck` Lambda handler and EventBridge schedule

The handler has no Mangum/FastAPI involvement — it's a plain Lambda entry point invoked on a schedule, not via API Gateway. It shares the existing provider-level IAM role (already granted access to all four tables in Task 1), so no new per-function role is needed. `../backend/app/**` in `infra/serverless.yml`'s package patterns already includes this new file automatically.

**Files:**
- Create: `backend/app/penalty_handler.py`
- Create: `backend/tests/test_penalty_handler.py`
- Modify: `infra/serverless.yml`

- [ ] **Step 1: Write the failing test** — `backend/tests/test_penalty_handler.py`

```python
def test_penalty_handler_invokes_run_penalty_check(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table
):
    from app.db import put_config
    from app.models.config import Config
    from app.penalty_handler import handler

    put_config(Config(penalty_rate=0, penalty_grace_period_hours=0))

    response = handler({}, None)

    assert response == {"charged_count": 0}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_penalty_handler.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'app.penalty_handler'`

- [ ] **Step 3: Write `backend/app/penalty_handler.py`**

```python
from .penalty_engine import run_penalty_check


def handler(event, context):
    charged_count = run_penalty_check()
    return {"charged_count": charged_count}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_penalty_handler.py -v
```
Expected: PASS (1 passed)

- [ ] **Step 5: Add the Lambda function and schedule** — modify `infra/serverless.yml`'s `functions` block to read:

```yaml
functions:
  api:
    handler: backend.app.handler.handler
    events:
      - httpApi: '*'
  penaltyCheck:
    handler: backend.app.penalty_handler.handler
    events:
      - schedule: rate(6 hours)
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/penalty_handler.py backend/tests/test_penalty_handler.py infra/serverless.yml
git commit -m "feat: add penaltyCheck Lambda on a 6-hour EventBridge schedule"
```

---

### Task 8: Deploy updated backend to AWS

**Files:** none (deploy + verify only).

- [ ] **Step 1: Run the full backend suite one last time before deploying**

```bash
cd backend && source .venv/bin/activate && pytest -v && cd ..
```
Expected: all tests PASS (99 passed).

- [ ] **Step 2: Deploy**

```bash
cd infra && npx serverless deploy && cd ..
```
Expected: deploy succeeds; output ends with an `endpoints:` section.

- [ ] **Step 3: Verify the Transactions table is healthy**

```bash
aws dynamodb describe-table --table-name boombayan-api-dev-transactions --query 'Table.TableStatus'
```
Expected: `"ACTIVE"`.

- [ ] **Step 4: Verify the penaltyCheck Lambda deployed successfully**

```bash
aws lambda get-function --function-name boombayan-api-dev-penaltyCheck --query 'Configuration.State'
```
Expected: `"Active"`.

- [ ] **Step 5: Verify the deployed health endpoint still responds**

```bash
curl https://<id>.execute-api.us-east-1.amazonaws.com/health
```
Expected: `{"status":"ok"}`

No commit for this task — it's a deploy of work already committed in Tasks 1-7.

---

### Task 9: Shared API types and LoanDetailPage payment recording + transaction history

The "Release details" section's visibility condition is widened from `status === 'Active'` to also include `'Completed'`, so a paid-off loan still shows its release date, interest deduction, and final (zero) balance — without this, reaching `Completed` would silently hide that information.

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/pages/LoanDetailPage.tsx`
- Modify: `frontend/src/pages/LoanDetailPage.test.tsx`

- [ ] **Step 1: Extend `frontend/src/api/types.ts`** — replace the `Config`, `LoanStatus`, and `Loan` declarations, and append the transaction types. The file's full new contents:

```ts
export type MemberStatus = 'Active' | 'Inactive' | 'Withdrawn'

export interface ShareHistoryEntry {
  cycle_id: string | null
  shares_purchased: number
  share_value_at_purchase: number
  amount_paid: number
  date: string
}

export interface Member {
  member_id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  date_joined: string
  status: MemberStatus
  current_shares: number
  current_capital_amount: number
  share_history: ShareHistoryEntry[]
}

export interface Config {
  share_value: number
  max_shares_per_member: number
  default_interest_rate: number
  penalty_rate: number
  penalty_grace_period_hours: number
}

export type LoanStatus = 'Pending Board Approval' | 'Approved' | 'Active' | 'Rejected' | 'Completed'
export type ApprovalVoteStatus = 'Pending' | 'Approved' | 'Rejected'

export interface ApprovalEntry {
  email: string
  status: ApprovalVoteStatus
  date: string | null
  comments: string | null
}

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
  approvals: Record<string, ApprovalEntry>
}

export type TransactionType = 'PAYMENT' | 'PENALTY'

export interface Transaction {
  transaction_id: string
  loan_id: string
  timestamp: string
  type: TransactionType
  amount: number
  remaining_balance_after: number
  recorded_by: string | null
  notes: string | null
}
```

- [ ] **Step 2: Write the failing tests** — replace the full contents of `frontend/src/pages/LoanDetailPage.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { LoanDetailPage } from './LoanDetailPage'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

function renderAtLoan(loanId: string) {
  return render(
    <MemoryRouter initialEntries={[`/loans/${loanId}`]}>
      <Routes>
        <Route path="/loans/:loanId" element={<LoanDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const pendingLoan = {
  loan_id: 'loan-1',
  member_id: 'mem-1',
  requested_amount: 10000,
  approved_amount: null,
  repayment_interval_days: 30,
  interest_rate: 0.05,
  application_date: '2026-06-21',
  remarks: null,
  status: 'Pending Board Approval',
  is_exception_case: false,
  release_date: null,
  interest_deduction: null,
  net_release_amount: null,
  remaining_balance: null,
  next_due_date: null,
  penalty_charged_for_current_cycle: false,
  approvals: {
    'board-1': { email: 'board@boombayan.org', status: 'Pending', date: null, comments: null },
  },
}

const activeLoan = {
  ...pendingLoan,
  status: 'Active',
  approved_amount: 10000,
  release_date: '2026-06-21',
  interest_deduction: 500,
  net_release_amount: 9500,
  remaining_balance: 10000,
  next_due_date: '2026-07-21',
}

const boardUser = { user_id: 'board-1', email: 'board@boombayan.org', is_administrator: false, member_id: null }
const adminUser = { user_id: 'admin-1', email: 'admin@boombayan.org', is_administrator: true, member_id: null }

function mockLoanFetches(loan: typeof pendingLoan, user: typeof boardUser, transactions: unknown[] = []) {
  vi.mocked(apiFetch).mockImplementation((path) => {
    if (path === '/me') return Promise.resolve(user)
    if (path.endsWith('/transactions')) return Promise.resolve(transactions)
    return Promise.resolve(loan)
  })
}

describe('LoanDetailPage', () => {
  it('shows loan details and approvals after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockLoanFetches(pendingLoan, boardUser)

    renderAtLoan('loan-1')

    await waitFor(() => expect(screen.getByText('Status: Pending Board Approval')).toBeInTheDocument())
    expect(screen.getByText('board@boombayan.org')).toBeInTheDocument()
  })

  it('shows an error message when the loan fetch fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    renderAtLoan('loan-1')

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this loan.')
  })

  it('submits an approve vote and updates the displayed approvals', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockLoanFetches(pendingLoan, boardUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Pending Board Approval')).toBeInTheDocument())

    const approvedLoan = {
      ...pendingLoan,
      status: 'Approved',
      approved_amount: 10000,
      approvals: {
        'board-1': { email: 'board@boombayan.org', status: 'Approved', date: '2026-06-21', comments: null },
      },
    }
    vi.mocked(apiFetch).mockResolvedValueOnce(approvedLoan)

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/loans/loan-1/approvals', 'fake-id-token', {
        method: 'POST',
        body: { status: 'Approved', comments: null },
      }),
    )
    await waitFor(() => expect(screen.getByText('Status: Approved')).toBeInTheDocument())
  })

  it('submits a reject vote and updates the displayed status', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockLoanFetches(pendingLoan, boardUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Pending Board Approval')).toBeInTheDocument())

    const rejectedLoan = {
      ...pendingLoan,
      status: 'Rejected',
      approvals: {
        'board-1': { email: 'board@boombayan.org', status: 'Rejected', date: '2026-06-21', comments: 'Not enough capital' },
      },
    }
    vi.mocked(apiFetch).mockResolvedValueOnce(rejectedLoan)

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    await waitFor(() => expect(screen.getByText('Status: Rejected')).toBeInTheDocument())
  })

  it('hides the vote form when the current user has already voted', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    const alreadyVotedLoan = {
      ...pendingLoan,
      approvals: {
        'board-1': { email: 'board@boombayan.org', status: 'Approved', date: '2026-06-21', comments: null },
      },
    }
    mockLoanFetches(alreadyVotedLoan, boardUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Pending Board Approval')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('shows a release form for administrators when the loan is approved, and submits it', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    const approvedLoan = { ...pendingLoan, status: 'Approved', approved_amount: 10000 }
    mockLoanFetches(approvedLoan, adminUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Approved')).toBeInTheDocument())

    vi.mocked(apiFetch).mockResolvedValueOnce(activeLoan)

    fireEvent.click(screen.getByRole('button', { name: 'Release loan' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/loans/loan-1/release', 'fake-id-token', {
        method: 'POST',
        body: { release_date: null },
      }),
    )
    await waitFor(() => expect(screen.getByText('Status: Active')).toBeInTheDocument())
  })

  it('hides the release form for non-administrators', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    const approvedLoan = { ...pendingLoan, status: 'Approved', approved_amount: 10000 }
    mockLoanFetches(approvedLoan, boardUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Approved')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Release loan' })).not.toBeInTheDocument()
  })

  it('shows a record payment form for administrators on an active loan, submits it, and refreshes the transaction history', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockLoanFetches(activeLoan, adminUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Active')).toBeInTheDocument())

    const paidDownLoan = { ...activeLoan, remaining_balance: 7000 }
    vi.mocked(apiFetch).mockResolvedValueOnce(paidDownLoan)
    const newTransactions = [
      {
        transaction_id: 'txn-1',
        loan_id: 'loan-1',
        timestamp: '2026-07-21T10:00:00+00:00',
        type: 'PAYMENT',
        amount: 3000,
        remaining_balance_after: 7000,
        recorded_by: 'admin-1',
        notes: null,
      },
    ]
    vi.mocked(apiFetch).mockResolvedValueOnce(newTransactions)

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '3000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/loans/loan-1/payments', 'fake-id-token', {
        method: 'POST',
        body: { amount: 3000, payment_date: null, notes: null },
      }),
    )
    await waitFor(() => expect(screen.getByText('Remaining balance: 7000')).toBeInTheDocument())
    expect(await screen.findByText('PAYMENT')).toBeInTheDocument()
  })

  it('shows an error message when recording a payment fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockLoanFetches(activeLoan, adminUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Active')).toBeInTheDocument())

    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Payment amount exceeds the remaining balance'))

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '99999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Payment amount exceeds the remaining balance')
  })

  it('hides the record payment form for non-administrators', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockLoanFetches(activeLoan, boardUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Active')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument()
  })

  it('hides the record payment form when the loan is not active', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    mockLoanFetches(pendingLoan, adminUser)

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Pending Board Approval')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument()
  })

  it('shows existing transaction history rows', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    const existingTransactions = [
      {
        transaction_id: 'txn-1',
        loan_id: 'loan-1',
        timestamp: '2026-07-21T10:00:00+00:00',
        type: 'PAYMENT',
        amount: 3000,
        remaining_balance_after: 7000,
        recorded_by: 'admin-1',
        notes: 'First installment',
      },
    ]
    mockLoanFetches(activeLoan, boardUser, existingTransactions)

    renderAtLoan('loan-1')

    await waitFor(() => expect(screen.getByText('First installment')).toBeInTheDocument())
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/LoanDetailPage.test.tsx
```
Expected: FAIL — `penalty_charged_for_current_cycle` type error / missing "Amount" label / missing "Record payment" button.

- [ ] **Step 4: Write `frontend/src/pages/LoanDetailPage.tsx`** — replace the full file contents:

```tsx
import { FormEvent, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { ApprovalVoteStatus, Loan, Transaction } from '../api/types'
import { useAuth } from '../auth/AuthContext'

interface CurrentUser {
  user_id: string
  email: string
  is_administrator: boolean
  member_id: string | null
}

export function LoanDetailPage() {
  const { loanId } = useParams<{ loanId: string }>()
  const { idToken } = useAuth()
  const [loan, setLoan] = useState<Loan | null>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [error, setError] = useState<string | null>(null)
  const [comments, setComments] = useState('')
  const [voteError, setVoteError] = useState<string | null>(null)
  const [releaseDate, setReleaseDate] = useState('')
  const [releaseError, setReleaseError] = useState<string | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [paymentError, setPaymentError] = useState<string | null>(null)

  useEffect(() => {
    if (!idToken || !loanId) return
    let cancelled = false
    Promise.all([
      apiFetch<Loan>(`/loans/${loanId}`, idToken),
      apiFetch<CurrentUser>('/me', idToken),
      apiFetch<Transaction[]>(`/loans/${loanId}/transactions`, idToken),
    ])
      .then(([loanData, userData, transactionsData]) => {
        if (!cancelled) {
          setLoan(loanData)
          setCurrentUser(userData)
          setTransactions(transactionsData)
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this loan.')
      })
    return () => {
      cancelled = true
    }
  }, [idToken, loanId])

  async function handleVote(status: ApprovalVoteStatus) {
    if (!idToken || !loanId) return
    setVoteError(null)
    try {
      const updated = await apiFetch<Loan>(`/loans/${loanId}/approvals`, idToken, {
        method: 'POST',
        body: { status, comments: comments || null },
      })
      setLoan(updated)
      setComments('')
    } catch (err) {
      setVoteError(err instanceof Error ? err.message : 'Could not record your vote.')
    }
  }

  async function handleRelease(event: FormEvent) {
    event.preventDefault()
    if (!idToken || !loanId) return
    setReleaseError(null)
    try {
      const updated = await apiFetch<Loan>(`/loans/${loanId}/release`, idToken, {
        method: 'POST',
        body: { release_date: releaseDate || null },
      })
      setLoan(updated)
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : 'Could not release this loan.')
    }
  }

  async function handleRecordPayment(event: FormEvent) {
    event.preventDefault()
    if (!idToken || !loanId) return
    setPaymentError(null)
    try {
      const updated = await apiFetch<Loan>(`/loans/${loanId}/payments`, idToken, {
        method: 'POST',
        body: { amount: Number(paymentAmount), payment_date: paymentDate || null, notes: paymentNotes || null },
      })
      setLoan(updated)
      setPaymentAmount('')
      setPaymentDate('')
      setPaymentNotes('')
      const updatedTransactions = await apiFetch<Transaction[]>(`/loans/${loanId}/transactions`, idToken)
      setTransactions(updatedTransactions)
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Could not record this payment.')
    }
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!loan || !currentUser) {
    return <p>Loading...</p>
  }

  const myApproval = loan.approvals[currentUser.user_id]
  const canVote = loan.status === 'Pending Board Approval' && myApproval?.status === 'Pending'
  const canRelease = currentUser.is_administrator && loan.status === 'Approved'
  const canRecordPayment = currentUser.is_administrator && loan.status === 'Active'

  return (
    <div>
      <h1>Loan {loan.loan_id}</h1>
      <p>Status: {loan.status}</p>
      <p>Requested amount: {loan.requested_amount}</p>
      <p>Approved amount: {loan.approved_amount ?? 'Not yet approved'}</p>
      <p>Repayment interval (days): {loan.repayment_interval_days}</p>
      <p>Interest rate: {loan.interest_rate}</p>
      <p>Application date: {loan.application_date}</p>
      {loan.is_exception_case && <p>Exception case: requested amount exceeds the member&apos;s capital.</p>}
      {loan.remarks && <p>Remarks: {loan.remarks}</p>}
      {(loan.status === 'Active' || loan.status === 'Completed') && (
        <div>
          <h2>Release details</h2>
          <p>Release date: {loan.release_date}</p>
          <p>Interest deduction: {loan.interest_deduction}</p>
          <p>Net release amount: {loan.net_release_amount}</p>
          <p>Remaining balance: {loan.remaining_balance}</p>
          <p>Next due date: {loan.next_due_date}</p>
        </div>
      )}

      <h2>Approvals</h2>
      <table>
        <thead>
          <tr>
            <th>Board member</th>
            <th>Status</th>
            <th>Date</th>
            <th>Comments</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(loan.approvals).map(([userId, entry]) => (
            <tr key={userId}>
              <td>{entry.email}</td>
              <td>{entry.status}</td>
              <td>{entry.date ?? '-'}</td>
              <td>{entry.comments ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {canVote && (
        <div>
          <h2>Cast your vote</h2>
          <label htmlFor="comments">Comments</label>
          <input id="comments" value={comments} onChange={(e) => setComments(e.target.value)} />
          {voteError && <p role="alert">{voteError}</p>}
          <button type="button" onClick={() => handleVote('Approved')}>Approve</button>
          <button type="button" onClick={() => handleVote('Rejected')}>Reject</button>
        </div>
      )}

      {canRelease && (
        <form onSubmit={handleRelease}>
          <h2>Release this loan</h2>
          <label htmlFor="release-date">Release date</label>
          <input
            id="release-date"
            type="date"
            value={releaseDate}
            onChange={(e) => setReleaseDate(e.target.value)}
          />
          {releaseError && <p role="alert">{releaseError}</p>}
          <button type="submit">Release loan</button>
        </form>
      )}

      {canRecordPayment && (
        <form onSubmit={handleRecordPayment}>
          <h2>Record a payment</h2>
          <label htmlFor="payment-amount">Amount</label>
          <input
            id="payment-amount"
            type="number"
            value={paymentAmount}
            onChange={(e) => setPaymentAmount(e.target.value)}
            required
          />
          <label htmlFor="payment-date">Payment date</label>
          <input
            id="payment-date"
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
          />
          <label htmlFor="payment-notes">Notes</label>
          <input id="payment-notes" value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} />
          {paymentError && <p role="alert">{paymentError}</p>}
          <button type="submit">Record payment</button>
        </form>
      )}

      <h2>Transaction history</h2>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Amount</th>
            <th>Balance after</th>
            <th>Date</th>
            <th>Recorded by</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => (
            <tr key={transaction.transaction_id}>
              <td>{transaction.type}</td>
              <td>{transaction.amount}</td>
              <td>{transaction.remaining_balance_after}</td>
              <td>{transaction.timestamp}</td>
              <td>{transaction.recorded_by ?? '-'}</td>
              <td>{transaction.notes ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/pages/LoanDetailPage.test.tsx
```
Expected: PASS (12 passed)

- [ ] **Step 6: Commit**

```bash
cd ..
git add frontend/src/api/types.ts frontend/src/pages/LoanDetailPage.tsx frontend/src/pages/LoanDetailPage.test.tsx
git commit -m "feat: add payment recording and transaction history to Loan detail page"
```

---

### Task 10: Settings page — add penalty rate and grace period fields

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/pages/SettingsPage.test.tsx`

- [ ] **Step 1: Write the failing tests** — replace the full contents of `frontend/src/pages/SettingsPage.test.tsx`:

```tsx
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

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/SettingsPage.test.tsx
```
Expected: FAIL — `Unable to find a label with the text of: Penalty rate`

- [ ] **Step 3: Update `frontend/src/pages/SettingsPage.tsx`** — replace the full contents:

```tsx
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
        {saveError && <p role="alert">{saveError}</p>}
        {saved && <p>Settings saved.</p>}
        <button type="submit">Save</button>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/pages/SettingsPage.test.tsx
```
Expected: PASS (3 passed)

- [ ] **Step 5: Run the full frontend suite**

```bash
npx vitest run
```
Expected: all tests PASS (54 passed).

- [ ] **Step 6: Commit**

```bash
cd ..
git add frontend/src/pages/SettingsPage.tsx frontend/src/pages/SettingsPage.test.tsx
git commit -m "feat: add penalty rate and grace period fields to Settings page"
```

---

### Task 11: End-to-end manual verification

Real proof against the live deployed stack, no mocks — same philosophy as Plans 1-3's final verification tasks. Uses the existing administrator account (`michaelseno@gmail.com`). The automated penalty engine itself can't be observed live here — there's no manual-trigger endpoint by design (§5 of the design doc), and waiting a real 6 hours for the EventBridge schedule to fire isn't practical for a verification pass. That behavior is fully covered by Task 6's unit tests instead (`run_penalty_check` exercised directly with controlled dates).

**Execution note:** run via a scripted headless-Chromium (Playwright) session against `npm run dev`, same pattern as Plans 1-3.

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
Expected: redirected to `/dashboard`.

- [ ] **Step 4: Configure the penalty rate and grace period**

Click "Settings". Set "Share value" to `500`, "Max shares per member" to `5`, "Default interest rate" to `0.05`, "Penalty rate" to `0.02`, "Penalty grace period (hours)" to `24`, click "Save".
Expected: "Settings saved." appears. Reload the page — all five fields still show `500`, `5`, `0.05`, `0.02`, `24`.

- [ ] **Step 5: Add a fresh member with no capital**

Click "Members", then "Add member". Fill in a first name, last name, email, and phone, click "Create member".
Expected: redirected to `/members/<new-id>`, showing "Current capital: 0".

- [ ] **Step 6: Create, approve, and release a loan**

Click "Loans", then "New loan application". Select the member just created, enter `10000` for "Requested amount" and `30` for "Repayment interval (days)", click "Submit application". On the loan detail page, click "Approve", then leave "Release date" blank and click "Release loan".
Expected: "Status:" ends at `Active`, "Remaining balance: 10000", and a "Record a payment" form is now visible (this account is an administrator and the loan is `Active`). The "Transaction history" table is present but empty.

- [ ] **Step 7: Record a partial payment**

In "Record a payment", enter `4000` for "Amount", leave "Payment date" and "Notes" blank, click "Record payment".
Expected: "Remaining balance: 4000" updates; "Next due date" advances by 30 days from today; the "Transaction history" table now shows one `PAYMENT` row for `4000` with balance-after `4000`.

- [ ] **Step 8: Record the final payment to complete the loan**

In "Record a payment", enter `4000` again, click "Record payment".
Expected: "Status:" updates to `Completed`; "Remaining balance: 0"; the "Record a payment" form disappears (loan is no longer `Active`); the "Transaction history" table now shows two `PAYMENT` rows.

- [ ] **Step 9: Verify the Loans list reflects the update**

Navigate back to "Loans".
Expected: the loan's row shows status `Completed`.

- [ ] **Step 10: Stop the dev server**

```bash
# Ctrl+C in the terminal running npm run dev
cd ..
```

No commit for this task — it's verification of work already committed in Tasks 1-10.

---

### Task 12: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the "What's not here yet" section** — in `README.md`, replace:

```markdown
## What's not here yet

This is Plan 3 of a multi-plan project — auth, dashboard shell, member/share
management, and the loan lifecycle (application through release). Payment
recording, the penalty engine, and cycle/dividend processing are designed
but not yet built; see `docs/superpowers/plans/` for the phase breakdown.
```

with:

```markdown
## Recording payments and the penalty engine

Once a loan is `Active`, an administrator can record payments against it
from the loan's detail page (`/loans/:loanId`), paying down its remaining
balance. Each payment also advances the loan's next due date and re-arms
the penalty engine for that loan. A payment that exactly clears the
remaining balance moves the loan to `Completed`. Any authenticated User can
view the loan's full payment/penalty history on the same page. Separately,
a scheduled job runs every 6 hours and charges a one-time penalty (added to
the balance owed) on any active loan that's missed its due date past the
configured grace period — both the penalty rate and grace period are set
from Settings, and the engine stays inactive until an administrator
configures a non-zero penalty rate.

## What's not here yet

This is Plan 4 of a multi-plan project — auth, dashboard shell, member/share
management, the loan lifecycle, and payments/penalties. Cycle/dividend
processing and a UI/visual polish pass are designed but not yet built; see
`docs/superpowers/plans/` for the phase breakdown.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document payment recording and the penalty engine"
```

---

## Plan Self-Review Notes

- **Spec coverage:** This plan implements every section of `docs/superpowers/specs/2026-06-21-payments-penalties-design.md`: §2's `Transactions` table (no GSI) and `Loan.PenaltyChargedForCurrentCycle`/`Completed` status, and `Config.penalty_rate`/`penalty_grace_period_hours`; §3's full payment-recording mechanics including overpayment rejection, due-date advancement, and the penalty-flag reset; §4's penalty engine logic including the `penalty_rate > 0` guard and the midnight-anchored grace period; §5's two endpoints; §6's frontend additions. All nine of §8's assumptions are reflected in the code exactly as stated.
- **Deliberately out of scope, carried to later plans:** no Cycle entity, no `Top3BonusPercentage`/`Top3RankingWeights`, no dividend distribution (Plan 5); no UI/visual polish pass (Plan 6); no cross-loan Transactions GSI or reporting module (deferred until a Reporting plan needs it).
- **Type consistency check:** `Transaction`/`TransactionType` (Task 3) match `frontend/src/api/types.ts`'s `Transaction`/`TransactionType` (Task 9) key-for-key, including the `"PAYMENT"`/`"PENALTY"` string literal values matching the Python enum values exactly. `CreatePaymentRequest` (backend, Task 3) matches the POST body sent by `LoanDetailPage`'s payment form (Task 9) field-for-field. `db.py` function names introduced in Task 3 (`get_transactions_table`, `put_transaction`, `list_transactions_for_loan`) are the exact names imported by Tasks 4-6's router and engine code.
- **`penalty_rate > 0` guard, not a literal reading of the design doc:** with both new Config fields defaulting to `0`, charging (and recording) `$0` penalties against every overdue loan the instant this ships — before any administrator has opened Settings — would be a real, surprising side effect. `run_penalty_check()` returns `0` immediately whenever `penalty_rate <= 0`, so the engine stays inert until explicitly configured. This is the one place this plan adds a rule beyond the original design doc's literal text (documented in the design doc's own assumptions list, §8.1).
- **Overpayment rejected outright, never clamped or negative:** `record_payment` raises 400 the moment `amount > remaining_balance`, so `RemainingBalance` can only ever reach exactly `0` (triggering `Completed`) or stay positive — it can never go negative. This was a deliberate brainstorming decision, not the only option (clamping or allowing a negative "credit" balance were both considered and rejected).
- **`RecordedBy` is `null` for system-generated `PENALTY` transactions:** only `PAYMENT` transactions carry the recording admin's `UserId` — nothing "recorded" a penalty, the scheduled job did. The frontend renders `recorded_by ?? '-'` for both transaction types, so this requires no special-casing in `LoanDetailPage`.
- **`penalty_charged_for_current_cycle` resets on every payment, not just a full payoff:** a partial payment still re-arms the penalty for the loan's next missed due date, matching the design doc's stated intent that a penalty applies once per missed due date — the flag tracks "has this specific due date already been penalized," not "has this loan ever been penalized."
- **`NextDueDate`'s midnight anchor:** since the field is a date-only string with no time component, `run_penalty_check()` explicitly anchors it to `00:00 UTC` before adding the grace period (`datetime.combine(..., time.min, tzinfo=timezone.utc)`), rather than leaving the anchor time ambiguous. This matches the design doc's explicit assumption §8.9.
- **No GSI on Transactions, matching Plans 2-3's precedent:** `list_transactions_for_loan` is a `Query` scoped to a single `LoanId` partition — there's no cross-loan listing endpoint in this plan, so no GSI is provisioned. Revisit only when a future Reporting plan actually needs "all payments this month" across loans.
- **End-to-end live verification doesn't cover the penalty engine:** by design (§5 — no manual-trigger endpoint exists), Task 11 can't observe a real penalty firing live in the browser. That behavior is fully covered by Task 6's seven unit tests against `run_penalty_check()` directly, using dates computed relative to `date.today()` so they remain deterministic regardless of which day the suite runs.
