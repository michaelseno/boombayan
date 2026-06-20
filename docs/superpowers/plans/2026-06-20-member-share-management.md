# Member & Share Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Member CRUD and share-purchase tracking (design doc §4 Members, §4 Config) on top of Plan 1's auth/infra foundation, gated so only administrators can create/edit data while any logged-in board member can view it, plus the frontend pages to use it.

**Architecture:** Same FastAPI/Lambda/DynamoDB/React stack as Plan 1. Two new DynamoDB-backed resources (Members table; reuses Plan 1's already-provisioned but unused Config table) behind two new FastAPI routers, gated by a new `require_admin` dependency built on top of Plan 1's auth. Frontend adds a Members list/detail/add flow and an admin-only Settings page, wired into the existing `ProtectedRoute`/`AuthContext` shell.

**Tech Stack:** Same as Plan 1 — no new dependencies required (verified: no new pip or npm packages needed for this plan's scope).

**Plan 1 follow-ups this plan resolves (carried over from Plan 1's self-review notes):**
1. CORS tightened from `allow_origins=["*"]` to an explicit allowlist (Task 1) — flagged in Plan 1 as "likely worth doing as part of Plan 2's first task."
2. `apiFetch` extended to support `method`/`body` (Task 2) — flagged in Plan 1 as needed once any endpoint requires POST/PUT with a JSON body, which this plan's Members/Config endpoints do.
3. Admin-only endpoint enforcement (Task 3) — flagged in Plan 1 as deferred "since there are no protected admin actions yet beyond viewing one's own profile." This plan's member/config write endpoints are the first ones that need it.

**File structure this plan creates/modifies:**
```
boombayan_project/
  backend/
    app/
      config.py          # MODIFY: add members_table, cors_allowed_origins
      main.py             # MODIFY: allowlist CORS, register members/config routers
      auth.py             # MODIFY: add get_current_user, require_admin
      db.py               # MODIFY: add Member and Config repository functions
      models/
        member.py         # CREATE: Member, ShareHistoryEntry, request models
        config.py          # CREATE: Config, UpdateConfigRequest
      routers/
        users.py           # MODIFY: use get_current_user
        members.py         # CREATE: member CRUD + share purchase routes
        config.py          # CREATE: config read/update routes
    tests/
      conftest.py          # MODIFY: add dynamodb_members_table, dynamodb_config_table
      test_cors.py         # CREATE
      test_auth.py          # MODIFY: add get_current_user/require_admin tests
      test_db.py            # MODIFY: add Member and Config repository tests
      test_members.py       # CREATE
      test_config.py        # CREATE
  frontend/
    src/
      api/
        client.ts           # MODIFY: method/body support
        client.test.ts       # MODIFY
        types.ts             # CREATE: shared Member/Config TS interfaces
      pages/
        DashboardPage.tsx     # MODIFY: nav links
        DashboardPage.test.tsx # MODIFY
        MembersPage.tsx        # CREATE
        MembersPage.test.tsx    # CREATE
        AddMemberPage.tsx        # CREATE
        AddMemberPage.test.tsx    # CREATE
        MemberDetailPage.tsx       # CREATE
        MemberDetailPage.test.tsx   # CREATE
        SettingsPage.tsx             # CREATE
        SettingsPage.test.tsx         # CREATE
      App.tsx                          # MODIFY: new routes
  infra/
    serverless.yml                      # MODIFY: CORS env var, Members table
  README.md                              # MODIFY
```

---

### Task 1: Tighten CORS to an explicit origin allowlist

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/main.py`
- Modify: `infra/serverless.yml`
- Test: `backend/tests/test_cors.py`

- [ ] **Step 1: Write the failing test** — `backend/tests/test_cors.py`

```python
def test_cors_allows_configured_origin(client):
    response = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_rejects_unconfigured_origin(client):
    response = client.get("/health", headers={"Origin": "http://evil.example.com"})
    assert "access-control-allow-origin" not in response.headers
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && source .venv/bin/activate && pytest tests/test_cors.py -v
```
Expected: FAIL on both — today's `allow_origins=["*"]` makes Starlette's `CORSMiddleware` return `access-control-allow-origin: *` for every origin (so the first test gets `*` instead of the real origin, and the second test finds the header present when it should be absent).

- [ ] **Step 3: Add `cors_allowed_origins` to `backend/app/config.py`** — modify to read:

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    users_table: str = "boombayan-api-dev-users"
    config_table: str = "boombayan-api-dev-config"
    cognito_user_pool_id: str = ""
    cognito_client_id: str = ""
    aws_region: str = "us-east-1"
    cors_allowed_origins: str = "http://localhost:5173"


settings = Settings()
```

- [ ] **Step 4: Update `backend/app/main.py`** — modify to read:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import health, users

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
    allow_origins=settings.cors_allowed_origins.split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health.router)
app.include_router(users.router)
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pytest tests/test_cors.py -v
```
Expected: PASS (2 passed)

- [ ] **Step 6: Run the full backend suite to confirm nothing else broke**

```bash
pytest -v
```
Expected: all tests PASS.

- [ ] **Step 7: Add `CORS_ALLOWED_ORIGINS` to `infra/serverless.yml`** — modify the `provider.environment` block to read:

```yaml
  environment:
    USERS_TABLE: ${self:service}-${sls:stage}-users
    CONFIG_TABLE: ${self:service}-${sls:stage}-config
    COGNITO_USER_POOL_ID: !Ref CognitoUserPool
    COGNITO_CLIENT_ID: !Ref CognitoUserPoolClient
    CORS_ALLOWED_ORIGINS: http://localhost:5173
```

- [ ] **Step 8: Deploy**

```bash
cd infra && npx serverless deploy && cd ..
```
Expected: deploy succeeds; output still shows the API endpoint.

- [ ] **Step 9: Verify the deployed health endpoint still responds**

```bash
curl https://<id>.execute-api.us-east-1.amazonaws.com/health
```
(substitute the actual URL host from the deploy output)
Expected: `{"status":"ok"}`

- [ ] **Step 10: Commit**

```bash
git add backend/app/config.py backend/app/main.py backend/tests/test_cors.py infra/serverless.yml
git commit -m "fix: tighten CORS to an explicit origin allowlist"
```

---

### Task 2: Extend `apiFetch` with method/body support

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`

- [ ] **Step 1: Write the updated test file** — replace the full contents of `frontend/src/api/client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './client'

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the bearer token and returns parsed JSON on a default GET request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user_id: 'abc123' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await apiFetch<{ user_id: string }>('/me', 'fake-id-token')

    expect(result).toEqual({ user_id: 'abc123' })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/me'), {
      method: 'GET',
      headers: { Authorization: 'Bearer fake-id-token' },
      body: undefined,
    })
  })

  it('sends a JSON body and Content-Type header for POST requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ member_id: 'mem-1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await apiFetch<{ member_id: string }>('/members', 'fake-id-token', {
      method: 'POST',
      body: { first_name: 'Ana' },
    })

    expect(result).toEqual({ member_id: 'mem-1' })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/members'), {
      method: 'POST',
      headers: { Authorization: 'Bearer fake-id-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: 'Ana' }),
    })
  })

  it('throws when the response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiFetch('/me', 'fake-id-token')).rejects.toThrow(
      'API request to /me failed with status 404',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/api/client.test.ts
```
Expected: FAIL — the current `apiFetch` never passes a `method` or `body` key to `fetch`, so the `toHaveBeenCalledWith` assertions in the first two tests don't match.

- [ ] **Step 3: Write `frontend/src/api/client.ts`** — replace the full contents:

```ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

export interface ApiFetchOptions {
  method?: string
  body?: unknown
}

export async function apiFetch<T>(
  path: string,
  idToken: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${idToken}` }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  if (!response.ok) {
    throw new Error(`API request to ${path} failed with status ${response.status}`)
  }
  return response.json() as Promise<T>
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/api/client.test.ts
```
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
cd ..
git add frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat: support method and JSON body in apiFetch"
```

---

### Task 3: Auth dependencies — `get_current_user` and `require_admin`

This is the real authorization boundary every admin-only endpoint added later in this plan depends on. It also refactors `GET /me`'s existing user-lookup logic into a reusable dependency rather than duplicating it.

**Files:**
- Modify: `backend/app/auth.py`
- Modify: `backend/app/routers/users.py`
- Modify: `backend/tests/test_auth.py`

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/test_auth.py` (add `get_current_user` and `require_admin` to the existing top import line, and add `put_user`/`User` imports):

Replace the full contents of `backend/tests/test_auth.py`:

```python
import jwt
import pytest
from fastapi import HTTPException

from app.auth import get_current_user, get_current_user_id, require_admin
from app.db import put_user
from app.models.user import User


def test_get_current_user_id_returns_sub_for_valid_token(monkeypatch):
    monkeypatch.setattr(
        "app.auth.decode_token",
        lambda token: {"sub": "user-123", "token_use": "id"},
    )
    user_id = get_current_user_id(authorization="Bearer faketoken")
    assert user_id == "user-123"


def test_get_current_user_id_rejects_missing_bearer_scheme():
    with pytest.raises(HTTPException) as exc_info:
        get_current_user_id(authorization="faketoken")
    assert exc_info.value.status_code == 401


def test_get_current_user_id_rejects_invalid_token(monkeypatch):
    def raise_invalid(token):
        raise jwt.InvalidTokenError("bad token")

    monkeypatch.setattr("app.auth.decode_token", raise_invalid)
    with pytest.raises(HTTPException) as exc_info:
        get_current_user_id(authorization="Bearer faketoken")
    assert exc_info.value.status_code == 401


def test_get_current_user_returns_user_when_found(dynamodb_users_table):
    put_user(User(user_id="abc123", email="board@boombayan.org", is_administrator=False))

    user = get_current_user(user_id="abc123")

    assert user.email == "board@boombayan.org"


def test_get_current_user_raises_404_when_missing(dynamodb_users_table):
    with pytest.raises(HTTPException) as exc_info:
        get_current_user(user_id="no-such-user")
    assert exc_info.value.status_code == 404


def test_require_admin_passes_through_administrator():
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)

    result = require_admin(user=admin)

    assert result == admin


