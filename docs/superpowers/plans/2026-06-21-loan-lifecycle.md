# Plan 3: Loan Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take a loan from application through unanimous board approval to release (design doc §4 Loans, §5 Loan Lifecycle), on top of Plan 1's auth/infra and Plan 2's Member/Config foundation, producing an `Active` loan with a real computed balance — no payments, penalties, or cycle/dividend processing yet (Plans 4-5).

**Architecture:** Same FastAPI/Lambda/DynamoDB/React stack as Plans 1-2. A new DynamoDB-backed `Loans` table (no GSIs — scan + filter in Python, matching Plan 2's Members precedent) behind a new FastAPI router, reusing Plan 2's `get_current_user`/`require_admin` dependencies. `Config` gains a `default_interest_rate` field. Frontend adds a Loans list page, a New Loan Application page, and a Loan detail page (approvals table, vote form, release form), wired into the existing `ProtectedRoute`/`AuthContext` shell.

**Tech Stack:** Same as Plans 1-2 — no new dependencies required.

---

### Task 1: Loans DynamoDB table

**Files:**
- Modify: `infra/serverless.yml`

- [ ] **Step 1: Add `LOANS_TABLE` env var** — modify the `provider.environment` block to read:

```yaml
  environment:
    USERS_TABLE: ${self:service}-${sls:stage}-users
    CONFIG_TABLE: ${self:service}-${sls:stage}-config
    MEMBERS_TABLE: ${self:service}-${sls:stage}-members
    LOANS_TABLE: ${self:service}-${sls:stage}-loans
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
```

- [ ] **Step 3: Add the `LoansTable` resource** — under `resources.Resources`, insert this block immediately after `MembersTable` (before `CognitoUserPool`):

```yaml
    LoansTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:provider.environment.LOANS_TABLE}
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: LoanId
            AttributeType: S
        KeySchema:
          - AttributeName: LoanId
            KeyType: HASH
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
aws dynamodb describe-table --table-name boombayan-api-dev-loans --query 'Table.TableStatus'
```
Expected: prints `"ACTIVE"`.

- [ ] **Step 6: Commit**

```bash
git add infra/serverless.yml
git commit -m "feat: provision Loans DynamoDB table"
```

---

### Task 2: Extend Config with `default_interest_rate`

Plan 2 deliberately scoped `Config` down to only the two fields it needed, noting the rest of design doc §4's `Config` attributes "belong to Plans 3-5's features." This task adds the one this plan needs — every new loan snapshots `default_interest_rate` into its own `InterestRate` at application time (design doc §5), so later rate changes never affect already-created loans.

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

    config = Config(share_value=500, max_shares_per_member=5, default_interest_rate=0.05)
    put_config(config)

    assert get_config() == config
```

In `backend/tests/test_config.py`, replace the full file contents with:

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
    assert response.json() == {"share_value": 0, "max_shares_per_member": 5, "default_interest_rate": 0}


def test_update_config_succeeds_for_administrator(client, dynamodb_users_table, dynamodb_config_table):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.put(
        "/config",
        json={"share_value": 500, "max_shares_per_member": 5, "default_interest_rate": 0.05},
    )

    assert response.status_code == 200
    assert response.json() == {"share_value": 500, "max_shares_per_member": 5, "default_interest_rate": 0.05}


def test_update_config_partial_update_preserves_other_fields(
    client, dynamodb_users_table, dynamodb_config_table
):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    client.put(
        "/config",
        json={"share_value": 500, "max_shares_per_member": 10, "default_interest_rate": 0.05},
    )
    response = client.put("/config", json={"share_value": 600})

    assert response.status_code == 200
    assert response.json() == {"share_value": 600, "max_shares_per_member": 10, "default_interest_rate": 0.05}


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
Expected: FAIL — `test_put_and_get_config_roundtrip` and the config endpoint tests assert a `default_interest_rate` key that doesn't exist yet.

- [ ] **Step 3: Write `backend/app/models/config.py`**

```python
from pydantic import BaseModel


class Config(BaseModel):
    share_value: float = 0
    max_shares_per_member: int = 5
    default_interest_rate: float = 0


class UpdateConfigRequest(BaseModel):
    share_value: float | None = None
    max_shares_per_member: int | None = None
    default_interest_rate: float | None = None
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
    )


