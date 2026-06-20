# Infrastructure & Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo, deploy a minimal FastAPI backend to AWS Lambda via Serverless Framework with Cognito auth and a Users/Config DynamoDB table, and get a logged-in user viewing an empty authenticated dashboard shell in the React frontend.

**Architecture:** FastAPI app wrapped by Mangum for Lambda, deployed via Serverless Framework behind API Gateway HTTP API. Cognito User Pool handles credentials; the backend verifies JWTs on every request. React+Vite+TS SPA authenticates directly against Cognito (no hosted UI), stores the JWT, and calls the API.

**Tech Stack:** Python 3.12, FastAPI, Mangum, boto3, PyJWT, pytest, moto (AWS mocking); Node 20, React 18, Vite 5, TypeScript 5, react-router-dom, amazon-cognito-identity-js; Serverless Framework v3, AWS Lambda, API Gateway HTTP API, DynamoDB, Cognito.

**File structure this plan creates:**
```
boombayan_project/
  backend/
    app/
      __init__.py
      main.py            # FastAPI app + route registration
      handler.py         # Mangum Lambda handler
      config.py          # Settings from env vars
      db.py              # boto3 DynamoDB resource helpers
      auth.py            # Cognito JWT verification dependency
      models/
        __init__.py
        user.py          # User Pydantic models
      routers/
        __init__.py
        health.py
        users.py
    tests/
      conftest.py
      test_health.py
      test_handler.py
      test_db.py
      test_auth.py
      test_users.py
      test_seed_admin.py
    scripts/
      seed_admin.py      # creates first Cognito + Users-table admin
    pyproject.toml
    requirements.txt
    requirements-dev.txt
  frontend/
    package.json
    vite.config.ts
    tsconfig.json
    index.html
    src/
      main.tsx
      App.tsx
      App.test.tsx
      vite-env.d.ts
      setupTests.ts
      auth/
        cognito.ts
        cognito.test.ts
        AuthContext.tsx
        AuthContext.test.tsx
      components/
        ProtectedRoute.tsx
        ProtectedRoute.test.tsx
      pages/
        LoginPage.tsx
        LoginPage.test.tsx
        DashboardPage.tsx
        DashboardPage.test.tsx
      api/
        client.ts
        client.test.ts
    .env.local.example
  infra/
    serverless.yml
    package.json
  .gitignore
  README.md
```

---

### Task 1: Repo scaffolding and Python project setup

**Files:**
- Create: `.gitignore`
- Create: `backend/pyproject.toml`
- Create: `backend/requirements.txt`
- Create: `backend/requirements-dev.txt`
- Create: `backend/app/__init__.py`

- [x] **Step 1: Create directory structure**

```bash
mkdir -p backend/app/models backend/app/routers backend/tests backend/scripts
touch backend/app/__init__.py backend/app/models/__init__.py backend/app/routers/__init__.py
touch backend/tests/__init__.py
```

- [x] **Step 2: Write `.gitignore`**

```
# Python
__pycache__/
*.pyc
.venv/
*.egg-info/
.pytest_cache/

# Node
node_modules/
dist/
.vite/

# Serverless
.serverless/

# Env
.env
.env.local

# OS
.DS_Store
```

- [x] **Step 3: Write `backend/pyproject.toml`**

```toml
[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

- [x] **Step 4: Write `backend/requirements.txt`**

```
fastapi==0.115.0
mangum==0.17.0
boto3==1.35.36
pyjwt[crypto]==2.9.0
pydantic==2.9.2
pydantic-settings==2.5.2
```

- [x] **Step 5: Write `backend/requirements-dev.txt`**

```
-r requirements.txt
pytest==8.3.3
httpx==0.27.2
moto[dynamodb,cognitoidp]==5.0.16
```

- [x] **Step 6: Create venv and install**

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cd ..
```

Expected: install completes with no errors.

- [x] **Step 7: Commit**

```bash
git add .gitignore backend/pyproject.toml backend/requirements.txt backend/requirements-dev.txt backend/app/__init__.py backend/app/models/__init__.py backend/app/routers/__init__.py backend/tests/__init__.py
git commit -m "chore: scaffold backend Python project"
```

---

### Task 2: Health check endpoint (FastAPI skeleton)

**Files:**
- Create: `backend/app/main.py`
- Create: `backend/app/routers/health.py`
- Create: `backend/tests/conftest.py`
- Test: `backend/tests/test_health.py`

- [x] **Step 1: Write the failing test** — `backend/tests/test_health.py`

```python
def test_health_returns_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [x] **Step 2: Write the test fixture** — `backend/tests/conftest.py`

```python
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)
```

- [x] **Step 3: Run test to verify it fails**

```bash
cd backend && source .venv/bin/activate && pytest tests/test_health.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'app.main'`

- [x] **Step 4: Write `backend/app/routers/health.py`**

```python
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [x] **Step 5: Write `backend/app/main.py`**

```python
from fastapi import FastAPI

from app.routers import health

app = FastAPI(title="Boombayan LMS API")
app.include_router(health.router)
```

- [x] **Step 6: Run test to verify it passes**

```bash
pytest tests/test_health.py -v
```
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add backend/app/main.py backend/app/routers/health.py backend/tests/conftest.py backend/tests/test_health.py
git commit -m "feat: add health check endpoint"
```

---

### Task 3: Mangum Lambda handler

**Files:**
- Create: `backend/app/handler.py`
- Test: `backend/tests/test_handler.py`

- [x] **Step 1: Write the failing test** — `backend/tests/test_handler.py`

```python
import json


def test_handler_invokes_health_route():
    from app.handler import handler

    event = {
        "version": "2.0",
        "routeKey": "GET /health",
        "rawPath": "/health",
        "rawQueryString": "",
        "headers": {},
        "requestContext": {
            # sourceIp is required: Mangum 0.17.0's HTTPGateway.scope does a
            # direct dict index on requestContext.http.sourceIp for v2.0
            # events (no .get() fallback) — omitting it raises KeyError.
            "http": {"method": "GET", "path": "/health", "sourceIp": "127.0.0.1"},
        },
        "isBase64Encoded": False,
    }
    response = handler(event, None)
    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == {"status": "ok"}
```

- [x] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_handler.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'app.handler'`

- [x] **Step 3: Write `backend/app/handler.py`**

```python
from mangum import Mangum

from app.main import app

handler = Mangum(app)
```

- [x] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_handler.py -v
```
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add backend/app/handler.py backend/tests/test_handler.py
git commit -m "feat: add Mangum Lambda handler"
```

---

### Task 4: Serverless Framework skeleton — deploy the health endpoint

**Files:**
- Create: `infra/package.json`
- Create: `infra/serverless.yml`

- [x] **Step 1: Write `infra/package.json`**

```json
{
  "name": "boombayan-infra",
  "version": "1.0.0",
  "private": true,
  "devDependencies": {
    "serverless": "^3.39.0",
    "serverless-python-requirements": "^6.1.1"
  }
}
```

- [x] **Step 2: Install infra dependencies**

```bash
cd infra && npm install && cd ..
```
Expected: installs with no errors, creates `infra/node_modules/` and `infra/package-lock.json`.

- [x] **Step 3: Write `infra/serverless.yml`**

```yaml
service: boombayan-api

frameworkVersion: '3'

provider:
  name: aws
  runtime: python3.12
  region: us-east-1
  stage: ${opt:stage, 'dev'}

package:
  patterns:
    - '!**'
    - '../backend/app/**'
    - '../backend/__init__.py'

custom:
  pythonRequirements:
    fileName: ../backend/requirements.txt
    dockerizePip: true

plugins:
  - serverless-python-requirements

functions:
  api:
    handler: backend.app.handler.handler
    events:
      - httpApi: '*'
```

Note: the handler path is `backend.app.handler.handler`, not `app.handler.handler`. Serverless Framework's `../` traversal patterns preserve the `backend/` path segment when copying files into the zip rather than flattening it, so the deployed code lands at `backend/app/...` inside the zip, not `app/...` at the zip root. The handler path (and the Python module path Lambda imports) must match that on-disk layout. This requires `backend/__init__.py` to exist (added in Task 4's actual commit) so `backend` is an explicit package, and `backend/app/handler.py`/`backend/app/main.py` use relative imports (`.main`, `.routers`) rather than `from app...` so the same module tree resolves under both `backend.app.*` (Lambda) and `app.*` (local pytest, via `pythonpath = ["."]` rooted at `backend/`). Separately, `dockerizePip` must be `true` (not `false`) because `pydantic` depends on the native `pydantic-core` extension; building it on a non-Linux host (e.g. macOS) produces a `darwin` `.so` that Lambda's Linux runtime cannot load, raising `No module named 'pydantic_core._pydantic_core'` at import time.