def test_require_admin_rejects_non_administrator():
    member = User(user_id="member-1", email="member@boombayan.org", is_administrator=False)

    with pytest.raises(HTTPException) as exc_info:
        require_admin(user=member)
    assert exc_info.value.status_code == 403
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_auth.py -v
```
Expected: FAIL — `ImportError: cannot import name 'get_current_user'` (and `require_admin`) from `app.auth`.

- [ ] **Step 3: Write `backend/app/auth.py`** — replace the full contents:

```python
import jwt
from fastapi import Depends, Header, HTTPException

from .config import settings
from .db import get_user_by_id
from .models.user import User

_jwks_client: jwt.PyJWKClient | None = None


def _get_jwks_client() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        url = (
            f"https://cognito-idp.{settings.aws_region}.amazonaws.com/"
            f"{settings.cognito_user_pool_id}/.well-known/jwks.json"
        )
        _jwks_client = jwt.PyJWKClient(url)
    return _jwks_client


def decode_token(token: str) -> dict:
    signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
    claims = jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        audience=settings.cognito_client_id,
    )
    if claims.get("token_use") != "id":
        raise jwt.InvalidTokenError("Expected an ID token")
    return claims


def get_current_user_id(authorization: str = Header(...)) -> str:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    try:
        claims = decode_token(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc
    return claims["sub"]


def get_current_user(user_id: str = Depends(get_current_user_id)) -> User:
    # A valid Cognito token with no matching Users-table row is a real, not
    # hypothetical, case: this system has no self-registration, so every
    # account is provisioned by an out-of-band process (scripts/seed_admin.py
    # is the only sanctioned one so far). If a Cognito user is ever created
    # some other way, they'll authenticate successfully but land here.
    user = get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_administrator:
        raise HTTPException(status_code=403, detail="Administrator access required")
    return user
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_auth.py -v
```
Expected: PASS (7 passed)

- [ ] **Step 5: Refactor `GET /me` to use `get_current_user`** — replace the full contents of `backend/app/routers/users.py`:

```python
from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..models.user import User

router = APIRouter()


@router.get("/me", response_model=User)
def get_me(user: User = Depends(get_current_user)) -> User:
    return user
```

- [ ] **Step 6: Run the full backend suite to confirm `test_users.py`'s existing tests still pass unchanged**

```bash
pytest -v
```
Expected: all tests PASS. `test_users.py` overrides `get_current_user_id` (not `get_current_user`) — this still works because FastAPI's `dependency_overrides` replaces a given callable anywhere it appears in the dependency tree, no matter how deeply nested, so overriding `get_current_user_id` still takes effect inside `get_current_user`'s own dependency on it.

- [ ] **Step 7: Commit**

```bash
git add backend/app/auth.py backend/app/routers/users.py backend/tests/test_auth.py
git commit -m "feat: add get_current_user and require_admin auth dependencies"
```

---

### Task 4: Members DynamoDB table

**Files:**
- Modify: `infra/serverless.yml`

- [ ] **Step 1: Add `MEMBERS_TABLE` env var** — modify the `provider.environment` block to read:

```yaml
  environment:
    USERS_TABLE: ${self:service}-${sls:stage}-users
    CONFIG_TABLE: ${self:service}-${sls:stage}-config
    MEMBERS_TABLE: ${self:service}-${sls:stage}-members
    COGNITO_USER_POOL_ID: !Ref CognitoUserPool
    COGNITO_CLIENT_ID: !Ref CognitoUserPoolClient
    CORS_ALLOWED_ORIGINS: http://localhost:5173
```

- [ ] **Step 2: Add the table's ARN to the IAM statement** — modify the `provider.iam.role.statements[0].Resource` list to read:

```yaml
          Resource:
            - !GetAtt UsersTable.Arn
            - !GetAtt ConfigTable.Arn
            - !GetAtt MembersTable.Arn
```

- [ ] **Step 3: Add the `MembersTable` resource** — under `resources.Resources`, insert this block immediately after `ConfigTable` (before `CognitoUserPool`):

```yaml
    MembersTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:provider.environment.MEMBERS_TABLE}
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: MemberId
            AttributeType: S
        KeySchema:
          - AttributeName: MemberId
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
aws dynamodb describe-table --table-name boombayan-api-dev-members --query 'Table.TableStatus'
```
Expected: prints `"ACTIVE"`.

- [ ] **Step 6: Commit**

```bash
git add infra/serverless.yml
git commit -m "feat: provision Members DynamoDB table"
```

---

### Task 5: Member model and DynamoDB repository functions

DynamoDB's `boto3` resource rejects native Python `float`s on `put_item` (`TypeError: Float types are not supported. Use Decimal types instead.`) — verified directly against moto before writing this task. Every numeric field that isn't an int therefore round-trips through `Decimal`.

**Files:**
- Create: `backend/app/models/member.py`
- Modify: `backend/app/db.py`
- Modify: `backend/app/config.py`
- Modify: `backend/tests/conftest.py`
- Modify: `backend/tests/test_db.py`

- [ ] **Step 1: Add `members_table` to `backend/app/config.py`** — modify to read:

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    users_table: str = "boombayan-api-dev-users"
    config_table: str = "boombayan-api-dev-config"
    members_table: str = "boombayan-api-dev-members"
    cognito_user_pool_id: str = ""
    cognito_client_id: str = ""
    aws_region: str = "us-east-1"
    cors_allowed_origins: str = "http://localhost:5173"


settings = Settings()
```

- [ ] **Step 2: Write `backend/app/models/member.py`**

```python
from enum import Enum

from pydantic import BaseModel, Field


class MemberStatus(str, Enum):
    ACTIVE = "Active"
    INACTIVE = "Inactive"
    WITHDRAWN = "Withdrawn"


class ShareHistoryEntry(BaseModel):
    cycle_id: str | None = None
    shares_purchased: int
    share_value_at_purchase: float
    amount_paid: float
    date: str


class Member(BaseModel):
    member_id: str
    first_name: str
    last_name: str
    email: str
    phone: str
    date_joined: str
    status: MemberStatus = MemberStatus.ACTIVE
    current_shares: int = 0
    current_capital_amount: float = 0
    share_history: list[ShareHistoryEntry] = []


class CreateMemberRequest(BaseModel):
    first_name: str
    last_name: str
    email: str
    phone: str
    date_joined: str | None = None


class UpdateMemberRequest(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    phone: str | None = None
    status: MemberStatus | None = None


class PurchaseSharesRequest(BaseModel):
    shares_purchased: int = Field(gt=0)
```