def put_config(config: Config) -> None:
    get_config_table().put_item(
        Item={
            "ConfigKey": CONFIG_KEY,
            "ShareValue": Decimal(str(config.share_value)),
            "MaxSharesPerMember": config.max_shares_per_member,
            "DefaultInterestRate": Decimal(str(config.default_interest_rate)),
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
    put_config(config)
    return config
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pytest tests/test_db.py tests/test_config.py -v
```
Expected: PASS (13 passed)

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/config.py backend/app/db.py backend/app/routers/config.py backend/tests/test_db.py backend/tests/test_config.py
git commit -m "feat: add default_interest_rate to Config"
```

---

### Task 3: Loan model, `list_users()`, and Loan DynamoDB repository functions

**Files:**
- Create: `backend/app/models/loan.py`
- Modify: `backend/app/config.py`
- Modify: `backend/app/db.py`
- Modify: `backend/tests/conftest.py`
- Modify: `backend/tests/test_db.py`

- [ ] **Step 1: Write `backend/app/models/loan.py`**

```python
from enum import Enum

from pydantic import BaseModel, Field, field_validator


class LoanStatus(str, Enum):
    PENDING_BOARD_APPROVAL = "Pending Board Approval"
    APPROVED = "Approved"
    ACTIVE = "Active"
    REJECTED = "Rejected"


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
```

- [ ] **Step 2: Add `loans_table` setting** — modify `backend/app/config.py` to read:

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    users_table: str = "boombayan-api-dev-users"
    config_table: str = "boombayan-api-dev-config"
    members_table: str = "boombayan-api-dev-members"
    loans_table: str = "boombayan-api-dev-loans"
    cognito_user_pool_id: str = ""
    cognito_client_id: str = ""
    aws_region: str = "us-east-1"
    cors_allowed_origins: str = "http://localhost:5173"


settings = Settings()
```

- [ ] **Step 3: Add the `dynamodb_loans_table` fixture** — modify `backend/tests/conftest.py` to add this fixture after `dynamodb_config_table`:

```python
@pytest.fixture
def dynamodb_loans_table(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "loans_table", "test-loans")

    with mock_aws():
        dynamo_client = boto3.client("dynamodb", region_name="us-east-1")
        dynamo_client.create_table(
            TableName="test-loans",
            AttributeDefinitions=[{"AttributeName": "LoanId", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "LoanId", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield
```

- [ ] **Step 4: Write the failing tests** — append to `backend/tests/test_db.py`:

```python
def test_list_users_returns_all_users(dynamodb_users_table):
    from app.db import list_users, put_user
    from app.models.user import User

    put_user(User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True))
    put_user(User(user_id="board-1", email="board@boombayan.org", is_administrator=False))

    users = list_users()
    assert {u.user_id for u in users} == {"admin-1", "board-1"}


def test_put_and_get_loan_roundtrip(dynamodb_loans_table):
    from app.db import get_loan_by_id, put_loan
    from app.models.loan import ApprovalEntry, Loan

    loan = Loan(
        loan_id="loan-1",
        member_id="mem-1",
        requested_amount=10000,
        repayment_interval_days=30,
        interest_rate=0.05,
        application_date="2026-06-21",
        approvals={"admin-1": ApprovalEntry(email="admin@boombayan.org")},
    )
    put_loan(loan)

    fetched = get_loan_by_id("loan-1")
    assert fetched == loan


def test_get_loan_by_id_returns_none_when_missing(dynamodb_loans_table):
    from app.db import get_loan_by_id

    assert get_loan_by_id("does-not-exist") is None


def test_list_loans_returns_all_loans(dynamodb_loans_table):
    from app.db import list_loans, put_loan
    from app.models.loan import Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
        )
    )
    put_loan(
        Loan(
            loan_id="loan-2", member_id="mem-2", requested_amount=5000,
            repayment_interval_days=15, interest_rate=0.05, application_date="2026-06-22",
        )
    )

    loans = list_loans()
    assert {loan.loan_id for loan in loans} == {"loan-1", "loan-2"}


def test_put_loan_persists_release_fields(dynamodb_loans_table):
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
        status=LoanStatus.ACTIVE,
        release_date="2026-06-22",
        interest_deduction=500,
        net_release_amount=9500,
        remaining_balance=10000,
        next_due_date="2026-07-22",
    )
    put_loan(loan)

    fetched = get_loan_by_id("loan-1")
    assert fetched == loan
```

- [ ] **Step 5: Run tests to verify they fail**

```bash
pytest tests/test_db.py -v
```
Expected: FAIL — `ImportError: cannot import name 'list_users' from 'app.db'`

- [ ] **Step 6: Write the repository functions** — add `from .models.loan import ApprovalEntry, ApprovalVoteStatus, Loan, LoanStatus` to the import block at the top of `backend/app/db.py`, add `list_users()` immediately after `put_user()`, and append the Loan functions at the end of the file:

```python
def list_users() -> list[User]:
    response = get_users_table().scan()
    return [
        User(
            user_id=item["UserId"],
            email=item["Email"],
            is_administrator=item.get("IsAdministrator", False),
            member_id=item.get("MemberId"),
        )
        for item in response["Items"]
    ]
```

```python
def get_loans_table():
    return _dynamodb().Table(settings.loans_table)


def _approvals_from_item(item: dict) -> dict[str, ApprovalEntry]:
    return {
        user_id: ApprovalEntry(
            email=entry["Email"],
            status=ApprovalVoteStatus(entry["Status"]),
            date=entry.get("Date"),
            comments=entry.get("Comments"),
        )
        for user_id, entry in item.get("Approvals", {}).items()
    }


def _item_from_approvals(approvals: dict[str, ApprovalEntry]) -> dict:
    item = {}
    for user_id, entry in approvals.items():
        entry_item = {"Email": entry.email, "Status": entry.status.value}
        if entry.date is not None:
            entry_item["Date"] = entry.date
        if entry.comments is not None:
            entry_item["Comments"] = entry.comments
        item[user_id] = entry_item
    return item


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
        approvals=_approvals_from_item(item),
    )


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
        "Approvals": _item_from_approvals(loan.approvals),
    }
    if loan.approved_amount is not None:
        item["ApprovedAmount"] = Decimal(str(loan.approved_amount))
    if loan.remarks is not None:
        item["Remarks"] = loan.remarks
    if loan.release_date is not None:
        item["ReleaseDate"] = loan.release_date
    if loan.interest_deduction is not None:
        item["InterestDeduction"] = Decimal(str(loan.interest_deduction))
    if loan.net_release_amount is not None:
        item["NetReleaseAmount"] = Decimal(str(loan.net_release_amount))
    if loan.remaining_balance is not None:
        item["RemainingBalance"] = Decimal(str(loan.remaining_balance))
    if loan.next_due_date is not None:
        item["NextDueDate"] = loan.next_due_date
    return item


def get_loan_by_id(loan_id: str) -> Loan | None:
    response = get_loans_table().get_item(Key={"LoanId": loan_id})
    item = response.get("Item")
    if item is None:
        return None
    return _loan_from_item(item)


def put_loan(loan: Loan) -> None:
    get_loans_table().put_item(Item=_item_from_loan(loan))


def list_loans() -> list[Loan]:
    response = get_loans_table().scan()
    return [_loan_from_item(item) for item in response["Items"]]
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
pytest tests/test_db.py -v
```
Expected: PASS (14 passed)

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/loan.py backend/app/config.py backend/app/db.py backend/tests/conftest.py backend/tests/test_db.py
git commit -m "feat: add Loan model and DynamoDB repository functions"
```

---

### Task 4: `POST /loans` — create loan application endpoint

Per the design's confirmed scope: only administrators create applications (mirroring all other data entry — members, shares, config). Creation goes straight to `Pending Board Approval` — there's no separate Draft stage. The `Approvals` map is snapshotted from every current User at creation time, each starting `Pending`.

**Files:**
- Create: `backend/app/routers/loans.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_loans.py`

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_loans.py`

```python
from app.auth import get_current_user_id
from app.db import put_config, put_member, put_user
from app.models.config import Config
from app.models.member import Member, MemberStatus
from app.models.user import User
from app.main import app


def _put_active_member(member_id="mem-1", current_capital_amount=0.0):
    put_member(
        Member(
            member_id=member_id, first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
            current_capital_amount=current_capital_amount,
        )
    )