- [x] **Step 4: Configure AWS credentials (if not already done)**

```bash
aws sts get-caller-identity
```
Expected: returns your AWS account ID, user/role ARN. If this fails, run `aws configure` with credentials for an AWS account you control before continuing — every later step in this plan deploys real resources to that account.

- [x] **Step 5: Deploy**

```bash
cd infra && npx serverless deploy && cd ..
```
Expected: output ends with an `endpoints:` section showing something like `ANY - https://<id>.execute-api.us-east-1.amazonaws.com/{proxy+}`.

- [x] **Step 6: Verify the deployed health endpoint**

```bash
curl https://<id>.execute-api.us-east-1.amazonaws.com/health
```
(substitute the actual URL host from the deploy output, path `/health`)
Expected: `{"status":"ok"}`

- [x] **Step 7: Commit**

```bash
git add infra/package.json infra/package-lock.json infra/serverless.yml backend/__init__.py backend/app/handler.py backend/app/main.py
git commit -m "chore: deploy FastAPI health endpoint via Serverless Framework"
```
(`backend/__init__.py` is new, and `backend/app/handler.py`/`backend/app/main.py` change `from app...` imports to relative imports — both required for the `backend.app.handler.handler` path above to actually import correctly under Lambda; see the note after Step 3.)

---

### Task 5: Users and Config DynamoDB tables

**Files:**
- Modify: `infra/serverless.yml`

- [x] **Step 1: Add table resources and IAM permissions to `infra/serverless.yml`**

Replace the `provider:` block and everything below `package:` with:

```yaml
provider:
  name: aws
  runtime: python3.12
  region: us-east-1
  stage: ${opt:stage, 'dev'}
  environment:
    USERS_TABLE: ${self:service}-${sls:stage}-users
    CONFIG_TABLE: ${self:service}-${sls:stage}-config
  iam:
    role:
      statements:
        - Effect: Allow
          Action:
            - dynamodb:GetItem
            - dynamodb:PutItem
            - dynamodb:UpdateItem
            - dynamodb:DeleteItem
            - dynamodb:Query
            - dynamodb:Scan
          Resource:
            - !GetAtt UsersTable.Arn
            - !GetAtt ConfigTable.Arn

package:
  patterns:
    - '!**'
    - '../backend/app/**'
    - '../backend/__init__.py'

custom:
  pythonRequirements:
    fileName: ../backend/requirements.txt
    # true: pydantic-core (and other native deps) must be built as Linux
    # wheels via Docker, not macOS wheels — see Task 4's note.
    dockerizePip: true

plugins:
  - serverless-python-requirements

functions:
  api:
    handler: backend.app.handler.handler
    events:
      - httpApi: '*'

resources:
  Resources:
    UsersTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:provider.environment.USERS_TABLE}
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: UserId
            AttributeType: S
        KeySchema:
          - AttributeName: UserId
            KeyType: HASH

    ConfigTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:provider.environment.CONFIG_TABLE}
        BillingMode: PAY_PER_REQUEST
        AttributeDefinitions:
          - AttributeName: ConfigKey
            AttributeType: S
        KeySchema:
          - AttributeName: ConfigKey
            KeyType: HASH
```

This carries forward all three fixes from Task 4 (`backend.app.handler.handler` handler path, the 3-entry `package.patterns` including `../backend/__init__.py`, and `dockerizePip: true`) — do not revert to the original 2-entry pattern / `app.handler.handler` / `dockerizePip: false` shown in earlier drafts of this task, or the deploy will regress to the bugs Task 4 already fixed and verified.

- [x] **Step 2: Deploy the updated stack**

```bash
cd infra && npx serverless deploy && cd ..
```
Expected: deploy succeeds; output still shows the API endpoint.

- [x] **Step 3: Verify the tables exist**

```bash
aws dynamodb describe-table --table-name boombayan-api-dev-users --query 'Table.TableStatus'
aws dynamodb describe-table --table-name boombayan-api-dev-config --query 'Table.TableStatus'
```
Expected: both print `"ACTIVE"`.

- [x] **Step 4: Commit**

```bash
git add infra/serverless.yml
git commit -m "feat: provision Users and Config DynamoDB tables"
```

---

### Task 6: Cognito User Pool

**Files:**
- Modify: `infra/serverless.yml`

- [x] **Step 1: Add `COGNITO_USER_POOL_ID`/`COGNITO_CLIENT_ID` env vars**

In `infra/serverless.yml`, under `provider.environment`, add two lines so the block reads:

```yaml
  environment:
    USERS_TABLE: ${self:service}-${sls:stage}-users
    CONFIG_TABLE: ${self:service}-${sls:stage}-config
    COGNITO_USER_POOL_ID: !Ref CognitoUserPool
    COGNITO_CLIENT_ID: !Ref CognitoUserPoolClient
```

- [x] **Step 2: Add the Cognito resources**

Under `resources.Resources`, after `ConfigTable`, add:

```yaml
    CognitoUserPool:
      Type: AWS::Cognito::UserPool
      Properties:
        UserPoolName: ${self:service}-${sls:stage}-users
        UsernameAttributes:
          - email
        AutoVerifiedAttributes:
          - email
        Policies:
          PasswordPolicy:
            MinimumLength: 10
            RequireUppercase: true
            RequireLowercase: true
            RequireNumbers: true
            RequireSymbols: false

    CognitoUserPoolClient:
      Type: AWS::Cognito::UserPoolClient
      Properties:
        ClientName: ${self:service}-${sls:stage}-web
        UserPoolId: !Ref CognitoUserPool
        # ALLOW_USER_SRP_AUTH, not ALLOW_USER_PASSWORD_AUTH: Task 18's real
        # login test found amazon-cognito-identity-js's
        # CognitoUser.authenticateUser() always performs SRP internally -
        # it has no plain-password mode - so the client must allow the SRP
        # flow or every login fails with InvalidParameterException. SRP is
        # also strictly more secure (password never transmitted).
        ExplicitAuthFlows:
          - ALLOW_USER_SRP_AUTH
          - ALLOW_REFRESH_TOKEN_AUTH
        GenerateSecret: false
```

- [x] **Step 3: Add stack outputs so the IDs are easy to read after deploy**

Outputs are a sibling of `Resources` under the top-level `resources:` key (not a resource themselves). In `infra/serverless.yml`, change:

```yaml
resources:
  Resources:
    UsersTable:
      ...
    ConfigTable:
      ...
    CognitoUserPool:
      ...
    CognitoUserPoolClient:
      ...
```

to add an `Outputs:` sibling block after `Resources:` (keep all the existing resource definitions exactly as they are — only adding the new block below them, at the same indentation level as `Resources:`):

```yaml
  Outputs:
    UserPoolId:
      Value: !Ref CognitoUserPool
    UserPoolClientId:
      Value: !Ref CognitoUserPoolClient
```

- [x] **Step 4: Deploy**

```bash
cd infra && npx serverless deploy && cd ..
```
Expected: deploy succeeds; output includes a `Stack Outputs:` section listing `UserPoolId` and `UserPoolClientId` values — copy both down, they're needed for the seed script (Task 10) and the frontend (Task 12).

- [x] **Step 5: Commit**

```bash
git add infra/serverless.yml
git commit -m "feat: provision Cognito User Pool for authentication"
```

---

### Task 7: User model and DynamoDB repository functions

**Files:**
- Create: `backend/app/config.py`
- Create: `backend/app/db.py`
- Create: `backend/app/models/user.py`
- Test: `backend/tests/test_db.py`

- [x] **Step 1: Write `backend/app/config.py`**

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    users_table: str = "boombayan-api-dev-users"
    config_table: str = "boombayan-api-dev-config"
    cognito_user_pool_id: str = ""
    cognito_client_id: str = ""
    aws_region: str = "us-east-1"


settings = Settings()
```

- [x] **Step 2: Write `backend/app/models/user.py`**

```python
from pydantic import BaseModel


class User(BaseModel):
    user_id: str
    email: str
    is_administrator: bool = False
    member_id: str | None = None
```

- [x] **Step 3: Write the failing test** — `backend/tests/test_db.py`

```python
import boto3
import pytest
from moto import mock_aws