- [ ] **Step 3: Add the `dynamodb_members_table` fixture** — modify `backend/tests/conftest.py` to add this fixture after `dynamodb_users_table`:

```python
@pytest.fixture
def dynamodb_members_table(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "members_table", "test-members")

    with mock_aws():
        dynamo_client = boto3.client("dynamodb", region_name="us-east-1")
        dynamo_client.create_table(
            TableName="test-members",
            AttributeDefinitions=[{"AttributeName": "MemberId", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "MemberId", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield
```

(Nesting two separate `with mock_aws():` blocks — one from `dynamodb_users_table`, one from `dynamodb_members_table` — works correctly: verified directly that tables created in an outer `mock_aws()` block remain visible inside a nested one, and vice versa.)

- [ ] **Step 4: Write the failing tests** — append to `backend/tests/test_db.py`:

```python
def test_put_and_get_member_roundtrip(dynamodb_members_table):
    from app.db import get_member_by_id, put_member
    from app.models.member import Member

    member = Member(
        member_id="mem-1",
        first_name="Ana",
        last_name="Reyes",
        email="ana@example.com",
        phone="09171234567",
        date_joined="2026-01-15",
    )
    put_member(member)

    fetched = get_member_by_id("mem-1")
    assert fetched == member


def test_get_member_by_id_returns_none_when_missing(dynamodb_members_table):
    from app.db import get_member_by_id

    assert get_member_by_id("does-not-exist") is None


def test_list_members_returns_all_members(dynamodb_members_table):
    from app.db import list_members, put_member
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
        )
    )
    put_member(
        Member(
            member_id="mem-2", first_name="Bo", last_name="Cruz",
            email="bo@example.com", phone="2", date_joined="2026-01-16",
        )
    )

    members = list_members()
    assert {m.member_id for m in members} == {"mem-1", "mem-2"}


def test_put_member_persists_share_history(dynamodb_members_table):
    from app.db import get_member_by_id, put_member
    from app.models.member import Member, ShareHistoryEntry

    member = Member(
        member_id="mem-1",
        first_name="Ana",
        last_name="Reyes",
        email="ana@example.com",
        phone="1",
        date_joined="2026-01-15",
        current_shares=2,
        current_capital_amount=1000,
        share_history=[
            ShareHistoryEntry(
                shares_purchased=2, share_value_at_purchase=500, amount_paid=1000, date="2026-02-01",
            ),
        ],
    )
    put_member(member)

    fetched = get_member_by_id("mem-1")
    assert fetched == member
```

- [ ] **Step 5: Run test to verify it fails**

```bash
pytest tests/test_db.py -v
```
Expected: FAIL — `ImportError: cannot import name 'get_member_by_id' from 'app.db'`.

- [ ] **Step 6: Write the repository functions** — modify `backend/app/db.py` to read:

```python
from decimal import Decimal

import boto3

from .config import settings
from .models.member import Member, MemberStatus, ShareHistoryEntry
from .models.user import User


def _dynamodb():
    # Created fresh on every call (not cached at module scope) so tests can
    # activate moto's mock_aws() before any AWS client/resource is constructed.
    return boto3.resource("dynamodb", region_name=settings.aws_region)


def get_users_table():
    return _dynamodb().Table(settings.users_table)


def get_config_table():
    return _dynamodb().Table(settings.config_table)


def get_members_table():
    return _dynamodb().Table(settings.members_table)


def get_user_by_id(user_id: str) -> User | None:
    response = get_users_table().get_item(Key={"UserId": user_id})
    item = response.get("Item")
    if item is None:
        return None
    return User(
        user_id=item["UserId"],
        email=item["Email"],
        is_administrator=item.get("IsAdministrator", False),
        member_id=item.get("MemberId"),
    )


def put_user(user: User) -> None:
    item = {
        "UserId": user.user_id,
        "Email": user.email,
        "IsAdministrator": user.is_administrator,
    }
    if user.member_id is not None:
        item["MemberId"] = user.member_id
    get_users_table().put_item(Item=item)


def _share_history_from_items(items: list[dict]) -> list[ShareHistoryEntry]:
    return [
        ShareHistoryEntry(
            cycle_id=entry.get("CycleId"),
            shares_purchased=int(entry["SharesPurchased"]),
            share_value_at_purchase=float(entry["ShareValueAtPurchase"]),
            amount_paid=float(entry["AmountPaid"]),
            date=entry["Date"],
        )
        for entry in items
    ]


def _member_from_item(item: dict) -> Member:
    return Member(
        member_id=item["MemberId"],
        first_name=item["FirstName"],
        last_name=item["LastName"],
        email=item["Email"],
        phone=item["Phone"],
        date_joined=item["DateJoined"],
        status=MemberStatus(item["Status"]),
        current_shares=int(item["CurrentShares"]),
        current_capital_amount=float(item["CurrentCapitalAmount"]),
        share_history=_share_history_from_items(item.get("ShareHistory", [])),
    )


def _item_from_member(member: Member) -> dict:
    return {
        "MemberId": member.member_id,
        "FirstName": member.first_name,
        "LastName": member.last_name,
        "Email": member.email,
        "Phone": member.phone,
        "DateJoined": member.date_joined,
        "Status": member.status.value,
        "CurrentShares": member.current_shares,
        "CurrentCapitalAmount": Decimal(str(member.current_capital_amount)),
        "ShareHistory": [
            {
                "CycleId": entry.cycle_id,
                "SharesPurchased": entry.shares_purchased,
                "ShareValueAtPurchase": Decimal(str(entry.share_value_at_purchase)),
                "AmountPaid": Decimal(str(entry.amount_paid)),
                "Date": entry.date,
            }
            for entry in member.share_history
        ],
    }


def get_member_by_id(member_id: str) -> Member | None:
    response = get_members_table().get_item(Key={"MemberId": member_id})
    item = response.get("Item")
    if item is None:
        return None
    return _member_from_item(item)


def put_member(member: Member) -> None:
    get_members_table().put_item(Item=_item_from_member(member))


def list_members() -> list[Member]:
    response = get_members_table().scan()
    return [_member_from_item(item) for item in response["Items"]]
```

- [ ] **Step 7: Run test to verify it passes**

```bash
pytest tests/test_db.py -v
```
Expected: PASS (6 passed)

- [ ] **Step 8: Commit**

```bash
git add backend/app/config.py backend/app/models/member.py backend/app/db.py backend/tests/conftest.py backend/tests/test_db.py
git commit -m "feat: add Member model and DynamoDB repository functions"
```

---

### Task 6: `POST /members` — create member endpoint

**Files:**
- Create: `backend/app/routers/members.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_members.py`

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_members.py`

```python
from app.auth import get_current_user_id
from app.db import put_user
from app.main import app
from app.models.user import User