def test_create_loan_succeeds_for_administrator(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    _put_active_member(current_capital_amount=20000)
    put_config(Config(default_interest_rate=0.05))
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/loans",
        json={"member_id": "mem-1", "requested_amount": 10000, "repayment_interval_days": 30},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["member_id"] == "mem-1"
    assert body["requested_amount"] == 10000
    assert body["approved_amount"] is None
    assert body["interest_rate"] == 0.05
    assert body["status"] == "Pending Board Approval"
    assert body["is_exception_case"] is False
    assert body["loan_id"]


def test_create_loan_snapshots_approvals_for_all_current_users(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    _put_active_member(current_capital_amount=20000)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(admin)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/loans",
        json={"member_id": "mem-1", "requested_amount": 10000, "repayment_interval_days": 30},
    )

    approvals = response.json()["approvals"]
    assert set(approvals.keys()) == {"admin-1", "board-1"}
    assert approvals["admin-1"] == {"email": "admin@boombayan.org", "status": "Pending", "date": None, "comments": None}


def test_create_loan_flags_exception_case_when_requested_amount_exceeds_capital(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    _put_active_member(current_capital_amount=5000)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/loans",
        json={"member_id": "mem-1", "requested_amount": 10000, "repayment_interval_days": 30},
    )

    assert response.json()["is_exception_case"] is True


def test_create_loan_rejected_for_non_administrator(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    _put_active_member(current_capital_amount=20000)
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post(
        "/loans",
        json={"member_id": "mem-1", "requested_amount": 10000, "repayment_interval_days": 30},
    )

    assert response.status_code == 403


def test_create_loan_rejects_when_member_not_found(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/loans",
        json={"member_id": "does-not-exist", "requested_amount": 10000, "repayment_interval_days": 30},
    )

    assert response.status_code == 404


def test_create_loan_rejects_when_member_not_active(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
            status=MemberStatus.WITHDRAWN, current_capital_amount=20000,
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/loans",
        json={"member_id": "mem-1", "requested_amount": 10000, "repayment_interval_days": 30},
    )

    assert response.status_code == 400


def test_create_loan_rejects_non_positive_requested_amount(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    _put_active_member(current_capital_amount=20000)
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/loans",
        json={"member_id": "mem-1", "requested_amount": 0, "repayment_interval_days": 30},
    )

    assert response.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_loans.py -v
```
Expected: FAIL — `ModuleNotFoundError: No module named 'app.routers.loans'`

- [ ] **Step 3: Write `backend/app/routers/loans.py`**

```python
from datetime import date
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, require_admin
from ..db import get_config, get_member_by_id, list_users, put_loan
from ..models.loan import ApprovalEntry, ApprovalVoteStatus, CreateLoanRequest, Loan, LoanStatus
from ..models.member import MemberStatus
from ..models.user import User

router = APIRouter()


@router.post("/loans", response_model=Loan, status_code=201)
def create_loan(body: CreateLoanRequest, user: User = Depends(require_admin)) -> Loan:
    member = get_member_by_id(body.member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.status != MemberStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Only active members are eligible for a loan")

    config = get_config()
    approvers = list_users()
    loan = Loan(
        loan_id=str(uuid4()),
        member_id=member.member_id,
        requested_amount=body.requested_amount,
        repayment_interval_days=body.repayment_interval_days,
        interest_rate=config.default_interest_rate,
        application_date=date.today().isoformat(),
        remarks=body.remarks,
        status=LoanStatus.PENDING_BOARD_APPROVAL,
        is_exception_case=body.requested_amount > member.current_capital_amount,
        approvals={
            approver.user_id: ApprovalEntry(email=approver.email, status=ApprovalVoteStatus.PENDING)
            for approver in approvers
        },
    )
    put_loan(loan)
    return loan
```

- [ ] **Step 4: Register the router** — modify `backend/app/main.py` to read:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import config, health, loans, members, users


def _parse_allowed_origins(value: str) -> list[str]:
    """Split a comma-separated origin list, trimming whitespace around each
    entry so "a, b" (the natural way most people write a multi-origin list)
    works the same as "a,b"."""
    return [origin.strip() for origin in value.split(",") if origin.strip()]


app = FastAPI(title="Boombayan LMS API")
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
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_loans.py -v
```
Expected: PASS (7 passed)

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/loans.py backend/app/main.py backend/tests/test_loans.py
git commit -m "feat: add POST /loans create-application endpoint"
```

---

### Task 5: `GET /loans` and `GET /loans/{loan_id}` — list and detail endpoints

**Files:**
- Modify: `backend/app/routers/loans.py`
- Modify: `backend/tests/test_loans.py`

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/test_loans.py`:

```python
def test_list_loans_returns_all_loans_for_any_authenticated_user(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/loans")

    assert response.status_code == 200
    assert len(response.json()) == 1


def test_list_loans_filters_by_member_id(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
        )
    )
    put_loan(
        Loan(
            loan_id="loan-2", member_id="mem-2", requested_amount=5000,
            repayment_interval_days=15, interest_rate=0.05, application_date="2026-06-22",
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/loans", params={"member_id": "mem-2"})

    assert response.status_code == 200
    assert [loan["loan_id"] for loan in response.json()] == ["loan-2"]


def test_list_loans_filters_by_status(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import Loan, LoanStatus

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            status=LoanStatus.REJECTED,
        )
    )
    put_loan(
        Loan(
            loan_id="loan-2", member_id="mem-2", requested_amount=5000,
            repayment_interval_days=15, interest_rate=0.05, application_date="2026-06-22",
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/loans", params={"status": "Rejected"})

    assert response.status_code == 200
    assert [loan["loan_id"] for loan in response.json()] == ["loan-1"]


def test_get_loan_returns_loan_for_any_authenticated_user(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/loans/loan-1")

    assert response.status_code == 200
    assert response.json()["member_id"] == "mem-1"


def test_get_loan_returns_404_when_missing(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/loans/does-not-exist")

    assert response.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_loans.py -v
```
Expected: FAIL — `404 Not Found` for `GET /loans` (route doesn't exist yet).

- [ ] **Step 3: Add the endpoints** — append to `backend/app/routers/loans.py`, and add `get_loan_by_id`, `list_loans` to the `..db` import:

```python
from ..db import get_config, get_loan_by_id, get_member_by_id, list_loans, list_users, put_loan
```

```python
@router.get("/loans", response_model=list[Loan])
def get_loans(
    member_id: str | None = None,
    status: LoanStatus | None = None,
    user: User = Depends(get_current_user),
) -> list[Loan]:
    loans = list_loans()
    if member_id is not None:
        loans = [loan for loan in loans if loan.member_id == member_id]
    if status is not None:
        loans = [loan for loan in loans if loan.status == status]
    return loans


@router.get("/loans/{loan_id}", response_model=Loan)
def get_loan(loan_id: str, user: User = Depends(get_current_user)) -> Loan:
    loan = get_loan_by_id(loan_id)
    if loan is None:
        raise HTTPException(status_code=404, detail="Loan not found")
    return loan
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_loans.py -v
```
Expected: PASS (12 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/loans.py backend/tests/test_loans.py
git commit -m "feat: add GET /loans and GET /loans/{loan_id} endpoints"
```

---

### Task 6: `POST /loans/{loan_id}/approvals` — cast vote endpoint

A vote is final once cast. Rejecting immediately locks the loan to `Rejected`; completing unanimous approval flips it to `Approved` and sets `ApprovedAmount = RequestedAmount` (the board votes yes/no on the requested amount — no per-approver amount edits).

**Files:**
- Modify: `backend/app/routers/loans.py`
- Modify: `backend/tests/test_loans.py`

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/test_loans.py`:

```python
def test_cast_vote_records_approval(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import ApprovalEntry, Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            approvals={
                "admin-1": ApprovalEntry(email="admin@boombayan.org"),
                "board-1": ApprovalEntry(email="board@boombayan.org"),
            },
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/approvals", json={"status": "Approved", "comments": "Looks good"})

    assert response.status_code == 200
    body = response.json()
    assert body["approvals"]["board-1"]["status"] == "Approved"
    assert body["approvals"]["board-1"]["comments"] == "Looks good"
    assert body["approvals"]["board-1"]["date"]
    assert body["status"] == "Pending Board Approval"


def test_cast_vote_completing_unanimous_approval_sets_status_approved_and_approved_amount(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import ApprovalEntry, ApprovalVoteStatus, Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            approvals={
                "admin-1": ApprovalEntry(email="admin@boombayan.org", status=ApprovalVoteStatus.APPROVED),
                "board-1": ApprovalEntry(email="board@boombayan.org"),
            },
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/approvals", json={"status": "Approved"})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "Approved"
    assert body["approved_amount"] == 10000


def test_cast_vote_rejection_sets_status_rejected(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import ApprovalEntry, Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            approvals={
                "admin-1": ApprovalEntry(email="admin@boombayan.org"),
                "board-1": ApprovalEntry(email="board@boombayan.org"),
            },
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/approvals", json={"status": "Rejected", "comments": "Too risky"})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "Rejected"
    assert body["approvals"]["admin-1"]["status"] == "Pending"


def test_cast_vote_rejects_voting_twice(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import ApprovalEntry, ApprovalVoteStatus, Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            approvals={"board-1": ApprovalEntry(email="board@boombayan.org", status=ApprovalVoteStatus.APPROVED)},
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/approvals", json={"status": "Approved"})

    assert response.status_code == 400


def test_cast_vote_rejects_when_loan_not_pending(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import ApprovalEntry, Loan, LoanStatus

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            status=LoanStatus.REJECTED,
            approvals={"board-1": ApprovalEntry(email="board@boombayan.org")},
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/approvals", json={"status": "Approved"})

    assert response.status_code == 400


def test_cast_vote_rejects_for_user_not_in_approvals(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import ApprovalEntry, Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            approvals={"admin-1": ApprovalEntry(email="admin@boombayan.org")},
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/approvals", json={"status": "Approved"})

    assert response.status_code == 403


def test_cast_vote_rejects_pending_as_a_status_value(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import ApprovalEntry, Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
            approvals={"board-1": ApprovalEntry(email="board@boombayan.org")},
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/approvals", json={"status": "Pending"})

    assert response.status_code == 422


def test_cast_vote_returns_404_when_loan_missing(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/does-not-exist/approvals", json={"status": "Approved"})

    assert response.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_loans.py -v
```
Expected: FAIL — `404 Not Found` for `POST /loans/loan-1/approvals` (route doesn't exist yet).

- [ ] **Step 3: Add the endpoint** — append to `backend/app/routers/loans.py`, and add `CastVoteRequest` to the `..models.loan` import:

```python
from ..models.loan import ApprovalEntry, ApprovalVoteStatus, CastVoteRequest, CreateLoanRequest, Loan, LoanStatus
```

```python
@router.post("/loans/{loan_id}/approvals", response_model=Loan)
def cast_vote(loan_id: str, body: CastVoteRequest, user: User = Depends(get_current_user)) -> Loan:
    loan = get_loan_by_id(loan_id)
    if loan is None:
        raise HTTPException(status_code=404, detail="Loan not found")
    if loan.status != LoanStatus.PENDING_BOARD_APPROVAL:
        raise HTTPException(status_code=400, detail="This loan is no longer pending board approval")
    entry = loan.approvals.get(user.user_id)
    if entry is None:
        raise HTTPException(status_code=403, detail="You are not eligible to vote on this loan")
    if entry.status != ApprovalVoteStatus.PENDING:
        raise HTTPException(status_code=400, detail="You have already voted on this loan")

    entry.status = body.status
    entry.date = date.today().isoformat()
    entry.comments = body.comments

    if body.status == ApprovalVoteStatus.REJECTED:
        loan.status = LoanStatus.REJECTED
    elif all(e.status == ApprovalVoteStatus.APPROVED for e in loan.approvals.values()):
        loan.status = LoanStatus.APPROVED
        loan.approved_amount = loan.requested_amount

    put_loan(loan)
    return loan
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_loans.py -v
```
Expected: PASS (20 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/loans.py backend/tests/test_loans.py
git commit -m "feat: add POST /loans/{loan_id}/approvals cast-vote endpoint"
```

---

### Task 7: `POST /loans/{loan_id}/release` — release endpoint

**Files:**
- Modify: `backend/app/routers/loans.py`
- Modify: `backend/tests/test_loans.py`

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/test_loans.py`:

```python
def test_release_loan_computes_interest_and_balance(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
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

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "Active"
    assert body["release_date"] == "2026-06-22"
    assert body["interest_deduction"] == 500
    assert body["net_release_amount"] == 9500
    assert body["remaining_balance"] == 10000
    assert body["next_due_date"] == "2026-07-22"


def test_release_loan_defaults_release_date_to_today(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
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

    response = client.post("/loans/loan-1/release", json={})

    assert response.status_code == 200
    assert response.json()["release_date"]


def test_release_loan_rejects_when_not_approved(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    from app.db import put_loan
    from app.models.loan import Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/loan-1/release", json={})

    assert response.status_code == 400


def test_release_loan_rejected_for_non_administrator(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
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
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/loans/loan-1/release", json={})

    assert response.status_code == 403


def test_release_loan_returns_404_when_missing(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table, dynamodb_loans_table
):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/loans/does-not-exist/release", json={})

    assert response.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_loans.py -v
```
Expected: FAIL — `404 Not Found` for `POST /loans/loan-1/release` (route doesn't exist yet).

- [ ] **Step 3: Add the endpoint** — change the `from datetime import date` line at the top of `backend/app/routers/loans.py` to `from datetime import date, timedelta`, change the `..models.loan` import to:

```python
from ..models.loan import (
    ApprovalEntry,
    ApprovalVoteStatus,
    CastVoteRequest,
    CreateLoanRequest,
    Loan,
    LoanStatus,
    ReleaseLoanRequest,
)
```

and append:

```python
@router.post("/loans/{loan_id}/release", response_model=Loan)
def release_loan(loan_id: str, body: ReleaseLoanRequest, user: User = Depends(require_admin)) -> Loan:
    loan = get_loan_by_id(loan_id)
    if loan is None:
        raise HTTPException(status_code=404, detail="Loan not found")
    if loan.status != LoanStatus.APPROVED:
        raise HTTPException(status_code=400, detail="Only an approved loan can be released")

    release_date = body.release_date or date.today().isoformat()
    interest_deduction = loan.approved_amount * loan.interest_rate
    loan.release_date = release_date
    loan.interest_deduction = interest_deduction
    loan.net_release_amount = loan.approved_amount - interest_deduction
    loan.remaining_balance = loan.approved_amount
    loan.next_due_date = (
        date.fromisoformat(release_date) + timedelta(days=loan.repayment_interval_days)
    ).isoformat()
    loan.status = LoanStatus.ACTIVE
    put_loan(loan)
    return loan
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_loans.py -v
```
Expected: PASS (25 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/loans.py backend/tests/test_loans.py
git commit -m "feat: add POST /loans/{loan_id}/release endpoint"
```

---

### Task 8: Deploy updated backend to AWS

**Files:** none (deploy + verify only).

- [ ] **Step 1: Run the full backend suite one last time before deploying**

```bash
cd backend && source .venv/bin/activate && pytest -v && cd ..
```
Expected: all tests PASS (76 passed).

- [ ] **Step 2: Deploy**

```bash
cd infra && npx serverless deploy && cd ..
```
Expected: deploy succeeds; output ends with an `endpoints:` section.

- [ ] **Step 3: Verify the Loans table is healthy**

```bash
aws dynamodb describe-table --table-name boombayan-api-dev-loans --query 'Table.TableStatus'
```
Expected: `"ACTIVE"`.

- [ ] **Step 4: Verify the deployed health endpoint still responds**

```bash
curl https://<id>.execute-api.us-east-1.amazonaws.com/health
```
Expected: `{"status":"ok"}`

No commit for this task — it's a deploy of work already committed in Tasks 1-7.

---

### Task 9: Shared API types and the Loans list page

**Files:**
- Modify: `frontend/src/api/types.ts`
- Create: `frontend/src/pages/LoansPage.tsx`
- Test: `frontend/src/pages/LoansPage.test.tsx`

- [ ] **Step 1: Extend `frontend/src/api/types.ts`** — add `default_interest_rate` to `Config`, and append the loan types:

```ts
export interface Config {
  share_value: number
  max_shares_per_member: number
  default_interest_rate: number
}

export type LoanStatus = 'Pending Board Approval' | 'Approved' | 'Active' | 'Rejected'
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
  approvals: Record<string, ApprovalEntry>
}
```

(Replace the existing `Config` interface in place; the `MemberStatus`/`ShareHistoryEntry`/`Member` interfaces above it are unchanged.)

- [ ] **Step 2: Write the failing test** — `frontend/src/pages/LoansPage.test.tsx`

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { LoansPage } from './LoansPage'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

const loan = {
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
  approvals: {},
}

const member = {
  member_id: 'mem-1',
  first_name: 'Ana',
  last_name: 'Reyes',
  email: 'ana@example.com',
  phone: '1',
  date_joined: '2026-01-15',
  status: 'Active',
  current_shares: 0,
  current_capital_amount: 0,
  share_history: [],
}

describe('LoansPage', () => {
  it('shows the list of loans with member names after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/loans' ? Promise.resolve([loan]) : Promise.resolve([member]),
    )

    render(
      <MemoryRouter>
        <LoansPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Ana Reyes')).toBeInTheDocument())
    expect(screen.getByText('Pending Board Approval')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New loan application' })).toHaveAttribute('href', '/loans/new')
  })

  it('shows an error message when the loans fetch fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    render(
      <MemoryRouter>
        <LoansPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load loans.')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/LoansPage.test.tsx
```
Expected: FAIL — `Failed to resolve import "./LoansPage"`

- [ ] **Step 4: Write `frontend/src/pages/LoansPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Loan, Member } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export function LoansPage() {
  const { idToken } = useAuth()
  const [loans, setLoans] = useState<Loan[] | null>(null)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!idToken) return
    let cancelled = false
    Promise.all([apiFetch<Loan[]>('/loans', idToken), apiFetch<Member[]>('/members', idToken)])
      .then(([loansData, membersData]) => {
        if (!cancelled) {
          setLoans(loansData)
          setMembers(membersData)
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load loans.')
      })
    return () => {
      cancelled = true
    }
  }, [idToken])

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!loans || !members) {
    return <p>Loading...</p>
  }

  function memberName(memberId: string): string {
    const member = members!.find((m) => m.member_id === memberId)
    return member ? `${member.first_name} ${member.last_name}` : memberId
  }

  return (
    <div>
      <h1>Loans</h1>
      <Link to="/loans/new">New loan application</Link>
      <table>
        <thead>
          <tr>
            <th>Member</th>
            <th>Requested amount</th>
            <th>Status</th>
            <th>Application date</th>
          </tr>
        </thead>
        <tbody>
          {loans.map((loan) => (
            <tr key={loan.loan_id}>
              <td>
                <Link to={`/loans/${loan.loan_id}`}>{memberName(loan.member_id)}</Link>
              </td>
              <td>{loan.requested_amount}</td>
              <td>{loan.status}</td>
              <td>{loan.application_date}</td>
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
npx vitest run src/pages/LoansPage.test.tsx
```
Expected: PASS (2 passed)

- [ ] **Step 6: Commit**

```bash
cd ..
git add frontend/src/api/types.ts frontend/src/pages/LoansPage.tsx frontend/src/pages/LoansPage.test.tsx
git commit -m "feat: add Loans list page"
```

---

### Task 10: New Loan Application page

Not hidden from non-administrators in the dashboard nav (Task 13) — the backend's `require_admin` returns 403 on submit, surfaced as a generic error, exactly like Plan 2's Add Member/Settings pages.

**Files:**
- Create: `frontend/src/pages/NewLoanPage.tsx`
- Test: `frontend/src/pages/NewLoanPage.test.tsx`

- [ ] **Step 1: Write the failing test** — `frontend/src/pages/NewLoanPage.test.tsx`

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { NewLoanPage } from './NewLoanPage'

const navigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

const member = {
  member_id: 'mem-1',
  first_name: 'Ana',
  last_name: 'Reyes',
  email: 'ana@example.com',
  phone: '1',
  date_joined: '2026-01-15',
  status: 'Active',
  current_shares: 0,
  current_capital_amount: 0,
  share_history: [],
}

const createdLoan = {
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
  approvals: {},
}

describe('NewLoanPage', () => {
  it('loads members into the picker', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue([member])

    render(
      <MemoryRouter>
        <NewLoanPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('option', { name: 'Ana Reyes' })).toBeInTheDocument())
  })

  it('submits the form and navigates to the new loan on success', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValueOnce([member])

    render(
      <MemoryRouter>
        <NewLoanPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ana Reyes' })).toBeInTheDocument())

    vi.mocked(apiFetch).mockResolvedValueOnce(createdLoan)

    fireEvent.change(screen.getByLabelText('Requested amount'), { target: { value: '10000' } })
    fireEvent.change(screen.getByLabelText('Repayment interval (days)'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit application' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/loans', 'fake-id-token', {
        method: 'POST',
        body: { member_id: 'mem-1', requested_amount: 10000, repayment_interval_days: 30, remarks: null },
      }),
    )
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/loans/loan-1'))
  })

  it('shows an error message when loan creation fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValueOnce([member])

    render(
      <MemoryRouter>
        <NewLoanPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ana Reyes' })).toBeInTheDocument())

    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('boom'))
    fireEvent.change(screen.getByLabelText('Requested amount'), { target: { value: '10000' } })
    fireEvent.change(screen.getByLabelText('Repayment interval (days)'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit application' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not create loan application.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/NewLoanPage.test.tsx
```
Expected: FAIL — `Failed to resolve import "./NewLoanPage"`

- [ ] **Step 3: Write `frontend/src/pages/NewLoanPage.tsx`**

```tsx
import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Loan, Member } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export function NewLoanPage() {
  const { idToken } = useAuth()
  const navigate = useNavigate()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [memberId, setMemberId] = useState('')
  const [requestedAmount, setRequestedAmount] = useState('')
  const [repaymentIntervalDays, setRepaymentIntervalDays] = useState('')
  const [remarks, setRemarks] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!idToken) return
    let cancelled = false
    apiFetch<Member[]>('/members', idToken).then((data) => {
      if (!cancelled) {
        setMembers(data)
        if (data.length > 0) setMemberId(data[0].member_id)
      }
    })
    return () => {
      cancelled = true
    }
  }, [idToken])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!idToken) return
    setError(null)
    try {
      const loan = await apiFetch<Loan>('/loans', idToken, {
        method: 'POST',
        body: {
          member_id: memberId,
          requested_amount: Number(requestedAmount),
          repayment_interval_days: Number(repaymentIntervalDays),
          remarks: remarks || null,
        },
      })
      navigate(`/loans/${loan.loan_id}`)
    } catch {
      setError('Could not create loan application.')
    }
  }

  if (!members) {
    return <p>Loading...</p>
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>New loan application</h1>
      <label htmlFor="member">Member</label>
      <select id="member" value={memberId} onChange={(e) => setMemberId(e.target.value)} required>
        {members.map((member) => (
          <option key={member.member_id} value={member.member_id}>
            {member.first_name} {member.last_name}
          </option>
        ))}
      </select>
      <label htmlFor="requested-amount">Requested amount</label>
      <input
        id="requested-amount"
        type="number"
        value={requestedAmount}
        onChange={(e) => setRequestedAmount(e.target.value)}
        required
      />
      <label htmlFor="repayment-interval-days">Repayment interval (days)</label>
      <input
        id="repayment-interval-days"
        type="number"
        value={repaymentIntervalDays}
        onChange={(e) => setRepaymentIntervalDays(e.target.value)}
        required
      />
      <label htmlFor="remarks">Remarks</label>
      <input id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Submit application</button>
    </form>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/pages/NewLoanPage.test.tsx
```
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
cd ..
git add frontend/src/pages/NewLoanPage.tsx frontend/src/pages/NewLoanPage.test.tsx
git commit -m "feat: add New Loan Application page"
```

---

### Task 11: Loan detail page (approvals, voting, release)

Shows every board member's vote (email, status, date, comments). The vote form (Approve/Reject) only renders when the current viewer's own approval entry is still `Pending` and the loan is still `Pending Board Approval`. The release form only renders for administrators when the loan is `Approved`.

**Files:**
- Create: `frontend/src/pages/LoanDetailPage.tsx`
- Test: `frontend/src/pages/LoanDetailPage.test.tsx`

- [ ] **Step 1: Write the failing test** — `frontend/src/pages/LoanDetailPage.test.tsx`

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
  approvals: {
    'board-1': { email: 'board@boombayan.org', status: 'Pending', date: null, comments: null },
  },
}

const boardUser = { user_id: 'board-1', email: 'board@boombayan.org', is_administrator: false, member_id: null }
const adminUser = { user_id: 'admin-1', email: 'admin@boombayan.org', is_administrator: true, member_id: null }

describe('LoanDetailPage', () => {
  it('shows loan details and approvals after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/me' ? Promise.resolve(boardUser) : Promise.resolve(pendingLoan),
    )

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
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/me' ? Promise.resolve(boardUser) : Promise.resolve(pendingLoan),
    )

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
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/me' ? Promise.resolve(boardUser) : Promise.resolve(pendingLoan),
    )

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
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/me' ? Promise.resolve(boardUser) : Promise.resolve(alreadyVotedLoan),
    )

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Pending Board Approval')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('shows a release form for administrators when the loan is approved, and submits it', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    const approvedLoan = { ...pendingLoan, status: 'Approved', approved_amount: 10000 }
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/me' ? Promise.resolve(adminUser) : Promise.resolve(approvedLoan),
    )

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Approved')).toBeInTheDocument())

    const activeLoan = {
      ...approvedLoan,
      status: 'Active',
      release_date: '2026-06-21',
      interest_deduction: 500,
      net_release_amount: 9500,
      remaining_balance: 10000,
      next_due_date: '2026-07-21',
    }
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
    vi.mocked(apiFetch).mockImplementation((path) =>
      path === '/me' ? Promise.resolve(boardUser) : Promise.resolve(approvedLoan),
    )

    renderAtLoan('loan-1')
    await waitFor(() => expect(screen.getByText('Status: Approved')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: 'Release loan' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/LoanDetailPage.test.tsx
```
Expected: FAIL — `Failed to resolve import "./LoanDetailPage"`

- [ ] **Step 3: Write `frontend/src/pages/LoanDetailPage.tsx`**

```tsx
import { FormEvent, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { ApprovalVoteStatus, Loan } from '../api/types'
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
  const [error, setError] = useState<string | null>(null)
  const [comments, setComments] = useState('')
  const [voteError, setVoteError] = useState<string | null>(null)
  const [releaseDate, setReleaseDate] = useState('')
  const [releaseError, setReleaseError] = useState<string | null>(null)

  useEffect(() => {
    if (!idToken || !loanId) return
    let cancelled = false
    Promise.all([apiFetch<Loan>(`/loans/${loanId}`, idToken), apiFetch<CurrentUser>('/me', idToken)])
      .then(([loanData, userData]) => {
        if (!cancelled) {
          setLoan(loanData)
          setCurrentUser(userData)
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

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!loan || !currentUser) {
    return <p>Loading...</p>
  }

  const myApproval = loan.approvals[currentUser.user_id]
  const canVote = loan.status === 'Pending Board Approval' && myApproval?.status === 'Pending'
  const canRelease = currentUser.is_administrator && loan.status === 'Approved'

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
      {loan.status === 'Active' && (
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
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/pages/LoanDetailPage.test.tsx
```
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
cd ..
git add frontend/src/pages/LoanDetailPage.tsx frontend/src/pages/LoanDetailPage.test.tsx
git commit -m "feat: add Loan detail page with voting and release"
```

---

### Task 12: Settings page — add default interest rate field

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

describe('SettingsPage', () => {
  it('shows the current config values after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue({ share_value: 500, max_shares_per_member: 5, default_interest_rate: 0.05 })

    render(<SettingsPage />)

    await waitFor(() => expect(screen.getByLabelText('Share value')).toHaveValue(500))
    expect(screen.getByLabelText('Max shares per member')).toHaveValue(5)
    expect(screen.getByLabelText('Default interest rate')).toHaveValue(0.05)
  })

  it('saves updated config values on submit', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValueOnce({ share_value: 500, max_shares_per_member: 5, default_interest_rate: 0.05 })

    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByLabelText('Share value')).toHaveValue(500))

    vi.mocked(apiFetch).mockResolvedValueOnce({ share_value: 600, max_shares_per_member: 5, default_interest_rate: 0.05 })
    fireEvent.change(screen.getByLabelText('Share value'), { target: { value: '600' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/config', 'fake-id-token', {
        method: 'PUT',
        body: { share_value: 600, max_shares_per_member: 5, default_interest_rate: 0.05 },
      }),
    )
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
  })

  it('shows an error message when saving fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValueOnce({ share_value: 500, max_shares_per_member: 5, default_interest_rate: 0.05 })

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
Expected: FAIL — `Unable to find a label with the text of: Default interest rate`

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

- [ ] **Step 5: Commit**

```bash
cd ..
git add frontend/src/pages/SettingsPage.tsx frontend/src/pages/SettingsPage.test.tsx
git commit -m "feat: add default interest rate field to Settings page"
```

---

### Task 13: Route wiring and dashboard navigation

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/pages/DashboardPage.test.tsx`

- [ ] **Step 1: Write the failing test** — in `frontend/src/pages/DashboardPage.test.tsx`, modify the first test's assertions to read:

```tsx
    await waitFor(() =>
      expect(screen.getByText('Welcome, board@boombayan.org')).toBeInTheDocument(),
    )
    expect(screen.getByText('Administrator')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('href', '/members')
    expect(screen.getByRole('link', { name: 'Loans' })).toHaveAttribute('href', '/loans')
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
```

(The other two tests — hiding Settings for non-administrators, and the profile-fetch-error case — are unchanged.)

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/DashboardPage.test.tsx
```
Expected: FAIL — no link named "Loans" found.

- [ ] **Step 3: Add the navigation link** — modify `frontend/src/pages/DashboardPage.tsx`'s `<nav>` block to read:

```tsx
      <nav>
        <Link to="/members">Members</Link>
        <Link to="/loans">Loans</Link>
        {user.is_administrator && <Link to="/settings">Settings</Link>}
      </nav>
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/pages/DashboardPage.test.tsx
```
Expected: PASS (3 passed)

- [ ] **Step 5: Wire up the new routes** — modify `frontend/src/App.tsx` to read:

```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AddMemberPage } from './pages/AddMemberPage'
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

(`/loans/new` and `/loans/:loanId` can be declared in either order — React Router v6 always ranks the static segment `new` above the dynamic `:loanId` param when matching, regardless of route declaration order, same as `/members/new` vs `/members/:memberId`.)

- [ ] **Step 6: Run the full frontend suite**

```bash
npx vitest run
```
Expected: all tests PASS (49 passed).

- [ ] **Step 7: Commit**

```bash
cd ..
git add frontend/src/App.tsx frontend/src/pages/DashboardPage.tsx frontend/src/pages/DashboardPage.test.tsx
git commit -m "feat: wire up Loans routes and dashboard navigation"
```

---

### Task 14: End-to-end manual verification

Real proof against the live deployed stack, no mocks — same philosophy as Plan 1's Task 18 and Plan 2's Task 19. Uses the existing administrator account from Plan 1 (`michaelseno@gmail.com`). With only one seeded User, "unanimous approval" is satisfied by that one account's vote — the multi-approver path (loan stays `Pending Board Approval` until every User votes) is already covered live by Task 6's backend tests (`test_cast_vote_records_approval` uses two approvers and asserts the loan stays pending after only one votes).

**Execution note:** run via a scripted headless-Chromium (Playwright) session against `npm run dev`, same pattern as Plans 1-2.

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
Expected: redirected to `/dashboard`, showing "Welcome, michaelseno@gmail.com", "Administrator", and "Members", "Loans", "Settings" links.

- [ ] **Step 4: Configure the default interest rate**

Click "Settings". Set "Share value" to `500`, "Max shares per member" to `5`, "Default interest rate" to `0.05`, click "Save".
Expected: "Settings saved." appears. Reload the page — all three fields still show `500`, `5`, `0.05`.

- [ ] **Step 5: Add a fresh member with no capital**

Click "Members", then "Add member". Fill in a first name, last name, email, and phone, click "Create member".
Expected: redirected to `/members/<new-id>`, showing "Current capital: 0" — this member has no shares yet, so any loan request will exceed their capital and trigger the exception-case flag in Step 6.

- [ ] **Step 6: Create a loan application**

Click "Loans", then "New loan application". Select the member just created, enter `10000` for "Requested amount" and `30` for "Repayment interval (days)", click "Submit application".
Expected: redirected to `/loans/<new-id>`, showing "Status: Pending Board Approval", "Requested amount: 10000", "Approved amount: Not yet approved", "Exception case: requested amount exceeds the member's capital.", and an Approvals table with one row (`michaelseno@gmail.com`, status `Pending`). A "Cast your vote" section with "Approve"/"Reject" buttons is visible.

- [ ] **Step 7: Approve the loan**

Click "Approve".
Expected: the Approvals table's row updates to status `Approved` with today's date; "Status:" updates to `Approved`; "Approved amount: 10000" now shows; the vote form disappears (no more `Pending` entries); a "Release this loan" section with a "Release date" field and "Release loan" button appears (this account is an administrator).

- [ ] **Step 8: Release the loan**

Leave "Release date" blank, click "Release loan".
Expected: "Status:" updates to `Active`; a "Release details" section appears showing "Release date" as today's date, "Interest deduction: 500", "Net release amount: 9500", "Remaining balance: 10000", and "Next due date" as today's date plus 30 days.

- [ ] **Step 9: Verify the Loans list reflects the update**

Navigate back to "Loans".
Expected: the new loan's row shows the member's name, requested amount `10000`, status `Active`, and clicking the name navigates back to the same detail page.

- [ ] **Step 10: Verify the new routes are protected**

Click "Log out", then manually navigate the browser to `http://localhost:5173/loans`.
Expected: redirected to `/login` (no idToken) — confirms `ProtectedRoute` covers the new routes too.

- [ ] **Step 11: Stop the dev server**

```bash
# Ctrl+C in the terminal running npm run dev
cd ..
```

No commit for this task — it's verification of work already committed in Tasks 1-13.

---

### Task 15: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the "What's not here yet" section** — in `README.md`, replace:

```markdown
## What's not here yet

This is Plan 2 of a multi-plan project — auth, dashboard shell, and member/
share management. The loan lifecycle, payments/penalties, and cycle/dividend
processing are designed but not yet built; see `docs/superpowers/plans/` for
the phase breakdown.
```

with:

```markdown
## Applying for, approving, and releasing a loan

An administrator creates a loan application from a member's behalf
(`/loans/new`), picking the member and entering the requested amount and
repayment interval. The application snapshots the current default interest
rate from Settings and goes straight to board review — every current User
gets a vote. Any authenticated User can approve or reject from the loan's
detail page (`/loans/:loanId`); a single rejection ends the round, and the
loan only reaches `Approved` once every User has approved. Once approved,
an administrator releases it (computing the interest deduction, net release
amount, and first due date) from the same page, moving it to `Active`.

## What's not here yet

This is Plan 3 of a multi-plan project — auth, dashboard shell, member/share
management, and the loan lifecycle (application through release). Payment
recording, the penalty engine, and cycle/dividend processing are designed
but not yet built; see `docs/superpowers/plans/` for the phase breakdown.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document the loan application, approval, and release flow"
```

---

## Plan Self-Review Notes

- **Spec coverage:** This plan implements every section of `docs/superpowers/specs/2026-06-21-loan-lifecycle-design.md`: §2's `Loans` table (all listed attributes, no GSIs) and `Config.default_interest_rate`; §3's full create/vote/release mechanics including active-member eligibility, vote finality, immediate-rejection locking, unanimous-approval-completes-the-round, and manual (not automatic) release; §4's five endpoints; §5's three new pages plus the Settings field. All nine of §7's assumptions are reflected in the code exactly as stated (admin-only creation, no Draft stage, `ApprovedAmount = RequestedAmount` always, manual release, no separate `Released` status, final votes, active-member eligibility, scan-based listing, no retroactive approval-map entries).
- **Deliberately out of scope, carried to later plans:** no payment recording, no `Completed` status (both require Plan 4's payment tracking against `RemainingBalance`), no penalty engine or `PenaltyRate`/`PenaltyGracePeriodHours` (Plan 4), no Cycle entity or dividend distribution (Plan 5), no UI/visual polish pass (Plan 6, per the user's explicit sequencing decision during brainstorming). `ApprovalEntry.email` is a point-in-time snapshot, not a live lookup — if a User's email ever changes, old loans keep showing the email they had when the loan was created, matching the same "snapshot what was true at the time" philosophy as `InterestRate` and `ShareValueAtPurchase`.
- **Type consistency check:** `Loan`/`ApprovalEntry` Pydantic field names (Task 3) match `frontend/src/api/types.ts`'s `Loan`/`ApprovalEntry` interfaces (Task 9) key-for-key, including the `LoanStatus`/`ApprovalVoteStatus` string literal values (`"Pending Board Approval"`, etc.) matching the Python enum values exactly. `CreateLoanRequest`/`CastVoteRequest`/`ReleaseLoanRequest` (backend) match the POST bodies sent by `NewLoanPage` (Task 10) and `LoanDetailPage` (Task 11) field-for-field. `db.py` function names introduced in Task 3 (`list_users`, `get_loans_table`, `get_loan_by_id`, `put_loan`, `list_loans`) are the exact names imported by Tasks 4-7's router code — no renaming drift between definition and use.
- **Approvals stored as a dict, not a list:** matches the design doc's literal "map of `BoardMemberUserId -> {Status, Date, Comments}`" data-model description (§4 of the Phase 1 design doc, §2 of this plan's design doc). The frontend renders it via `Object.entries()`, same pattern as any other `Record<string, T>` in this codebase.
- **`IsExceptionCase` is computed once, at creation, and never recomputed:** since `ApprovedAmount` always equals `RequestedAmount` (confirmed during brainstorming — no per-approver amount edits), the exception-case comparison made against `RequestedAmount` at application time remains valid through approval and release; there's no second comparison anywhere later in the lifecycle.
- **Optional-field omission, not DynamoDB `NULL`, for unset Loan fields:** `_item_from_loan` only adds `ApprovedAmount`/`Remarks`/`ReleaseDate`/`InterestDeduction`/`NetReleaseAmount`/`RemainingBalance`/`NextDueDate` to the item when they're not `None`, matching `put_user`'s established convention for `MemberId` (Plan 1) rather than relying on boto3's resource-level `None` → `NULL` serialization. `_loan_from_item` correspondingly uses `"Key" in item` / `.get()` to reconstruct `None` for any field that was omitted.
- **No GSIs on Loans, matching Plan 2's Members precedent:** `list_loans()` is a full table scan, with `member_id`/`status` filtering done in Python by the `GET /loans` endpoint. Confirmed reasonable at this org's scale (the Phase 1 design doc's own stated rationale: "low hundreds of items, low request rate"); revisit only if scanning becomes a measured bottleneck.
- **Manual `Release`, not auto-release on final approval:** confirmed during brainstorming — `Approved` and `Active` are reached by two separate actions (a board vote completing the round, then a distinct administrator action), even though `Released` itself was collapsed into `Active` since nothing observable happens between them without Plan 4's payments. This mirrors a real disbursement happening on a different day than the approval vote.
- **End-to-end live verification only covers the single-administrator path:** same limitation Plan 2's Task 19 noted — there's no seeded second User account, so Task 14 can't observe a loan staying `Pending Board Approval` after a partial round of votes live in the browser. That specific behavior (loan stays pending until every User has voted) is covered by Task 6's `test_cast_vote_records_approval`, which uses two approvers and asserts the loan's status is unchanged after only one votes.