@pytest.fixture
def dynamodb_users_table(monkeypatch):
    # app/db.py creates its boto3 resource lazily (inside each function call,
    # not at module import time) specifically so this fixture can swap in a
    # moto-mocked AWS environment per-test without import-order issues.
    from app.config import settings

    monkeypatch.setattr(settings, "users_table", "test-users")

    with mock_aws():
        client = boto3.client("dynamodb", region_name="us-east-1")
        client.create_table(
            TableName="test-users",
            AttributeDefinitions=[{"AttributeName": "UserId", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "UserId", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield


def test_put_and_get_user_roundtrip(dynamodb_users_table):
    from app.db import get_user_by_id, put_user
    from app.models.user import User

    user = User(user_id="abc123", email="board@boombayan.org", is_administrator=True, member_id="mem-1")
    put_user(user)

    fetched = get_user_by_id("abc123")
    assert fetched == user


def test_get_user_by_id_returns_none_when_missing(dynamodb_users_table):
    from app.db import get_user_by_id

    assert get_user_by_id("does-not-exist") is None
```

- [x] **Step 4: Run test to verify it fails**

```bash
pytest tests/test_db.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'app.db'`

- [x] **Step 5: Write `backend/app/db.py`**

```python
import boto3

from .config import settings
from .models.user import User


def _dynamodb():
    # Created fresh on every call (not cached at module scope) so tests can
    # activate moto's mock_aws() before any AWS client/resource is constructed.
    return boto3.resource("dynamodb", region_name=settings.aws_region)


def get_users_table():
    return _dynamodb().Table(settings.users_table)


def get_config_table():
    return _dynamodb().Table(settings.config_table)


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
```

Note: `db.py` uses relative imports (`.config`, `.models.user`), not `from app...`. This is an import convention that applies to every file under `backend/app/` from here on (it does NOT apply to test files in `backend/tests/`, which keep using absolute `from app...` imports as already written, since tests run locally via pytest's `pythonpath = ["."]` rooted at `backend/`, never through Lambda). Reason: Task 4 found that Serverless Framework's packaging preserves a `backend/` prefix in the deployed zip, so Lambda imports this code as `backend.app.*`, not `app.*`. Relative imports resolve correctly under both names; absolute `from app...` imports inside `backend/app/**` would work locally but throw `ModuleNotFoundError: No module named 'app'` once deployed. Every later task that adds a file under `backend/app/` (Tasks 8 and 9 below) follows this same convention — their code blocks already reflect it.

- [x] **Step 6: Run test to verify it passes**

```bash
pytest tests/test_db.py -v
```
Expected: PASS (2 passed)

- [x] **Step 7: Commit**

```bash
git add backend/app/config.py backend/app/db.py backend/app/models/user.py backend/tests/test_db.py
git commit -m "feat: add User model and DynamoDB repository functions"
```

---

### Task 8: Cognito JWT verification dependency

**Files:**
- Create: `backend/app/auth.py`
- Test: `backend/tests/test_auth.py`

- [x] **Step 1: Write the failing test** — `backend/tests/test_auth.py`

```python
import jwt
import pytest
from fastapi import HTTPException

from app.auth import get_current_user_id


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
```

- [x] **Step 2: Run test to verify it fails**

```bash
pytest tests/test_auth.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'app.auth'`

- [x] **Step 3: Write `backend/app/auth.py`**

```python
import jwt
from fastapi import Header, HTTPException

from .config import settings

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
```

(Relative import — `.config`, not `app.config` — per the convention established in Task 7.)

- [x] **Step 4: Run test to verify it passes**

```bash
pytest tests/test_auth.py -v
```
Expected: PASS (3 passed)

- [x] **Step 5: Commit**

```bash
git add backend/app/auth.py backend/tests/test_auth.py
git commit -m "feat: add Cognito JWT verification dependency"
```

---

### Task 9: GET /me endpoint

**Files:**
- Create: `backend/app/routers/users.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/conftest.py`
- Modify: `backend/tests/test_db.py`
- Test: `backend/tests/test_users.py`

- [x] **Step 1: Move the moto fixture into `conftest.py` so both test files can use it**

Replace the full contents of `backend/tests/conftest.py` with:

```python
import boto3
import pytest
from fastapi.testclient import TestClient
from moto import mock_aws

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def dynamodb_users_table(monkeypatch):
    # app/db.py creates its boto3 resource lazily (inside each function call,
    # not at module import time) specifically so this fixture can swap in a
    # moto-mocked AWS environment per-test without import-order issues.
    from app.config import settings

    monkeypatch.setattr(settings, "users_table", "test-users")

    with mock_aws():
        dynamo_client = boto3.client("dynamodb", region_name="us-east-1")
        dynamo_client.create_table(
            TableName="test-users",
            AttributeDefinitions=[{"AttributeName": "UserId", "AttributeType": "S"}],
            KeySchema=[{"AttributeName": "UserId", "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield
```

- [x] **Step 2: Remove the now-duplicated fixture from `test_db.py`**

Replace the full contents of `backend/tests/test_db.py` with:

```python
def test_put_and_get_user_roundtrip(dynamodb_users_table):
    from app.db import get_user_by_id, put_user
    from app.models.user import User

    user = User(user_id="abc123", email="board@boombayan.org", is_administrator=True, member_id="mem-1")
    put_user(user)

    fetched = get_user_by_id("abc123")
    assert fetched == user


def test_get_user_by_id_returns_none_when_missing(dynamodb_users_table):
    from app.db import get_user_by_id

    assert get_user_by_id("does-not-exist") is None
```

- [x] **Step 3: Run the full suite to confirm the refactor didn't break anything**

```bash
pytest -v
```
Expected: all previously-passing tests still PASS.

- [x] **Step 4: Write the failing test** — `backend/tests/test_users.py`

```python
from app.auth import get_current_user_id
from app.db import put_user
from app.main import app
from app.models.user import User


def test_get_me_returns_current_user(client, dynamodb_users_table):
    user = User(user_id="abc123", email="board@boombayan.org", is_administrator=True, member_id="mem-1")
    put_user(user)
    app.dependency_overrides[get_current_user_id] = lambda: "abc123"

    response = client.get("/me")

    del app.dependency_overrides[get_current_user_id]
    assert response.status_code == 200
    assert response.json() == {
        "user_id": "abc123",
        "email": "board@boombayan.org",
        "is_administrator": True,
        "member_id": "mem-1",
    }


def test_get_me_returns_404_when_user_record_missing(client, dynamodb_users_table):
    app.dependency_overrides[get_current_user_id] = lambda: "no-such-user"

    response = client.get("/me")

    del app.dependency_overrides[get_current_user_id]
    assert response.status_code == 404
```

- [x] **Step 5: Run test to verify it fails**

```bash
pytest tests/test_users.py -v
```
Expected: FAIL with `404` for the first test (route doesn't exist yet, returns FastAPI's default 404) or `ModuleNotFoundError` if the router import path is wrong — either way, both tests fail before implementation.

- [x] **Step 6: Write `backend/app/routers/users.py`**

```python
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
```

(Relative imports — `..auth`, `..db`, `..models.user` — per the convention established in Task 7: two dots since this file is in `app/routers/`, one level deeper than `auth.py`/`db.py`.)

- [x] **Step 7: Register the router** — modify `backend/app/main.py` to read:

```python
from fastapi import FastAPI

from .routers import health, users

app = FastAPI(title="Boombayan LMS API")
app.include_router(health.router)
app.include_router(users.router)
```

- [x] **Step 8: Run test to verify it passes**

```bash
pytest tests/test_users.py -v
```
Expected: PASS (2 passed)

- [x] **Step 9: Commit**

```bash
git add backend/app/routers/users.py backend/app/main.py backend/tests/conftest.py backend/tests/test_db.py backend/tests/test_users.py
git commit -m "feat: add GET /me endpoint"
```

---

### Task 10: Seed script for the first admin user

There's no self-registration in this system (§15 of the BRD), so the very first board administrator account has to be created manually — this script creates both the Cognito login and the matching Users-table record in one step.

**Files:**
- Create: `backend/scripts/__init__.py`
- Create: `backend/scripts/seed_admin.py`
- Test: `backend/tests/test_seed_admin.py`

- [x] **Step 1: Create `backend/scripts/__init__.py`** (empty file)

This makes `scripts` an explicit package. It's required for Step 7 below to work: running this script directly as `python scripts/seed_admin.py` would put `backend/scripts/` (not `backend/`) at the front of `sys.path` (Python sets `sys.path[0]` to the invoked script's own directory), so `from app.config import settings` inside it would fail with `ModuleNotFoundError: No module named 'app'`. Step 7 instead invokes it as `python -m scripts.seed_admin`, which puts the current directory (`backend/`) on `sys.path` — but `-m` requires `scripts` to be an importable package, hence this file. (Pytest doesn't hit this problem — pytest's own import mechanism plus `pythonpath = ["."]` in `pyproject.toml` already puts `backend/` on the path regardless of how the script is invoked, which is why this gap wasn't caught until Step 7.)

- [x] **Step 2: Write the failing test** — `backend/tests/test_seed_admin.py`

```python
import sys

import boto3
import pytest
from moto import mock_aws


@pytest.fixture
def cognito_user_pool(monkeypatch):
    from app.config import settings

    with mock_aws():
        client = boto3.client("cognito-idp", region_name="us-east-1")
        pool = client.create_user_pool(PoolName="test-pool")
        pool_id = pool["UserPool"]["Id"]
        app_client = client.create_user_pool_client(UserPoolId=pool_id, ClientName="test-client")
        monkeypatch.setattr(settings, "cognito_user_pool_id", pool_id)
        monkeypatch.setattr(settings, "cognito_client_id", app_client["UserPoolClient"]["ClientId"])
        yield pool_id


def test_create_cognito_user_returns_sub(cognito_user_pool):
    from scripts.seed_admin import create_cognito_user

    user_id = create_cognito_user("board@boombayan.org", "TempPass123!")
    assert user_id


def test_create_cognito_user_leaves_force_change_password_status(cognito_user_pool):
    from scripts.seed_admin import create_cognito_user

    create_cognito_user("board@boombayan.org", "TempPass123!")

    client = boto3.client("cognito-idp", region_name="us-east-1")
    response = client.admin_get_user(UserPoolId=cognito_user_pool, Username="board@boombayan.org")
    assert response["UserStatus"] == "FORCE_CHANGE_PASSWORD"


def test_main_creates_cognito_user_and_users_table_record(
    cognito_user_pool, dynamodb_users_table, monkeypatch, capsys
):
    from app.db import get_users_table
    from scripts.seed_admin import main

    monkeypatch.setattr(
        sys,
        "argv",
        ["seed_admin.py", "--email", "board@boombayan.org", "--temporary-password", "TempPass123!"],
    )
    main()

    captured = capsys.readouterr()
    assert "Created admin user board@boombayan.org" in captured.out

    items = get_users_table().scan()["Items"]
    assert len(items) == 1
    assert items[0]["Email"] == "board@boombayan.org"
    assert items[0]["IsAdministrator"] is True
```

- [x] **Step 3: Run test to verify it fails**

```bash
pytest tests/test_seed_admin.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.seed_admin'`

- [x] **Step 4: Write `backend/scripts/seed_admin.py`**

```python
"""Creates the first board administrator: a Cognito user (with a temporary
password the board member must change on first login) plus a matching
Users-table record.

Usage (run from the backend/ directory, as a module so `app` is importable — see Step 1):
    python -m scripts.seed_admin --email board@boombayan.org --temporary-password 'TempPass123!'
"""

import argparse

import boto3

from app.config import settings
from app.db import put_user
from app.models.user import User


def create_cognito_user(email: str, temporary_password: str) -> str:
    client = boto3.client("cognito-idp", region_name=settings.aws_region)
    client.admin_create_user(
        UserPoolId=settings.cognito_user_pool_id,
        Username=email,
        UserAttributes=[
            {"Name": "email", "Value": email},
            {"Name": "email_verified", "Value": "true"},
        ],
        TemporaryPassword=temporary_password,
        MessageAction="SUPPRESS",
    )
    # Deliberately left in FORCE_CHANGE_PASSWORD state: the board member sets
    # their own permanent password on first login via Cognito's
    # NEW_PASSWORD_REQUIRED challenge (handled by the frontend's login()
    # function, Task 12, and LoginPage, Task 15). The admin running this
    # script never learns anyone's real password.
    response = client.admin_get_user(
        UserPoolId=settings.cognito_user_pool_id,
        Username=email,
    )
    return next(a["Value"] for a in response["UserAttributes"] if a["Name"] == "sub")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--temporary-password", required=True)
    args = parser.parse_args()

    user_id = create_cognito_user(args.email, args.temporary_password)
    put_user(User(user_id=user_id, email=args.email, is_administrator=True))
    print(f"Created admin user {args.email} with UserId {user_id}")


if __name__ == "__main__":
    main()
```

- [x] **Step 5: Run test to verify it passes**

```bash
pytest tests/test_seed_admin.py -v
```
Expected: PASS (3 passed)

- [x] **Step 6: Commit**

```bash
git add backend/scripts/__init__.py backend/scripts/seed_admin.py backend/tests/test_seed_admin.py
git commit -m "feat: add seed script for first admin user"
```

- [x] **Step 7: Run the script against the real deployed stack to create each board member's login**

Run as a module (`-m scripts.seed_admin`), not as a script path (`scripts/seed_admin.py`) — see Step 1's note for why. Use the venv's Python explicitly, not bare `python` (this shell's `python`/`pip` aliases bypass the venv — see Task 1's report). Run once per board member, with their real email and a temporary password you choose (meets the pool's policy: min 10 chars, upper+lower+number; symbols optional) — share the temporary password with them out-of-band; they'll be forced to set their own permanent password on first login (Task 12/15), so this temporary value is never their real password.

```bash
cd backend
USERS_TABLE=boombayan-api-dev-users \
COGNITO_USER_POOL_ID=<UserPoolId from Task 6 deploy output> \
COGNITO_CLIENT_ID=<UserPoolClientId from Task 6 deploy output> \
AWS_REGION=us-east-1 \
.venv/bin/python -m scripts.seed_admin --email <board-member-email> --temporary-password '<temporary-password>'
cd ..
```
Expected: prints `Created admin user <email> with UserId <uuid>`. The user is left in `FORCE_CHANGE_PASSWORD` status — confirm with `aws cognito-idp admin-get-user --user-pool-id <UserPoolId> --username <board-member-email> --query UserStatus`, expect `"FORCE_CHANGE_PASSWORD"`. This account cannot be used to log in for real until the frontend's new-password flow exists (Task 12/15) — that's expected at this point in the plan.

---

### Task 11: Frontend scaffold (Vite + React + TypeScript)

Config files are hand-written rather than generated via `npm create vite` so every file's content is exact and reproducible (the interactive scaffolder prompts for confirmation on non-empty directories, which doesn't work in a scripted plan).

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/setupTests.ts`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/main.tsx`
- Test: `frontend/src/App.test.tsx`

- [x] **Step 1: Write `frontend/package.json`**

```json
{
  "name": "boombayan-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.27.0",
    "amazon-cognito-identity-js": "^6.3.12"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.10",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.2",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.2",
    "vite": "^5.4.8",
    "vitest": "^2.1.2"
  }
}
```

- [x] **Step 2: Install dependencies**

```bash
cd frontend && npm install && cd ..
```
Expected: installs with no errors, creates `frontend/node_modules/` and `frontend/package-lock.json`.

- [x] **Step 3: Write `frontend/vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
  },
})
```

- [x] **Step 4: Write `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

- [x] **Step 5: Write `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Boombayan LMS</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [x] **Step 6: Write `frontend/src/setupTests.ts`**

```ts
import '@testing-library/jest-dom/vitest'
```

- [x] **Step 7: Write the failing test** — `frontend/src/App.test.tsx`

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the app name', () => {
    render(<App />)
    expect(screen.getByText('Boombayan LMS')).toBeInTheDocument()
  })
})
```

- [x] **Step 8: Run test to verify it fails**

```bash
cd frontend && npx vitest run
```
Expected: FAIL — `Failed to resolve import "./App"`

- [x] **Step 9: Write `frontend/src/App.tsx`**

```tsx
function App() {
  return <div>Boombayan LMS</div>
}

export default App
```

- [x] **Step 10: Write `frontend/src/main.tsx`**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

- [x] **Step 11: Run test to verify it passes**

```bash
npx vitest run
```
Expected: PASS (1 passed)

- [x] **Step 12: Verify the dev server boots**

```bash
npx vite --port 5173 &
sleep 2
curl -s http://localhost:5173 | grep -o '<title>.*</title>'
kill %1
cd ..
```
Expected: prints `<title>Boombayan LMS</title>`

- [x] **Step 13: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/tsconfig.json frontend/index.html frontend/src/setupTests.ts frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/main.tsx
git commit -m "chore: scaffold Vite + React + TypeScript frontend"
```

---

### Task 12: Cognito login client

**Files:**
- Create: `frontend/src/vite-env.d.ts`
- Create: `frontend/.env.local.example`
- Create: `frontend/src/auth/cognito.ts`
- Test: `frontend/src/auth/cognito.test.ts`

- [x] **Step 1: Write `frontend/src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COGNITO_USER_POOL_ID: string
  readonly VITE_COGNITO_CLIENT_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

- [x] **Step 2: Write `frontend/.env.local.example`**

```
VITE_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
```

Copy this to `frontend/.env.local` (already gitignored) and fill in the real `UserPoolId`/`UserPoolClientId` values from Task 6's deploy output.

- [x] **Step 3: Write the failing test** — `frontend/src/auth/cognito.test.ts`

`login()` returns a discriminated-union result rather than bare tokens, because Cognito can respond to a login attempt in two genuinely different ways: a normal success, or — for an account still on its admin-issued temporary password (Task 10) — a `NEW_PASSWORD_REQUIRED` challenge that must be completed before any tokens exist. Callers (Task 15's `LoginPage`) branch on `result.status`.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { login } from './cognito'

const authenticateUser = vi.fn()
const completeNewPasswordChallenge = vi.fn()

vi.mock('amazon-cognito-identity-js', () => ({
  CognitoUserPool: vi.fn(),
  CognitoUser: vi.fn().mockImplementation(() => ({ authenticateUser, completeNewPasswordChallenge })),
  AuthenticationDetails: vi.fn(),
}))

describe('login', () => {
  beforeEach(() => {
    authenticateUser.mockReset()
    completeNewPasswordChallenge.mockReset()
  })

  it('resolves with a success result containing tokens on successful authentication', async () => {
    authenticateUser.mockImplementation((_details, callbacks) => {
      callbacks.onSuccess({
        getIdToken: () => ({ getJwtToken: () => 'fake-id-token' }),
        getAccessToken: () => ({ getJwtToken: () => 'fake-access-token' }),
        getRefreshToken: () => ({ getToken: () => 'fake-refresh-token' }),
      })
    })

    const result = await login('board@boombayan.org', 'password123')
    expect(result).toEqual({
      status: 'success',
      tokens: {
        idToken: 'fake-id-token',
        accessToken: 'fake-access-token',
        refreshToken: 'fake-refresh-token',
      },
    })
  })

  it('rejects when authentication fails', async () => {
    authenticateUser.mockImplementation((_details, callbacks) => {
      callbacks.onFailure(new Error('Incorrect username or password.'))
    })

    await expect(login('board@boombayan.org', 'wrong-password')).rejects.toThrow(
      'Incorrect username or password.',
    )
  })

  it('resolves with a newPasswordRequired result that can complete the challenge', async () => {
    authenticateUser.mockImplementation((_details, callbacks) => {
      callbacks.newPasswordRequired({ email: 'board@boombayan.org' }, [])
    })
    completeNewPasswordChallenge.mockImplementation((_newPassword, _attrs, callbacks) => {
      callbacks.onSuccess({
        getIdToken: () => ({ getJwtToken: () => 'fake-id-token' }),
        getAccessToken: () => ({ getJwtToken: () => 'fake-access-token' }),
        getRefreshToken: () => ({ getToken: () => 'fake-refresh-token' }),
      })
    })

    const result = await login('board@boombayan.org', 'temp-password')
    expect(result.status).toBe('newPasswordRequired')
    if (result.status !== 'newPasswordRequired') throw new Error('expected newPasswordRequired')

    const tokens = await result.completeNewPassword('new-strong-password')
    expect(tokens).toEqual({
      idToken: 'fake-id-token',
      accessToken: 'fake-access-token',
      refreshToken: 'fake-refresh-token',
    })
    expect(completeNewPasswordChallenge).toHaveBeenCalledWith('new-strong-password', {}, expect.anything())
  })
})
```

- [x] **Step 4: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/auth/cognito.test.ts
```
Expected: FAIL — `Failed to resolve import "./cognito"`

- [x] **Step 5: Write `frontend/src/auth/cognito.ts`**

```ts
import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  CognitoUserSession,
} from 'amazon-cognito-identity-js'

export interface AuthTokens {
  idToken: string
  accessToken: string
  refreshToken: string
}

export type LoginResult =
  | { status: 'success'; tokens: AuthTokens }
  | { status: 'newPasswordRequired'; completeNewPassword: (newPassword: string) => Promise<AuthTokens> }

function getUserPool(): CognitoUserPool {
  return new CognitoUserPool({
    UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
    ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
  })
}

function tokensFromSession(session: CognitoUserSession): AuthTokens {
  return {
    idToken: session.getIdToken().getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
  }
}

export function login(email: string, password: string): Promise<LoginResult> {
  const userPool = getUserPool()
  const cognitoUser = new CognitoUser({ Username: email, Pool: userPool })
  const authDetails = new AuthenticationDetails({ Username: email, Password: password })

  return new Promise((resolve, reject) => {
    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => {
        resolve({ status: 'success', tokens: tokensFromSession(session) })
      },
      onFailure: (err) => reject(err),
      newPasswordRequired: () => {
        resolve({
          status: 'newPasswordRequired',
          completeNewPassword: (newPassword: string) =>
            new Promise((resolveChallenge, rejectChallenge) => {
              cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
                onSuccess: (session) => resolveChallenge(tokensFromSession(session)),
                onFailure: (err) => rejectChallenge(err),
              })
            }),
        })
      },
    })
  })
}
```

- [x] **Step 6: Run test to verify it passes**

```bash
npx vitest run src/auth/cognito.test.ts
```
Expected: PASS (3 passed)

- [x] **Step 7: Commit**

```bash
cd ..
git add frontend/src/vite-env.d.ts frontend/.env.local.example frontend/src/auth/cognito.ts frontend/src/auth/cognito.test.ts
git commit -m "feat: add Cognito login client"
```

---

### Task 13: AuthContext

**Files:**
- Create: `frontend/src/auth/AuthContext.tsx`
- Test: `frontend/src/auth/AuthContext.test.tsx`

- [x] **Step 1: Write the failing test** — `frontend/src/auth/AuthContext.test.tsx`

`login()` here mirrors `cognito.ts`'s `LoginResult` shape: it sets `idToken` immediately on a `success` result, but for `newPasswordRequired` it does NOT set anything — there are no tokens yet, only a challenge to complete. `setTokens()` is the method `LoginPage` (Task 15) calls once that challenge is completed.

```tsx
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'
import { login as cognitoLogin, LoginResult } from './cognito'

vi.mock('./cognito', () => ({
  login: vi.fn(),
}))

describe('AuthProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(cognitoLogin).mockReset()
  })

  it('starts with no idToken when localStorage is empty', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    expect(result.current.idToken).toBeNull()
  })

  it('sets idToken and persists it to localStorage after a successful login', async () => {
    vi.mocked(cognitoLogin).mockResolvedValue({
      status: 'success',
      tokens: {
        idToken: 'fake-id-token',
        accessToken: 'fake-access-token',
        refreshToken: 'fake-refresh-token',
      },
    })
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await act(async () => {
      await result.current.login('board@boombayan.org', 'password123')
    })

    expect(result.current.idToken).toBe('fake-id-token')
    expect(localStorage.getItem('boombayan.auth.idToken')).toBe('fake-id-token')
  })

  it('does not set idToken when login returns newPasswordRequired', async () => {
    vi.mocked(cognitoLogin).mockResolvedValue({
      status: 'newPasswordRequired',
      completeNewPassword: vi.fn(),
    })
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    let loginResult: LoginResult | undefined
    await act(async () => {
      loginResult = await result.current.login('board@boombayan.org', 'temp-password')
    })

    expect(loginResult?.status).toBe('newPasswordRequired')
    expect(result.current.idToken).toBeNull()
  })

  it('setTokens sets idToken and persists it to localStorage', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    act(() => {
      result.current.setTokens({
        idToken: 'fake-id-token',
        accessToken: 'fake-access-token',
        refreshToken: 'fake-refresh-token',
      })
    })

    expect(result.current.idToken).toBe('fake-id-token')
    expect(localStorage.getItem('boombayan.auth.idToken')).toBe('fake-id-token')
  })

  it('clears idToken and localStorage on logout', async () => {
    vi.mocked(cognitoLogin).mockResolvedValue({
      status: 'success',
      tokens: {
        idToken: 'fake-id-token',
        accessToken: 'fake-access-token',
        refreshToken: 'fake-refresh-token',
      },
    })
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await act(async () => {
      await result.current.login('board@boombayan.org', 'password123')
    })

    act(() => {
      result.current.logout()
    })

    expect(result.current.idToken).toBeNull()
    expect(localStorage.getItem('boombayan.auth.idToken')).toBeNull()
  })
})
```

`loginResult` is explicitly typed `LoginResult | undefined` rather than left for inference: it's declared outside the `act(async () => {...})` closure and only assigned inside it, which makes TypeScript infer `never` for it at the `loginResult?.status` usage site under `strict` mode — `vitest run` doesn't type-check so this wouldn't fail Step 4 below, but `npm run build` (`tsc -b`) would.

- [x] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/auth/AuthContext.test.tsx
```
Expected: FAIL — `Failed to resolve import "./AuthContext"`

- [x] **Step 3: Write `frontend/src/auth/AuthContext.tsx`**

```tsx
import { createContext, ReactNode, useContext, useEffect, useState } from 'react'
import { AuthTokens, LoginResult, login as cognitoLogin } from './cognito'

const STORAGE_KEY = 'boombayan.auth.idToken'

interface AuthContextValue {
  idToken: string | null
  login: (email: string, password: string) => Promise<LoginResult>
  setTokens: (tokens: AuthTokens) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [idToken, setIdToken] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  )

  useEffect(() => {
    if (idToken) {
      localStorage.setItem(STORAGE_KEY, idToken)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [idToken])

  async function login(email: string, password: string): Promise<LoginResult> {
    const result = await cognitoLogin(email, password)
    if (result.status === 'success') {
      setIdToken(result.tokens.idToken)
    }
    return result
  }

  function setTokens(tokens: AuthTokens) {
    setIdToken(tokens.idToken)
  }

  function logout() {
    setIdToken(null)
  }

  return (
    <AuthContext.Provider value={{ idToken, login, setTokens, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/auth/AuthContext.test.tsx
```
Expected: PASS (5 passed)

- [x] **Step 5: Commit**

```bash
cd ..
git add frontend/src/auth/AuthContext.tsx frontend/src/auth/AuthContext.test.tsx
git commit -m "feat: add AuthContext for session state"
```

---

### Task 14: ProtectedRoute

**Files:**
- Create: `frontend/src/components/ProtectedRoute.tsx`
- Test: `frontend/src/components/ProtectedRoute.test.tsx`

- [x] **Step 1: Write the failing test** — `frontend/src/components/ProtectedRoute.test.tsx`

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { useAuth } from '../auth/AuthContext'
import { ProtectedRoute } from './ProtectedRoute'

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

function renderWithRoutes(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<div>Dashboard Page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute', () => {
  it('redirects to /login when there is no idToken', () => {
    vi.mocked(useAuth).mockReturnValue({
      idToken: null,
      login: vi.fn(),
      setTokens: vi.fn(),
      logout: vi.fn(),
    })
    renderWithRoutes('/dashboard')
    expect(screen.getByText('Login Page')).toBeInTheDocument()
  })

  it('renders the nested route when idToken is present', () => {
    vi.mocked(useAuth).mockReturnValue({
      idToken: 'token',
      login: vi.fn(),
      setTokens: vi.fn(),
      logout: vi.fn(),
    })
    renderWithRoutes('/dashboard')
    expect(screen.getByText('Dashboard Page')).toBeInTheDocument()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/components/ProtectedRoute.test.tsx
```
Expected: FAIL — `Failed to resolve import "./ProtectedRoute"`

- [x] **Step 3: Write `frontend/src/components/ProtectedRoute.tsx`**

```tsx
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export function ProtectedRoute() {
  const { idToken } = useAuth()
  if (!idToken) {
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/components/ProtectedRoute.test.tsx
```
Expected: PASS (2 passed)

- [x] **Step 5: Commit**

```bash
cd ..
git add frontend/src/components/ProtectedRoute.tsx frontend/src/components/ProtectedRoute.test.tsx
git commit -m "feat: add ProtectedRoute guard"
```

---

### Task 15: LoginPage

**Files:**
- Create: `frontend/src/pages/LoginPage.tsx`
- Test: `frontend/src/pages/LoginPage.test.tsx`

- [x] **Step 1: Write the failing test** — `frontend/src/pages/LoginPage.test.tsx`

Board members are seeded (Task 10) with a temporary password, so the first real login for each of them returns `newPasswordRequired`, not `success` — this page needs to handle that as the *normal*, expected first-login path, not an edge case.

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { useAuth } from '../auth/AuthContext'
import { LoginPage } from './LoginPage'

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

describe('LoginPage', () => {
  it('calls login with the entered email and password on submit', async () => {
    const login = vi.fn().mockResolvedValue({
      status: 'success',
      tokens: { idToken: 'fake-id-token', accessToken: 'fake-access-token', refreshToken: 'fake-refresh-token' },
    })
    vi.mocked(useAuth).mockReturnValue({ idToken: null, login, setTokens: vi.fn(), logout: vi.fn() })

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'board@boombayan.org' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))

    await waitFor(() => expect(login).toHaveBeenCalledWith('board@boombayan.org', 'password123'))
  })

  it('shows an error message when login fails', async () => {
    const login = vi.fn().mockRejectedValue(new Error('Incorrect username or password.'))
    vi.mocked(useAuth).mockReturnValue({ idToken: null, login, setTokens: vi.fn(), logout: vi.fn() })

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'board@boombayan.org' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.')
  })

  it('shows the new-password form on newPasswordRequired, and completes login on submit', async () => {
    const completeNewPassword = vi.fn().mockResolvedValue({
      idToken: 'fake-id-token',
      accessToken: 'fake-access-token',
      refreshToken: 'fake-refresh-token',
    })
    const login = vi.fn().mockResolvedValue({ status: 'newPasswordRequired', completeNewPassword })
    const setTokens = vi.fn()
    vi.mocked(useAuth).mockReturnValue({ idToken: null, login, setTokens, logout: vi.fn() })

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'board@boombayan.org' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'temp-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByLabelText('New password')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-strong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))

    await waitFor(() => expect(completeNewPassword).toHaveBeenCalledWith('new-strong-password'))
    expect(setTokens).toHaveBeenCalledWith({
      idToken: 'fake-id-token',
      accessToken: 'fake-access-token',
      refreshToken: 'fake-refresh-token',
    })
  })

  it('shows an error when completing the new-password challenge fails', async () => {
    const completeNewPassword = vi.fn().mockRejectedValue(new Error('Password does not meet requirements.'))
    const login = vi.fn().mockResolvedValue({ status: 'newPasswordRequired', completeNewPassword })
    vi.mocked(useAuth).mockReturnValue({ idToken: null, login, setTokens: vi.fn(), logout: vi.fn() })

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'board@boombayan.org' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'temp-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))

    await screen.findByLabelText('New password')
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'weak' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not set new password. Please try again.')
  })
})
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/LoginPage.test.tsx
```
Expected: FAIL — `Failed to resolve import "./LoginPage"`

- [x] **Step 3: Write `frontend/src/pages/LoginPage.tsx`**

```tsx
import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthTokens } from '../auth/cognito'
import { useAuth } from '../auth/AuthContext'

type CompleteNewPassword = (newPassword: string) => Promise<AuthTokens>

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null)
  const [completeNewPassword, setCompleteNewPassword] = useState<CompleteNewPassword | null>(null)
  const { login, setTokens } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      const result = await login(email, password)
      if (result.status === 'newPasswordRequired') {
        setCompleteNewPassword(() => result.completeNewPassword)
      } else {
        navigate('/dashboard')
      }
    } catch {
      setError('Invalid email or password.')
    }
  }

  async function handleNewPasswordSubmit(event: FormEvent) {
    event.preventDefault()
    setNewPasswordError(null)
    try {
      const tokens = await completeNewPassword!(newPassword)
      setTokens(tokens)
      navigate('/dashboard')
    } catch {
      setNewPasswordError('Could not set new password. Please try again.')
    }
  }

  if (completeNewPassword) {
    return (
      <form onSubmit={handleNewPasswordSubmit}>
        <h1>Set a new password</h1>
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
        {newPasswordError && <p role="alert">{newPasswordError}</p>}
        <button type="submit">Set password</button>
      </form>
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Boombayan LMS</h1>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Log in</button>
    </form>
  )
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/pages/LoginPage.test.tsx
```
Expected: PASS (4 passed)

- [x] **Step 5: Commit**

```bash
cd ..
git add frontend/src/pages/LoginPage.tsx frontend/src/pages/LoginPage.test.tsx
git commit -m "feat: add LoginPage"
```

---

### Task 16: API client

**Files:**
- Modify: `frontend/src/vite-env.d.ts`
- Modify: `frontend/.env.local.example`
- Create: `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.test.ts`

- [x] **Step 1: Add `VITE_API_BASE_URL` to the env types** — modify `frontend/src/vite-env.d.ts` to read:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COGNITO_USER_POOL_ID: string
  readonly VITE_COGNITO_CLIENT_ID: string
  readonly VITE_API_BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

- [x] **Step 2: Add it to the example env file** — append to `frontend/.env.local.example`:

```
VITE_API_BASE_URL=https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com
```

Fill in the real API Gateway URL from Task 4's deploy output (no trailing slash).

- [x] **Step 3: Write the failing test** — `frontend/src/api/client.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './client'

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the bearer token and returns parsed JSON on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user_id: 'abc123' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await apiFetch<{ user_id: string }>('/me', 'fake-id-token')

    expect(result).toEqual({ user_id: 'abc123' })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/me'), {
      headers: { Authorization: 'Bearer fake-id-token' },
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

- [x] **Step 4: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/api/client.test.ts
```
Expected: FAIL — `Failed to resolve import "./client"`

- [x] **Step 5: Write `frontend/src/api/client.ts`**

```ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

export async function apiFetch<T>(path: string, idToken: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  })
  if (!response.ok) {
    throw new Error(`API request to ${path} failed with status ${response.status}`)
  }
  return response.json() as Promise<T>
}
```

- [x] **Step 6: Run test to verify it passes**

```bash
npx vitest run src/api/client.test.ts
```
Expected: PASS (2 passed)

- [x] **Step 7: Commit**

```bash
cd ..
git add frontend/src/vite-env.d.ts frontend/.env.local.example frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat: add API client with bearer token attachment"
```

---

### Task 17: DashboardPage and route wiring

**Files:**
- Create: `frontend/src/pages/DashboardPage.tsx`
- Test: `frontend/src/pages/DashboardPage.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`

- [x] **Step 1: Write the failing test** — `frontend/src/pages/DashboardPage.test.tsx`

```tsx
import { render, screen, waitFor } from '@testing-library/react'
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
  it('shows the current user email after loading', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockResolvedValue({
      user_id: 'abc123',
      email: 'board@boombayan.org',
      is_administrator: true,
      member_id: 'mem-1',
    })

    render(<DashboardPage />)

    await waitFor(() =>
      expect(screen.getByText('Welcome, board@boombayan.org')).toBeInTheDocument(),
    )
    expect(screen.getByText('Administrator')).toBeInTheDocument()
  })

  it('shows an error message when the profile fetch fails', async () => {
    vi.mocked(useAuth).mockReturnValue({ idToken: 'fake-id-token', login: vi.fn(), setTokens: vi.fn(), logout: vi.fn() })
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))

    render(<DashboardPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your profile.')
  })
})
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/DashboardPage.test.tsx
```
Expected: FAIL — `Failed to resolve import "./DashboardPage"`

- [x] **Step 3: Write `frontend/src/pages/DashboardPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
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
    apiFetch<CurrentUser>('/me', idToken)
      .then(setUser)
      .catch(() => setError('Could not load your profile.'))
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
      <button onClick={logout}>Log out</button>
    </div>
  )
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/pages/DashboardPage.test.tsx
```
Expected: PASS (2 passed)

- [x] **Step 5: Wire up routing** — replace `frontend/src/App.tsx`:

```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<DashboardPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
```

- [x] **Step 6: Update the now-outdated App test** — replace `frontend/src/App.test.tsx` (the Task 11 placeholder test asserted on static text; now App does real routing, so this asserts the actual intended behavior: an unauthenticated visitor lands on the login page):

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('redirects an unauthenticated visitor to the login page', () => {
    render(<App />)
    expect(screen.getByText('Boombayan LMS')).toBeInTheDocument()
  })
})
```

- [x] **Step 7: Run the full frontend suite**

```bash
npx vitest run
```
Expected: all tests PASS.

- [x] **Step 8: Commit**

```bash
cd ..
git add frontend/src/pages/DashboardPage.tsx frontend/src/pages/DashboardPage.test.tsx frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "feat: add DashboardPage and wire up app routing"
```

---

### Task 18: End-to-end manual verification

This wires together every prior task against the real deployed AWS stack — no mocks. It's the actual proof that login works.

**Execution note:** run via a scripted headless-Chromium (Playwright) session rather than a human clicking through a browser, since no interactive GUI was available — same steps, same real deployed stack, same real seeded account. This run found and fixed three real bugs that 37 passing unit/integration tests never caught (see "Three real bugs found only by Task 18's live browser test" in the Plan Self-Review Notes at the end of this document): a missing `global` browser polyfill, a Cognito auth-flow mismatch (`ALLOW_USER_SRP_AUTH` required, not `ALLOW_USER_PASSWORD_AUTH`), and a CORS preflight failure caused by API Gateway's automatic CORS not engaging on a `$default` catch-all route. All steps below were completed and verified after those fixes, with zero browser console errors. The seeded account (michaelseno@gmail.com) completed its real `NEW_PASSWORD_REQUIRED` challenge and is now `CONFIRMED`.

**Files:** none (manual verification only).

- [x] **Step 1: Confirm `frontend/.env.local` has real values**

```bash
cat frontend/.env.local
```
Expected: three lines with real (non-placeholder) values for `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID` (from Task 6's deploy output) and `VITE_API_BASE_URL` (from Task 4's deploy output, no trailing slash). Create this file from `frontend/.env.local.example` if it doesn't exist yet.

- [x] **Step 2: Confirm a seed admin account exists** (skip if already done in Task 10, Step 7)

```bash
cd backend
USERS_TABLE=boombayan-api-dev-users \
COGNITO_USER_POOL_ID=<UserPoolId> \
COGNITO_CLIENT_ID=<UserPoolClientId> \
AWS_REGION=us-east-1 \
.venv/bin/python -m scripts.seed_admin --email you@yourdomain.com --temporary-password 'TempPassword123!'
cd ..
```
Expected: prints `Created admin user you@yourdomain.com with UserId <uuid>`. The account is left in `FORCE_CHANGE_PASSWORD` status — that's expected, Step 5 below completes it.

- [x] **Step 3: Start the frontend dev server**

```bash
cd frontend && npm run dev
```
Expected: prints a local URL, typically `http://localhost:5173/`.

- [x] **Step 4: Open the app in a browser**

Navigate to `http://localhost:5173/`.
Expected: redirected to `/login`, showing the "Boombayan LMS" heading and email/password fields.

- [x] **Step 5: Log in with the temporary credentials and set a real password**

Enter the email and temporary password from Step 2, click "Log in".
Expected: instead of going straight to the dashboard, the page shows "Set a new password" with a single password field — this is the `NEW_PASSWORD_REQUIRED` challenge, the first-login path every seeded account takes. Enter a real password (meets the pool's policy: min 10 chars, upper+lower+number), click "Set password".
Expected: redirected to `/dashboard`, briefly shows "Loading...", then shows "Welcome, you@yourdomain.com" and "Administrator". Confirm via `aws cognito-idp admin-get-user --user-pool-id <UserPoolId> --username you@yourdomain.com --query UserStatus` that status is now `"CONFIRMED"`, not `"FORCE_CHANGE_PASSWORD"`.

- [x] **Step 6: Verify logout and re-protection**

Click "Log out".
Expected: returns to `/login`. Manually navigating the browser to `http://localhost:5173/dashboard` redirects back to `/login` (no idToken). Logging back in with the email and the *real* password set in Step 5 (the temporary password no longer works) should go straight to `/dashboard` — no new-password form this time, since the account is now `CONFIRMED`.

- [x] **Step 7: Stop the dev server**

```bash
# Ctrl+C in the terminal running npm run dev
cd ..
```

No commit for this task — it's verification of work already committed in Tasks 1-17.

---

### Task 19: README

**Files:**
- Create: `README.md`

- [x] **Step 1: Write `README.md`**

```markdown
# Boombayan Lending Management System

Internal lending operations platform for Boombayan. See `docs/superpowers/specs/` for the
full design and `docs/superpowers/plans/` for implementation plans.

## Project layout

- `backend/` — FastAPI app, deployed to AWS Lambda
- `frontend/` — React + Vite + TypeScript SPA
- `infra/` — Serverless Framework IaC (Lambda, API Gateway, DynamoDB, Cognito)

## Prerequisites

- Python 3.12+
- Node 20+
- An AWS account you control, with credentials configured (`aws sts get-caller-identity` should succeed)

## Backend setup

\`\`\`bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
\`\`\`

## Frontend setup

\`\`\`bash
cd frontend
npm install
cp .env.local.example .env.local   # then fill in real values, see below
npm run test
npm run dev
\`\`\`

## Infrastructure (deploy)

\`\`\`bash
cd infra
npm install
npx serverless deploy
\`\`\`

Deploy output includes the API Gateway URL and the Cognito `UserPoolId` /
`UserPoolClientId` — copy these into `frontend/.env.local`.

## Creating board member logins

There's no self-registration. After deploying, create each board member's account with a temporary password (share it with them out-of-band — they'll be forced to set their own permanent password on first login):

\`\`\`bash
cd backend
USERS_TABLE=boombayan-api-dev-users \
COGNITO_USER_POOL_ID=<from deploy output> \
COGNITO_CLIENT_ID=<from deploy output> \
AWS_REGION=us-east-1 \
.venv/bin/python -m scripts.seed_admin --email <board-member-email> --temporary-password '<temporary-password>'
\`\`\`

## Running tests

\`\`\`bash
cd backend && pytest
cd frontend && npm run test
\`\`\`
```

- [x] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add project README"
```

---

## Plan Self-Review Notes

- **Spec coverage:** This plan implements design doc §2 (architecture), §3 (Users/Members link via the `member_id` field — full Member CRUD is deferred to the next plan), and the auth/dashboard-shell slice of §3's role model (`is_administrator` flag is stored and surfaced, but admin-only endpoint enforcement is deferred to Plan 2 since there are no protected admin actions yet beyond viewing one's own profile).
- **Deferred to later plans (by design, per the phase breakdown):** Member/Share management (Plan 2), Loan lifecycle (Plan 3), Payments/Penalties (Plan 4), Cycles/Dividends/Reporting (Plan 5), and S3/CloudFront static hosting for the frontend (deferred until there's a stable build worth deploying statically — local `npm run dev` against the real deployed backend is sufficient to prove this plan's scope works end-to-end).
- **Type consistency check:** `User` Pydantic model (Task 7) fields — `user_id`, `email`, `is_administrator`, `member_id` — match exactly what `GET /me` returns (Task 9) and what `DashboardPage`'s `CurrentUser` interface expects (Task 17), including the snake_case JSON keys (FastAPI/Pydantic serializes Python attribute names as-is, not camelCase).
- **Security follow-up resolved, not deferred:** Task 6's original review suggested migrating from `ALLOW_USER_PASSWORD_AUTH` to `ALLOW_USER_SRP_AUTH` as an optional Phase 2 hardening item. Task 18's real login test against the live stack showed this isn't optional at all — `amazon-cognito-identity-js`'s `authenticateUser()` only performs SRP, so `ALLOW_USER_PASSWORD_AUTH` alone made every login fail. Fixed in Phase 1 (see Task 6's updated `ExplicitAuthFlows`).
- **Remaining Task 6 follow-ups (still deferred to Phase 2 by deliberate choice):** (1) No `AccountRecoverySetting` is configured — harmless today since there's no self-service or forgot-password flow to trigger it, but should be set explicitly once one is built. (2) No MFA — explicitly out of scope for Phase 1 per the design doc, revisit given this is a financial application's admin/board login.
- **Three real bugs found only by Task 18's live browser test, noted for future plans:** 37 passing unit/integration tests (frontend + backend) never caught any of: (1) `amazon-cognito-identity-js` requiring a `global` polyfill in real browsers (jsdom has `global` natively, masking this in tests) — fixed via `vite.config.ts`'s `define: { global: 'globalThis' }`. (2) The SRP auth mismatch above. (3) API Gateway HTTP API's automatic CORS handling not engaging for OPTIONS requests against a `$default` catch-all route (this service's only route) — the preflight fell through to the Lambda and got a 405; fixed via FastAPI's `CORSMiddleware` instead of relying on `serverless.yml`'s `httpApi.cors` (removed, since it had no effect here). **Takeaway for Plan 2+:** a real end-to-end run against deployed infrastructure is not optional polish — these categories of bugs (browser-vs-jsdom globals, auth-flow/library mismatches, routing-shape-dependent platform behavior) are structurally invisible to mocked test suites no matter how thorough.
- **Test coverage gap noted during Task 8's code review:** `backend/app/auth.py`'s real JWKS-fetch/RS256-signature-verification path (`decode_token` → `_get_jwks_client()` → `PyJWKClient`) is never exercised by `test_auth.py` — all 3 tests mock `decode_token` entirely, testing only `get_current_user_id`'s header-parsing/error-translation logic. A regression in the actual crypto/JWKS-fetch code wouldn't be caught until Task 18's manual end-to-end verification against the real deployed Cognito pool. Acceptable for now (consistent with the plan's own prescribed tests, and Task 18 provides a real-world backstop), but worth a fast-follow: a test that signs a token with a throwaway RS256 keypair, serves the public JWK from a mocked HTTP endpoint, and asserts `decode_token` round-trips correctly (including rejecting wrong-audience/wrong-token_use tokens).
- **Provisioning-divergence risk noted during Task 9's code review:** `GET /me` returns a generic `404 User not found` for a Cognito-authenticated user with no matching Users-table row. This isn't hypothetical — there's no self-registration in this system, so every account is provisioned out-of-band, and `backend/scripts/seed_admin.py` (Task 10) is, for now, the *only* sanctioned path that creates both the Cognito login and the Users-table row together. If a Cognito user is ever created any other way (console, a future admin UI that forgets to also write the DynamoDB row, etc.), they'll authenticate successfully and then hit this 404, which reads like a routing bug rather than what it actually is. Documented in `routers/users.py` with a comment; the response message itself is left generic for now (an alternative like "Your account is not fully provisioned. Contact an administrator." was considered but not applied) — revisit if/when a non-seed-script account-creation path is added in a later plan.
- **Dev-tooling dependency bump deferred during Task 11's code review:** `npm audit` flags 5 vulnerabilities (3 moderate, 1 high, 1 critical-rated) rooted in `esbuild`/`vite`/`vitest`/`vite-node`/`@vitest/mocker`. All are dev-tooling-only — the "critical" one requires Vitest's UI/watch server to be listening and network-exposed, which this project never runs (`test` script is `vitest run`, one-shot headless) — and fixing them requires `npm audit fix --force`, a semver-major bump (vite 5→6, vitest 2→4). The one production-impacting finding (`js-cookie` 2.2.1 via `amazon-cognito-identity-js`, CVSS 7.5) was fixed non-breaking in a follow-up commit. The major-version dev-tooling bump is intentionally deferred — revisit once there's slack to absorb Vite 6/Vitest 4's breaking changes, rather than forcing it mid-build.
- **No session-refresh flow, noted during Task 13's code review:** Cognito's ID token has a default ~1-hour expiry, and nothing in this 19-task plan ever uses the refresh token to renew it — `AuthContext` extracts only `idToken` from `AuthTokens` and discards `accessToken`/`refreshToken` (documented in code). Once the token expires, the only recovery path is a full re-login (the user gets 401s from the API, has to log out/in again) — there's no silent background refresh. For 5 board members using an internal tool this is a tolerable, low-priority limitation, not a blocker, but it's worth knowing going into Task 18's manual verification so an hourly forced re-login isn't mistaken for a bug. Revisit if session length becomes a real friction point in practice.
- **`apiFetch` is GET-only with no body/method support, noted during Task 16's code review:** `apiFetch<T>(path, idToken)` only attaches an `Authorization` header — no `Content-Type`, no request body, implicit GET. This is YAGNI-correct for Task 17's single `/me` call, but it's explicitly the template every future endpoint call will copy, and Plan 2+ (loans, payments, members) will need POST/PUT with JSON bodies. Extending the signature later (e.g. an optional `init`/options parameter) is additive and backward-compatible, not a foreclosure — just flagging so it's a deliberate addition when Plan 2 starts, not a surprised retrofit across many call sites.