def test_create_member_succeeds_for_administrator(client, dynamodb_users_table, dynamodb_members_table):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/members",
        json={
            "first_name": "Ana",
            "last_name": "Reyes",
            "email": "ana@example.com",
            "phone": "09171234567",
            "date_joined": "2026-01-15",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["first_name"] == "Ana"
    assert body["status"] == "Active"
    assert body["current_shares"] == 0
    assert body["member_id"]


def test_create_member_defaults_date_joined_to_today(client, dynamodb_users_table, dynamodb_members_table):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post(
        "/members",
        json={"first_name": "Ana", "last_name": "Reyes", "email": "ana@example.com", "phone": "1"},
    )

    assert response.status_code == 201
    assert response.json()["date_joined"]


def test_create_member_rejected_for_non_administrator(client, dynamodb_users_table):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post(
        "/members",
        json={"first_name": "Ana", "last_name": "Reyes", "email": "ana@example.com", "phone": "1"},
    )

    assert response.status_code == 403
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_members.py -v
```
Expected: FAIL with `404` (no `/members` route exists yet).

- [ ] **Step 3: Write `backend/app/routers/members.py`**

```python
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
```

- [ ] **Step 4: Register the router** — modify `backend/app/main.py` to read:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import health, members, users

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
    allow_origins=settings.cors_allowed_origins.split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health.router)
app.include_router(users.router)
app.include_router(members.router)
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pytest tests/test_members.py -v
```
Expected: PASS (3 passed)

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/members.py backend/app/main.py backend/tests/test_members.py
git commit -m "feat: add POST /members create-member endpoint"
```

---

### Task 7: `GET /members` and `GET /members/{member_id}` — list and detail endpoints

**Files:**
- Modify: `backend/app/routers/members.py`
- Modify: `backend/tests/test_members.py`

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/test_members.py`:

```python
def test_list_members_returns_all_members_for_any_authenticated_user(
    client, dynamodb_users_table, dynamodb_members_table
):
    from app.db import put_member
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/members")

    assert response.status_code == 200
    assert len(response.json()) == 1


def test_get_member_returns_member_for_any_authenticated_user(
    client, dynamodb_users_table, dynamodb_members_table
):
    from app.db import put_member
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/members/mem-1")

    assert response.status_code == 200
    assert response.json()["first_name"] == "Ana"


def test_get_member_returns_404_when_missing(client, dynamodb_users_table, dynamodb_members_table):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.get("/members/does-not-exist")

    assert response.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_members.py -v
```
Expected: FAIL with `404`/`405`-shaped failures (no `GET /members` or `GET /members/{member_id}` routes exist yet — FastAPI's default 404 for unmatched routes).

- [ ] **Step 3: Add the routes** — append to `backend/app/routers/members.py`:

```python
from fastapi import HTTPException

from ..db import get_member_by_id, list_members
from ..auth import get_current_user


@router.get("/members", response_model=list[Member])
def get_members(user: User = Depends(get_current_user)) -> list[Member]:
    return list_members()


@router.get("/members/{member_id}", response_model=Member)
def get_member(member_id: str, user: User = Depends(get_current_user)) -> Member:
    member = get_member_by_id(member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    return member
```

The full file's import block at the top should now read:

```python
from datetime import date
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, require_admin
from ..db import get_member_by_id, list_members, put_member
from ..models.member import CreateMemberRequest, Member, MemberStatus
from ..models.user import User

router = APIRouter()
```

(Consolidate the imports added in Step 3 into this single top-of-file block rather than leaving a second scattered `from fastapi import HTTPException` further down the file.)

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_members.py -v
```
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/members.py backend/tests/test_members.py
git commit -m "feat: add GET /members and GET /members/{member_id} endpoints"
```

---

### Task 8: `PUT /members/{member_id}` — update member endpoint

**Files:**
- Modify: `backend/app/routers/members.py`
- Modify: `backend/tests/test_members.py`

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/test_members.py`:

```python
def test_update_member_succeeds_for_administrator(client, dynamodb_users_table, dynamodb_members_table):
    from app.db import put_member
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.put("/members/mem-1", json={"status": "Withdrawn"})

    assert response.status_code == 200
    assert response.json()["status"] == "Withdrawn"
    assert response.json()["first_name"] == "Ana"


def test_update_member_rejected_for_non_administrator(client, dynamodb_users_table, dynamodb_members_table):
    from app.db import put_member
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.put("/members/mem-1", json={"status": "Withdrawn"})

    assert response.status_code == 403


def test_update_member_returns_404_when_missing(client, dynamodb_users_table, dynamodb_members_table):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.put("/members/does-not-exist", json={"status": "Withdrawn"})

    assert response.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_members.py -v
```
Expected: FAIL — `405 Method Not Allowed` (no `PUT /members/{member_id}` route exists yet).

- [ ] **Step 3: Add the route** — append to `backend/app/routers/members.py`, and add `UpdateMemberRequest` to the `..models.member` import:

```python
@router.put("/members/{member_id}", response_model=Member)
def update_member(
    member_id: str, body: UpdateMemberRequest, user: User = Depends(require_admin)
) -> Member:
    member = get_member_by_id(member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if body.first_name is not None:
        member.first_name = body.first_name
    if body.last_name is not None:
        member.last_name = body.last_name
    if body.email is not None:
        member.email = body.email
    if body.phone is not None:
        member.phone = body.phone
    if body.status is not None:
        member.status = body.status
    put_member(member)
    return member
```

Update the import line:

```python
from ..models.member import CreateMemberRequest, Member, MemberStatus, UpdateMemberRequest
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_members.py -v
```
Expected: PASS (9 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/members.py backend/tests/test_members.py
git commit -m "feat: add PUT /members/{member_id} update endpoint"
```

---

### Task 9: Config model and DynamoDB repository functions

The design doc's `Config` is a single DynamoDB item holding every board-configurable value (§4) — but most of those values (interest rate, penalty rate, Top-3 bonus weights) belong to features that don't exist yet (loans, payments, cycles — Plans 3-5). This task's `Config` model only declares the two fields this plan actually needs (`share_value`, `max_shares_per_member`); later plans add their own fields to the same model/item when they need them, rather than this plan pre-declaring fields nothing reads yet.

**Files:**
- Create: `backend/app/models/config.py`
- Modify: `backend/app/db.py`
- Modify: `backend/tests/conftest.py`
- Modify: `backend/tests/test_db.py`

- [ ] **Step 1: Write `backend/app/models/config.py`**

```python
from pydantic import BaseModel


class Config(BaseModel):
    share_value: float = 0
    max_shares_per_member: int = 5


class UpdateConfigRequest(BaseModel):
    share_value: float | None = None
    max_shares_per_member: int | None = None
```

(`max_shares_per_member` defaults to 5, matching the design doc's note that share purchases are "rare and capped (max 5 shares ever)" — board-adjustable, not hardcoded.)

- [ ] **Step 2: Add the `dynamodb_config_table` fixture** — modify `backend/tests/conftest.py` to add this fixture after `dynamodb_members_table`:

```python
@pytest.fixture
def dynamodb_config_table(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "config_table", "test-config")

    with mock_aws():
        dynamo_client = boto3.client("dynamodb", region_name="us-east-1")
        dynamo_client.create_table(
            TableName="test-config",
            AttributeDefinitions=[{"AttributeName": "ConfigKey", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "ConfigKey", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield
```

- [ ] **Step 3: Write the failing tests** — append to `backend/tests/test_db.py`:

```python
def test_get_config_returns_defaults_when_not_set(dynamodb_config_table):
    from app.db import get_config
    from app.models.config import Config

    assert get_config() == Config()


def test_put_and_get_config_roundtrip(dynamodb_config_table):
    from app.db import get_config, put_config
    from app.models.config import Config

    config = Config(share_value=500, max_shares_per_member=5)
    put_config(config)

    assert get_config() == config
```

- [ ] **Step 4: Run test to verify it fails**

```bash
pytest tests/test_db.py -v
```
Expected: FAIL — `ImportError: cannot import name 'get_config' from 'app.db'`.

- [ ] **Step 5: Write the repository functions** — append to `backend/app/db.py` (and add `from .models.config import Config` to the import block):

```python
CONFIG_KEY = "global"


def get_config() -> Config:
    response = get_config_table().get_item(Key={"ConfigKey": CONFIG_KEY})
    item = response.get("Item")
    if item is None:
        return Config()
    return Config(
        share_value=float(item.get("ShareValue", 0)),
        max_shares_per_member=int(item.get("MaxSharesPerMember", 5)),
    )


def put_config(config: Config) -> None:
    get_config_table().put_item(
        Item={
            "ConfigKey": CONFIG_KEY,
            "ShareValue": Decimal(str(config.share_value)),
            "MaxSharesPerMember": config.max_shares_per_member,
        }
    )
```

The top of `backend/app/db.py` should now import:

```python
from decimal import Decimal

import boto3

from .config import settings
from .models.config import Config
from .models.member import Member, MemberStatus, ShareHistoryEntry
from .models.user import User
```

- [ ] **Step 6: Run test to verify it passes**

```bash
pytest tests/test_db.py -v
```
Expected: PASS (8 passed)

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/config.py backend/app/db.py backend/tests/conftest.py backend/tests/test_db.py
git commit -m "feat: add Config model and DynamoDB repository functions"
```

---

### Task 10: `GET /config` and `PUT /config` endpoints

**Files:**
- Create: `backend/app/routers/config.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_config.py`

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_config.py`

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
    assert response.json() == {"share_value": 0, "max_shares_per_member": 5}


def test_update_config_succeeds_for_administrator(client, dynamodb_users_table, dynamodb_config_table):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.put("/config", json={"share_value": 500, "max_shares_per_member": 5})

    assert response.status_code == 200
    assert response.json() == {"share_value": 500, "max_shares_per_member": 5}


def test_update_config_partial_update_preserves_other_field(
    client, dynamodb_users_table, dynamodb_config_table
):
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    client.put("/config", json={"share_value": 500, "max_shares_per_member": 5})
    response = client.put("/config", json={"share_value": 600})

    assert response.status_code == 200
    assert response.json() == {"share_value": 600, "max_shares_per_member": 5}


def test_update_config_rejected_for_non_administrator(client, dynamodb_users_table, dynamodb_config_table):
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.put("/config", json={"share_value": 500})

    assert response.status_code == 403
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_config.py -v
```
Expected: FAIL with `404` (no `/config` route exists yet).

- [ ] **Step 3: Write `backend/app/routers/config.py`**

```python
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
    put_config(config)
    return config
```

- [ ] **Step 4: Register the router** — modify `backend/app/main.py`'s router imports and registration to read:

```python
from .routers import config, health, members, users
```

```python
app.include_router(health.router)
app.include_router(users.router)
app.include_router(members.router)
app.include_router(config.router)
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pytest tests/test_config.py -v
```
Expected: PASS (4 passed)

- [ ] **Step 6: Run the full backend suite**

```bash
pytest -v
```
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/config.py backend/app/main.py backend/tests/test_config.py
git commit -m "feat: add GET /config and PUT /config endpoints"
```

---

### Task 11: `POST /members/{member_id}/shares` — purchase shares endpoint

This is the only endpoint that touches both the Members and Config tables. `share_value_at_purchase` is snapshotted from `Config.share_value` at the moment of purchase (matching design doc §10: every consuming entity snapshots the value it used at the time, since `Config` holds current values only). `cycle_id` is always `None` for now — there is no Cycle entity yet (that's Plan 5); this is a deliberate, documented gap, not an oversight.

**Files:**
- Modify: `backend/app/routers/members.py`
- Modify: `backend/tests/test_members.py`

- [ ] **Step 1: Write the failing tests** — append to `backend/tests/test_members.py`:

```python
def test_purchase_shares_updates_totals_and_history(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table
):
    from app.db import put_config, put_member
    from app.models.config import Config
    from app.models.member import Member

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

    assert response.status_code == 200
    body = response.json()
    assert body["current_shares"] == 2
    assert body["current_capital_amount"] == 1000
    assert len(body["share_history"]) == 1
    assert body["share_history"][0]["share_value_at_purchase"] == 500
    assert body["share_history"][0]["cycle_id"] is None


def test_purchase_shares_rejects_when_exceeding_cap(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table
):
    from app.db import put_config, put_member
    from app.models.config import Config
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15", current_shares=4,
        )
    )
    put_config(Config(share_value=500, max_shares_per_member=5))
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/members/mem-1/shares", json={"shares_purchased": 2})

    assert response.status_code == 400


def test_purchase_shares_rejects_when_share_value_not_configured(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table
):
    from app.db import put_member
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
        )
    )
    admin = User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True)
    put_user(admin)
    app.dependency_overrides[get_current_user_id] = lambda: "admin-1"

    response = client.post("/members/mem-1/shares", json={"shares_purchased": 2})

    assert response.status_code == 400


def test_purchase_shares_rejects_non_positive_amount(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table
):
    from app.db import put_config, put_member
    from app.models.config import Config
    from app.models.member import Member

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

    response = client.post("/members/mem-1/shares", json={"shares_purchased": 0})

    assert response.status_code == 422


def test_purchase_shares_rejected_for_non_administrator(
    client, dynamodb_users_table, dynamodb_members_table, dynamodb_config_table
):
    from app.db import put_member
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
        )
    )
    board_member = User(user_id="board-1", email="board@boombayan.org", is_administrator=False)
    put_user(board_member)
    app.dependency_overrides[get_current_user_id] = lambda: "board-1"

    response = client.post("/members/mem-1/shares", json={"shares_purchased": 2})

    assert response.status_code == 403
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_members.py -v
```
Expected: FAIL with `404` (no `POST /members/{member_id}/shares` route exists yet).

- [ ] **Step 3: Add the route** — append to `backend/app/routers/members.py`:

```python
@router.post("/members/{member_id}/shares", response_model=Member)
def purchase_shares(
    member_id: str, body: PurchaseSharesRequest, user: User = Depends(require_admin)
) -> Member:
    member = get_member_by_id(member_id)
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")

    config = get_config()
    if config.share_value <= 0:
        raise HTTPException(status_code=400, detail="Share value has not been configured yet")

    new_total_shares = member.current_shares + body.shares_purchased
    if new_total_shares > config.max_shares_per_member:
        raise HTTPException(
            status_code=400,
            detail=f"Purchase would exceed the maximum of {config.max_shares_per_member} shares per member",
        )

    amount_paid = body.shares_purchased * config.share_value
    member.share_history.append(
        ShareHistoryEntry(
            cycle_id=None,
            shares_purchased=body.shares_purchased,
            share_value_at_purchase=config.share_value,
            amount_paid=amount_paid,
            date=date.today().isoformat(),
        )
    )
    member.current_shares = new_total_shares
    member.current_capital_amount += amount_paid
    put_member(member)
    return member
```

Update the top-of-file imports to add `get_config` and the new model types:

```python
from datetime import date
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, require_admin
from ..db import get_config, get_member_by_id, list_members, put_member
from ..models.member import (
    CreateMemberRequest,
    Member,
    MemberStatus,
    PurchaseSharesRequest,
    ShareHistoryEntry,
    UpdateMemberRequest,
)
from ..models.user import User

router = APIRouter()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_members.py -v
```
Expected: PASS (14 passed)

- [ ] **Step 5: Run the full backend suite**

```bash
pytest -v
```
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/members.py backend/tests/test_members.py
git commit -m "feat: add POST /members/{member_id}/shares purchase endpoint"
```

---

### Task 12: Deploy updated backend to AWS

**Files:** none (deploy + verify only).

- [ ] **Step 1: Run the full backend suite one last time before deploying**

```bash
cd backend && source .venv/bin/activate && pytest -v && cd ..
```
Expected: all tests PASS.

- [ ] **Step 2: Deploy**

```bash
cd infra && npx serverless deploy && cd ..
```
Expected: deploy succeeds; output ends with an `endpoints:` section.

- [ ] **Step 3: Verify the Members table is still healthy**

```bash
aws dynamodb describe-table --table-name boombayan-api-dev-members --query 'Table.TableStatus'
```
Expected: `"ACTIVE"`.

- [ ] **Step 4: Verify the deployed health endpoint still responds**

```bash
curl https://<id>.execute-api.us-east-1.amazonaws.com/health
```
Expected: `{"status":"ok"}`

No commit for this task — it's a deploy of work already committed in Tasks 1-11.

---

### Task 13: Shared API types and the Members list page

**Files:**
- Create: `frontend/src/api/types.ts`
- Create: `frontend/src/pages/MembersPage.tsx`
- Test: `frontend/src/pages/MembersPage.test.tsx`

- [ ] **Step 1: Write `frontend/src/api/types.ts`** (no test — type-only file, nothing to assert at runtime; `tsc -b` catches type errors)

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
}
```

- [ ] **Step 2: Write the failing test** — `frontend/src/pages/MembersPage.test.tsx`

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { MembersPage } from './MembersPage'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

describe('MembersPage', () => {
  it('shows the list of members after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue([
      {
        member_id: 'mem-1',
        first_name: 'Ana',
        last_name: 'Reyes',
        email: 'ana@example.com',
        phone: '1',
        date_joined: '2026-01-15',
        status: 'Active',
        current_shares: 2,
        current_capital_amount: 1000,
        share_history: [],
      },
    ])

    render(
      <MemoryRouter>
        <MembersPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Ana Reyes')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Add member' })).toHaveAttribute('href', '/members/new')
  })

  it('shows an error message when the members fetch fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    render(
      <MemoryRouter>
        <MembersPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load members.')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/MembersPage.test.tsx
```
Expected: FAIL — `Failed to resolve import "./MembersPage"`

- [ ] **Step 4: Write `frontend/src/pages/MembersPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Member } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export function MembersPage() {
  const { idToken } = useAuth()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!idToken) return
    let cancelled = false
    apiFetch<Member[]>('/members', idToken)
      .then((data) => {
        if (!cancelled) setMembers(data)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load members.')
      })
    return () => {
      cancelled = true
    }
  }, [idToken])

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!members) {
    return <p>Loading...</p>
  }

  return (
    <div>
      <h1>Members</h1>
      <Link to="/members/new">Add member</Link>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Shares</th>
            <th>Capital</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.member_id}>
              <td>
                <Link to={`/members/${member.member_id}`}>
                  {member.first_name} {member.last_name}
                </Link>
              </td>
              <td>{member.status}</td>
              <td>{member.current_shares}</td>
              <td>{member.current_capital_amount}</td>
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
npx vitest run src/pages/MembersPage.test.tsx
```
Expected: PASS (2 passed)

- [ ] **Step 6: Commit**

```bash
cd ..
git add frontend/src/api/types.ts frontend/src/pages/MembersPage.tsx frontend/src/pages/MembersPage.test.tsx
git commit -m "feat: add Members list page"
```

---

### Task 14: Add Member page

**Files:**
- Create: `frontend/src/pages/AddMemberPage.tsx`
- Test: `frontend/src/pages/AddMemberPage.test.tsx`

- [ ] **Step 1: Write the failing test** — `frontend/src/pages/AddMemberPage.test.tsx`

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { AddMemberPage } from './AddMemberPage'

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

describe('AddMemberPage', () => {
  it('submits the form and navigates to the new member on success', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue({
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
    })

    render(
      <MemoryRouter>
        <AddMemberPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ana' } })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Reyes' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create member' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/members', 'fake-id-token', {
        method: 'POST',
        body: { first_name: 'Ana', last_name: 'Reyes', email: 'ana@example.com', phone: '1' },
      }),
    )
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/members/mem-1'))
  })

  it('shows an error message when member creation fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    render(
      <MemoryRouter>
        <AddMemberPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ana' } })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Reyes' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create member' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not create member.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/AddMemberPage.test.tsx
```
Expected: FAIL — `Failed to resolve import "./AddMemberPage"`

