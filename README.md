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

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
```

If `pip install` doesn't seem to land in the venv (check with `which pip`
after activating), some shells alias `pip`/`python` past the venv — use
`.venv/bin/pip install -r requirements-dev.txt` instead.

## Frontend setup

```bash
cd frontend
npm install
cp .env.local.example .env.local   # then fill in real values, see below
npm run test
npm run dev
```

## Infrastructure (deploy)

```bash
cd infra
npm install
npx serverless deploy
```

Deploy output includes the API Gateway URL and the Cognito `UserPoolId` /
`UserPoolClientId` — copy these into `frontend/.env.local`.

## Creating board member logins

There's no self-registration. After deploying, create each board member's account with a temporary password (share it with them out-of-band — they'll be forced to set their own permanent password on first login):

```bash
cd backend
USERS_TABLE=boombayan-api-dev-users \
COGNITO_USER_POOL_ID=<from deploy output> \
COGNITO_CLIENT_ID=<from deploy output> \
AWS_REGION=us-east-1 \
.venv/bin/python -m scripts.seed_admin --email <board-member-email> --temporary-password '<temporary-password>'
```

`USERS_TABLE` follows `<service>-<stage>-users` (`boombayan-api-dev-users` is
the default `dev` stage) and `AWS_REGION` must match the region you actually
deployed to (`region` in `infra/serverless.yml`) — if you deploy with a
different `--stage` or region, substitute accordingly.

## Running tests

```bash
cd backend && pytest
cd frontend && npm run test
```

## What's not here yet

This is Plan 1 of a multi-plan project — auth and the board-member dashboard
shell only. Member management, the loan lifecycle, payments/penalties, and
cycle/dividend processing are designed but not yet built; see
`docs/superpowers/plans/` for the phase breakdown.