- [ ] **Step 3: Write `frontend/src/pages/AddMemberPage.tsx`**

```tsx
import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Member } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export function AddMemberPage() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { idToken } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!idToken) return
    setError(null)
    try {
      const member = await apiFetch<Member>('/members', idToken, {
        method: 'POST',
        body: { first_name: firstName, last_name: lastName, email, phone },
      })
      navigate(`/members/${member.member_id}`)
    } catch {
      setError('Could not create member.')
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Add member</h1>
      <label htmlFor="first-name">First name</label>
      <input id="first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
      <label htmlFor="last-name">Last name</label>
      <input id="last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
      <label htmlFor="email">Email</label>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <label htmlFor="phone">Phone</label>
      <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Create member</button>
    </form>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/pages/AddMemberPage.test.tsx
```
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
cd ..
git add frontend/src/pages/AddMemberPage.tsx frontend/src/pages/AddMemberPage.test.tsx
git commit -m "feat: add Add Member page"
```

---

### Task 15: Member detail page

**Files:**
- Create: `frontend/src/pages/MemberDetailPage.tsx`
- Test: `frontend/src/pages/MemberDetailPage.test.tsx`

- [ ] **Step 1: Write the failing test** — `frontend/src/pages/MemberDetailPage.test.tsx`

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { MemberDetailPage } from './MemberDetailPage'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

function renderAtMember(memberId: string) {
  return render(
    <MemoryRouter initialEntries={[`/members/${memberId}`]}>
      <Routes>
        <Route path="/members/:memberId" element={<MemberDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MemberDetailPage', () => {
  it('shows member details and share history after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue({
      member_id: 'mem-1',
      first_name: 'Ana',
      last_name: 'Reyes',
      email: 'ana@example.com',
      phone: '1',
      date_joined: '2026-01-15',
      status: 'Active',
      current_shares: 2,
      current_capital_amount: 1000,
      share_history: [
        { cycle_id: null, shares_purchased: 2, share_value_at_purchase: 500, amount_paid: 1000, date: '2026-02-01' },
      ],
    })

    renderAtMember('mem-1')

    await waitFor(() => expect(screen.getByText('Ana Reyes')).toBeInTheDocument())
    expect(apiFetch).toHaveBeenCalledWith('/members/mem-1', 'fake-id-token')
    expect(screen.getByText('2026-02-01')).toBeInTheDocument()
  })

  it('shows an error message when the member fetch fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    renderAtMember('mem-1')

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this member.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/MemberDetailPage.test.tsx
```
Expected: FAIL — `Failed to resolve import "./MemberDetailPage"`

- [ ] **Step 3: Write `frontend/src/pages/MemberDetailPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Member } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export function MemberDetailPage() {
  const { memberId } = useParams<{ memberId: string }>()
  const { idToken } = useAuth()
  const [member, setMember] = useState<Member | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!idToken || !memberId) return
    let cancelled = false
    apiFetch<Member>(`/members/${memberId}`, idToken)
      .then((data) => {
        if (!cancelled) setMember(data)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this member.')
      })
    return () => {
      cancelled = true
    }
  }, [idToken, memberId])

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!member) {
    return <p>Loading...</p>
  }

  return (
    <div>
      <h1>{member.first_name} {member.last_name}</h1>
      <p>Status: {member.status}</p>
      <p>Email: {member.email}</p>
      <p>Phone: {member.phone}</p>
      <p>Current shares: {member.current_shares}</p>
      <p>Current capital: {member.current_capital_amount}</p>
      <h2>Share history</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Shares purchased</th>
            <th>Share value</th>
            <th>Amount paid</th>
          </tr>
        </thead>
        <tbody>
          {member.share_history.map((entry, index) => (
            <tr key={index}>
              <td>{entry.date}</td>
              <td>{entry.shares_purchased}</td>
              <td>{entry.share_value_at_purchase}</td>
              <td>{entry.amount_paid}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/pages/MemberDetailPage.test.tsx
```
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
cd ..
git add frontend/src/pages/MemberDetailPage.tsx frontend/src/pages/MemberDetailPage.test.tsx
git commit -m "feat: add Member detail page"
```

---

### Task 16: Purchase Shares form

Adds the share-purchase form to the bottom of the page built in Task 15, and updates the displayed totals/history in place from the response (no full page refetch needed).

**Files:**
- Modify: `frontend/src/pages/MemberDetailPage.tsx`
- Modify: `frontend/src/pages/MemberDetailPage.test.tsx`

- [ ] **Step 1: Write the failing tests** — append to `frontend/src/pages/MemberDetailPage.test.tsx` (add `fireEvent` to the existing `@testing-library/react` import line):

```tsx
it('submits a share purchase and updates the displayed totals', async () => {
  vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
  vi.mocked(apiFetch).mockResolvedValueOnce({
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
  })

  renderAtMember('mem-1')
  await waitFor(() => expect(screen.getByText('Ana Reyes')).toBeInTheDocument())

  vi.mocked(apiFetch).mockResolvedValueOnce({
    member_id: 'mem-1',
    first_name: 'Ana',
    last_name: 'Reyes',
    email: 'ana@example.com',
    phone: '1',
    date_joined: '2026-01-15',
    status: 'Active',
    current_shares: 2,
    current_capital_amount: 1000,
    share_history: [
      { cycle_id: null, shares_purchased: 2, share_value_at_purchase: 500, amount_paid: 1000, date: '2026-02-01' },
    ],
  })

  fireEvent.change(screen.getByLabelText('Shares to purchase'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Purchase' }))

  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith('/members/mem-1/shares', 'fake-id-token', {
      method: 'POST',
      body: { shares_purchased: 2 },
    }),
  )
  await waitFor(() => expect(screen.getByText('2026-02-01')).toBeInTheDocument())
})

it('shows an error message when the share purchase fails', async () => {
  vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
  vi.mocked(apiFetch).mockResolvedValueOnce({
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
  })

  renderAtMember('mem-1')
  await waitFor(() => expect(screen.getByText('Ana Reyes')).toBeInTheDocument())

  vi.mocked(apiFetch).mockRejectedValueOnce(new Error('boom'))

  fireEvent.change(screen.getByLabelText('Shares to purchase'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Purchase' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('Could not record the share purchase.')
})
```

The test file's import line should now read:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/MemberDetailPage.test.tsx
```
Expected: FAIL — no element with label "Shares to purchase" or button "Purchase" exists yet.

- [ ] **Step 3: Add the purchase form** — modify `frontend/src/pages/MemberDetailPage.tsx` to read:

```tsx
import { FormEvent, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { Member } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export function MemberDetailPage() {
  const { memberId } = useParams<{ memberId: string }>()
  const { idToken } = useAuth()
  const [member, setMember] = useState<Member | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sharesToPurchase, setSharesToPurchase] = useState('')
  const [purchaseError, setPurchaseError] = useState<string | null>(null)

  useEffect(() => {
    if (!idToken || !memberId) return
    let cancelled = false
    apiFetch<Member>(`/members/${memberId}`, idToken)
      .then((data) => {
        if (!cancelled) setMember(data)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this member.')
      })
    return () => {
      cancelled = true
    }
  }, [idToken, memberId])

  async function handlePurchase(event: FormEvent) {
    event.preventDefault()
    if (!idToken || !memberId) return
    setPurchaseError(null)
    try {
      const updated = await apiFetch<Member>(`/members/${memberId}/shares`, idToken, {
        method: 'POST',
        body: { shares_purchased: Number(sharesToPurchase) },
      })
      setMember(updated)
      setSharesToPurchase('')
    } catch {
      setPurchaseError('Could not record the share purchase.')
    }
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!member) {
    return <p>Loading...</p>
  }

  return (
    <div>
      <h1>{member.first_name} {member.last_name}</h1>
      <p>Status: {member.status}</p>
      <p>Email: {member.email}</p>
      <p>Phone: {member.phone}</p>
      <p>Current shares: {member.current_shares}</p>
      <p>Current capital: {member.current_capital_amount}</p>
      <h2>Share history</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Shares purchased</th>
            <th>Share value</th>
            <th>Amount paid</th>
          </tr>
        </thead>
        <tbody>
          {member.share_history.map((entry, index) => (
            <tr key={index}>
              <td>{entry.date}</td>
              <td>{entry.shares_purchased}</td>
              <td>{entry.share_value_at_purchase}</td>
              <td>{entry.amount_paid}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Purchase shares</h2>
      <form onSubmit={handlePurchase}>
        <label htmlFor="shares-purchased">Shares to purchase</label>
        <input
          id="shares-purchased"
          type="number"
          min="1"
          value={sharesToPurchase}
          onChange={(e) => setSharesToPurchase(e.target.value)}
          required
        />
        {purchaseError && <p role="alert">{purchaseError}</p>}
        <button type="submit">Purchase</button>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/pages/MemberDetailPage.test.tsx
```
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
cd ..
git add frontend/src/pages/MemberDetailPage.tsx frontend/src/pages/MemberDetailPage.test.tsx
git commit -m "feat: add purchase shares form to Member detail page"
```

---

### Task 17: Settings page for Config

Admin-only in practice via the dashboard nav link added in Task 18 (which hides the link for non-administrators) and the backend's `require_admin` gate on `PUT /config` (Task 10) — the real authorization boundary. This page itself doesn't re-check the role client-side; a non-administrator who navigates here directly can view current values (`GET /config` is open to any authenticated user, matching the read access pattern used for Members) but a save attempt fails with the generic error message below, since `PUT /config` returns 403.

**Files:**
- Create: `frontend/src/pages/SettingsPage.tsx`
- Test: `frontend/src/pages/SettingsPage.test.tsx`

- [ ] **Step 1: Write the failing test** — `frontend/src/pages/SettingsPage.test.tsx`

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
    vi.mocked(apiFetch).mockResolvedValue({ share_value: 500, max_shares_per_member: 5 })

    render(<SettingsPage />)

    await waitFor(() => expect(screen.getByLabelText('Share value')).toHaveValue(500))
    expect(screen.getByLabelText('Max shares per member')).toHaveValue(5)
  })

  it('saves updated config values on submit', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValueOnce({ share_value: 500, max_shares_per_member: 5 })

    render(<SettingsPage />)
    await waitFor(() => expect(screen.getByLabelText('Share value')).toHaveValue(500))

    vi.mocked(apiFetch).mockResolvedValueOnce({ share_value: 600, max_shares_per_member: 5 })
    fireEvent.change(screen.getByLabelText('Share value'), { target: { value: '600' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/config', 'fake-id-token', {
        method: 'PUT',
        body: { share_value: 600, max_shares_per_member: 5 },
      }),
    )
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
  })

  it('shows an error message when saving fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValueOnce({ share_value: 500, max_shares_per_member: 5 })

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
Expected: FAIL — `Failed to resolve import "./SettingsPage"`

- [ ] **Step 3: Write `frontend/src/pages/SettingsPage.tsx`**

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
        body: { share_value: Number(shareValue), max_shares_per_member: Number(maxShares) },
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
git commit -m "feat: add Settings page for share value and share cap config"
```

---

### Task 18: Route wiring and dashboard navigation

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/pages/DashboardPage.test.tsx`

- [ ] **Step 1: Write the failing tests** — replace the full contents of `frontend/src/pages/DashboardPage.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { DashboardPage } from './DashboardPage'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

describe('DashboardPage', () => {
  it('shows the current user email, role, and navigation links after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue({
      user_id: 'abc123',
      email: 'board@boombayan.org',
      is_administrator: true,
      member_id: 'mem-1',
    })

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(screen.getByText('Welcome, board@boombayan.org')).toBeInTheDocument(),
    )
    expect(screen.getByText('Administrator')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('href', '/members')
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
  })

  it('hides the Settings link for non-administrators', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue({
      user_id: 'abc123',
      email: 'board@boombayan.org',
      is_administrator: false,
      member_id: 'mem-1',
    })

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(screen.getByText('Welcome, board@boombayan.org')).toBeInTheDocument(),
    )
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('shows an error message when the profile fetch fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your profile.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/DashboardPage.test.tsx
```
Expected: FAIL — `useHref() may be used only in the context of a <Router> component` (the existing component renders no `<Link>`, but more importantly the test now wraps in `MemoryRouter` ahead of adding them) and/or no "Members"/"Settings" links found.

- [ ] **Step 3: Add navigation links** — modify `frontend/src/pages/DashboardPage.tsx` to read:

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'

interface CurrentUser {
  user_id: string
  email: string
  is_administrator: boolean
  member_id: string | null
}

export function DashboardPage() {
  const { idToken, logout } = useAuth()
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!idToken) return
    let cancelled = false
    apiFetch<CurrentUser>('/me', idToken)
      .then((data) => {
        if (!cancelled) setUser(data)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your profile.')
      })
    return () => {
      cancelled = true
    }
  }, [idToken])

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!user) {
    return <p>Loading...</p>
  }

  return (
    <div>
      <h1>Welcome, {user.email}</h1>
      <p>{user.is_administrator ? 'Administrator' : 'Board Member'}</p>
      <nav>
        <Link to="/members">Members</Link>
        {user.is_administrator && <Link to="/settings">Settings</Link>}
      </nav>
      <button onClick={logout}>Log out</button>
    </div>
  )
}
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
import { LoginPage } from './pages/LoginPage'
import { MemberDetailPage } from './pages/MemberDetailPage'
import { MembersPage } from './pages/MembersPage'
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

(`/members/new` and `/members/:memberId` can be declared in either order — React Router v6 always ranks the static segment `new` above the dynamic `:memberId` param when matching, regardless of route declaration order.)

- [ ] **Step 6: Run the full frontend suite**

```bash
npx vitest run
```
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
cd ..
git add frontend/src/App.tsx frontend/src/pages/DashboardPage.tsx frontend/src/pages/DashboardPage.test.tsx
git commit -m "feat: wire up Members and Settings routes and dashboard navigation"
```

---

### Task 19: End-to-end manual verification

Real proof against the live deployed stack, no mocks — same philosophy as Plan 1's Task 18 ("a real end-to-end run against deployed infrastructure is not optional polish"). Uses the existing administrator account from Plan 1 (`michaelseno@gmail.com`, already `CONFIRMED`); there is no seeded non-administrator account, so this run only exercises the administrator path live. The non-administrator (403) paths are already covered by Tasks 6/7/8/10/11's backend tests.

**Execution note:** run via a scripted headless-Chromium (Playwright) session against `npm run dev`, same pattern as Plan 1's Task 18.

**Files:** none (manual verification only).

- [ ] **Step 1: Confirm `frontend/.env.local` still has real values** (unchanged since Plan 1 — `VITE_API_BASE_URL`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`)

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

Navigate to `http://localhost:5173/`, log in with `michaelseno@gmail.com` and the real password set during Plan 1's Task 18.
Expected: redirected to `/dashboard`, showing "Welcome, michaelseno@gmail.com", "Administrator", and both "Members" and "Settings" links.

- [ ] **Step 4: Configure share value and share cap**

Click "Settings". Set "Share value" to `500` and "Max shares per member" to `5`, click "Save".
Expected: "Settings saved." appears. Reload the page — both fields still show `500` and `5` (persisted, not just local state).

- [ ] **Step 5: Add a member**

Click "Members", then "Add member". Fill in a first name, last name, email, and phone, click "Create member".
Expected: redirected to `/members/<new-id>`, showing the entered name, "Status: Active", "Current shares: 0", "Current capital: 0", and an empty share history table.

- [ ] **Step 6: Purchase shares**

On the member's detail page, enter `2` in "Shares to purchase", click "Purchase".
Expected: "Current shares" updates to `2`, "Current capital" updates to `1000` (2 × 500), and the share history table shows one new row with today's date, `2` shares, share value `500`, amount paid `1000`.

- [ ] **Step 7: Verify the share cap is enforced**

Purchase `4` more shares (current total would become 6, exceeding the configured cap of 5).
Expected: "Could not record the share purchase." alert appears; "Current shares" stays at `2` (confirms the backend's cap check, Task 11, is wired through end-to-end, not just covered by mocked tests).

- [ ] **Step 8: Verify the Members list reflects the update**

Navigate back to "Members".
Expected: the member's row shows the updated share/capital totals from Step 6, and clicking the name navigates back to the same detail page.

- [ ] **Step 9: Verify the new routes are protected**

Click "Log out", then manually navigate the browser to `http://localhost:5173/members`.
Expected: redirected to `/login` (no idToken) — confirms `ProtectedRoute` covers the new routes, not just `/dashboard`.

- [ ] **Step 10: Stop the dev server**

```bash
# Ctrl+C in the terminal running npm run dev
cd ..
```

No commit for this task — it's verification of work already committed in Tasks 1-18.

---

### Task 20: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the "What's not here yet" section** — in `README.md`, replace:

```markdown
## What's not here yet

This is Plan 1 of a multi-plan project — auth and the board-member dashboard
shell only. Member management, the loan lifecycle, payments/penalties, and
cycle/dividend processing are designed but not yet built; see
`docs/superpowers/plans/` for the phase breakdown.
```

with:

```markdown
## Configuring share value and the share cap

Before any shares can be purchased, an administrator must set the share
value and the per-member share cap from the Settings page (`/settings`,
linked from the dashboard for administrators only). Purchasing shares
before this is configured fails with "Could not record the share
purchase." (the API's underlying error is "Share value has not been
configured yet.").

## What's not here yet

This is Plan 2 of a multi-plan project — auth, dashboard shell, and member/
share management. The loan lifecycle, payments/penalties, and cycle/dividend
processing are designed but not yet built; see `docs/superpowers/plans/` for
the phase breakdown.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document share value/cap configuration step"
```

---

## Plan Self-Review Notes

- **Spec coverage:** This plan implements design doc §4's `Members` table (all listed attributes: `FirstName`, `LastName`, `Email`, `Phone`, `DateJoined`, `Status`, `CurrentShares`, `CurrentCapitalAmount`, embedded `ShareHistory`) and the `ShareValue`/`MaxSharesPerMember` slice of `Config` (the only two `Config` fields any feature needs so far). §3's role model (`IsAdministrator` gating "managing members, shares") is now actually enforced via `require_admin`, not just stored.
- **Deliberately out of scope, carried to later plans:** `CycleId` on `ShareHistoryEntry` is always `None` — there is no Cycle entity until Plan 5, so there's nothing real to link to yet. `DefaultInterestRate`, `PenaltyRate`, `PenaltyGracePeriodHours`, `Top3BonusPercentage`, `Top3RankingWeights` (the rest of design doc §4's `Config` attributes) are not modeled — they belong to Plans 3-5's features and would be unused fields today (YAGNI). Member withdrawal *process* mechanics (beyond the bare `Status` field already supporting it) remain an open board decision per the design doc's §11, unchanged by this plan.
- **Frontend role-gating is backend-enforced, not UI-hidden everywhere:** the "Add member" link (`MembersPage`) and the Member edit/Settings-save actions are not conditionally hidden for non-administrators in the UI (only the dashboard's "Settings" nav link is, since that information — `is_administrator` — is already loaded there for the welcome banner). A non-administrator who navigates directly to `/members/new` or `/settings` can see the form but gets a generic "Could not create member."/"Could not save settings." on submit, because the backend's `require_admin` returns 403. This mirrors the existing codebase's generic-error-message style (`LoginPage`, `DashboardPage`) and was a deliberate scope cut — full per-page role-aware UI (e.g., disabling fields, a clearer "administrator access required" message) is a UX polish item, not a security gap, and can be added later without backend changes.
- **Type consistency check:** `Member`/`ShareHistoryEntry`/`Config` Pydantic field names (Task 5, Task 9) match the TypeScript interfaces in `frontend/src/api/types.ts` (Task 13) key-for-key, including snake_case (FastAPI serializes Python attribute names as-is). `PurchaseSharesRequest.shares_purchased` (backend) matches the `{ shares_purchased: number }` body sent by `MemberDetailPage`'s purchase form (Task 16). `UpdateConfigRequest`'s optional fields (backend) match `SettingsPage`'s always-both-fields PUT body (Task 17) — sending both fields every time is fine since `UpdateConfigRequest`'s partial-update semantics (Task 10) treat any present field as an intentional overwrite, which matches "save the whole form" UI semantics.
- **DynamoDB float-handling verified, not assumed:** confirmed directly against moto that `put_item` with a native Python `float` raises `TypeError: Float types are not supported. Use Decimal types instead.`, and that `Decimal(str(x))` round-trips correctly. Every numeric DynamoDB write in `db.py` (`CurrentCapitalAmount`, `ShareValueAtPurchase`, `AmountPaid`, `ShareValue`) goes through this conversion. This is the first numeric field Plan 1's `User`/`Config` tables never exercised (`IsAdministrator` is a bool), so it was verified empirically rather than carried over as an assumption.
- **Nested `mock_aws()` fixtures verified, not assumed:** tests needing more than one table (e.g., share purchase needs Members + Config) request multiple fixtures (`dynamodb_members_table`, `dynamodb_config_table`) simultaneously; confirmed directly that nested `with mock_aws():` blocks share visible state correctly (a table created in an outer block stays visible inside a nested one, and survives after the inner one exits).
- **Member email/phone have no format validation:** matches the design doc, which doesn't call for uniqueness or format constraints on these fields, and avoids pulling in `pydantic[email]`'s `email-validator` dependency for a single field with no stated business requirement behind it. Revisit only if a real data-quality problem shows up in practice.
- **`AmountPaid` is always computed, never accepted as input:** `shares_purchased × share_value_at_purchase`, with no path for a partial or rounded payment amount. Matches the design's "shares are bought outright" framing (no installment plans mentioned anywhere in §4 or its assumptions); flag this assumption if the board ever wants partial-payment share purchases.
- **`date_joined` defaults to today server-side, not client-side:** mirrors design doc §6's `PaymentDate` precedent ("defaults to today, editable for backdated entries") for consistency, even though `CreateMemberRequest.date_joined` is optional and the Add Member form doesn't expose a date picker yet (admins entering a backdated join date would need to use the API directly until a later plan adds that field to the form — a minor, deliberately deferred UI gap, not a data-model limitation).

