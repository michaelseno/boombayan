# Frontend S3 + CloudFront Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create two shell scripts — one to provision an S3 bucket + CloudFront distribution (run once) and one to build + deploy the frontend (run each release) — plus supporting env files and a CORS update to the backend.

**Architecture:** A private S3 bucket stores the Vite build output. A CloudFront distribution serves it over HTTPS with custom error responses that enable React Router deep links. The setup script writes bucket/distribution IDs to `scripts/.env.deploy` which the deploy script reads. Build-time Vite env vars live in `frontend/.env.production` (gitignored).

**Tech Stack:** AWS CLI v2, Bash, Vite (npm run build), Serverless Framework (sls deploy)

## Global Constraints

- AWS region: `us-east-1` (matches backend)
- S3 bucket name: `boombayan-frontend-dev`
- CloudFront OAC name: `boombayan-frontend-dev-oac`
- CloudFront price class: `PriceClass_100`
- CloudFront managed cache policy ID (CachingOptimized): `658327ea-f89d-4fab-a63d-7e88639e58f6`
- SPA routing fix: HTTP 403 and 404 from S3 must both redirect to `/index.html` with response code 200
- All public S3 access must be blocked — CloudFront accesses via OAC only
- `scripts/.env.deploy` and `frontend/.env.production` must be gitignored — never committed
- Deploy script must fail fast with a clear error if either env file is missing
- Backend stage: `dev`
- Repo root: `/Users/mjseno/Documents/Development/boombayan_project`

---

### Task 1: Gitignore entries + env.production.example

This task sets up the supporting files before any scripts are written. It ensures secrets are never accidentally committed, and provides the reference template for `frontend/.env.production`.

**Files:**
- Modify: `.gitignore` (root)
- Create: `frontend/.env.production.example`

**Interfaces:**
- Produces: `scripts/.env.deploy` and `frontend/.env.production` are gitignored; `frontend/.env.production.example` is committed as a reference

- [ ] **Step 1: Add gitignore entries to root `.gitignore`**

Open `.gitignore` at the repo root. Under the `# Env` section, add two lines:

```
# Env
.env
.env.local
scripts/.env.deploy
frontend/.env.production
```

The full updated `# Env` block must look exactly like this (existing `.env` and `.env.local` lines stay):

```gitignore
# Env
.env
.env.local
scripts/.env.deploy
frontend/.env.production
```

- [ ] **Step 2: Verify the new entries are recognised**

```bash
cd /Users/mjseno/Documents/Development/boombayan_project
touch scripts/.env.deploy frontend/.env.production 2>/dev/null || true
git check-ignore -v scripts/.env.deploy frontend/.env.production
```

Expected output (both files shown as ignored):
```
.gitignore:18:scripts/.env.deploy      scripts/.env.deploy
.gitignore:19:frontend/.env.production frontend/.env.production
```

Clean up the temporary files:
```bash
rm -f scripts/.env.deploy frontend/.env.production
```

- [ ] **Step 3: Create `frontend/.env.production.example`**

```bash
mkdir -p /Users/mjseno/Documents/Development/boombayan_project/frontend
```

Create `frontend/.env.production.example` with this exact content:

```
VITE_API_BASE_URL=https://<api-id>.execute-api.us-east-1.amazonaws.com
VITE_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
```

- [ ] **Step 4: Create the `scripts/` directory**

```bash
mkdir -p /Users/mjseno/Documents/Development/boombayan_project/scripts
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore frontend/.env.production.example
git commit -m "chore: gitignore deploy env files, add env.production.example"
```

---

### Task 2: setup-frontend-infra.sh

One-time script that creates the S3 bucket and CloudFront distribution and writes their identifiers to `scripts/.env.deploy`. Run once; never needs to be run again unless rebuilding infrastructure from scratch.

**Required IAM permissions for the executing AWS principal:**
- `s3:CreateBucket`, `s3:PutPublicAccessBlock`, `s3:PutBucketPolicy`
- `cloudfront:CreateOriginAccessControl`, `cloudfront:CreateDistribution`
- `sts:GetCallerIdentity`

**Files:**
- Create: `scripts/setup-frontend-infra.sh`

**Interfaces:**
- Produces: `scripts/.env.deploy` containing `BUCKET_NAME`, `CLOUDFRONT_DIST_ID`, `CLOUDFRONT_DOMAIN`
- Consumed by: Task 3 (`deploy-frontend.sh`) and Task 4 (CORS update)

- [ ] **Step 1: Create `scripts/setup-frontend-infra.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

BUCKET_NAME="boombayan-frontend-dev"
REGION="us-east-1"
OAC_NAME="boombayan-frontend-dev-oac"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Creating S3 bucket: $BUCKET_NAME"
# Note: us-east-1 is the default region — do NOT pass --create-bucket-configuration
# for us-east-1; it causes an InvalidLocationConstraint error.
aws s3api create-bucket \
  --bucket "$BUCKET_NAME" \
  --region "$REGION"

echo "==> Blocking all public access on bucket"
aws s3api put-public-access-block \
  --bucket "$BUCKET_NAME" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

echo "==> Creating CloudFront Origin Access Control"
OAC_ID=$(aws cloudfront create-origin-access-control \
  --origin-access-control-config \
    "Name=${OAC_NAME},Description=OAC for Boombayan frontend dev,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
  --query 'OriginAccessControl.Id' \
  --output text)
echo "    OAC ID: $OAC_ID"

echo "==> Creating CloudFront distribution"
DIST_JSON=$(aws cloudfront create-distribution --distribution-config "{
  \"CallerReference\": \"boombayan-frontend-dev-$(date +%s)\",
  \"Comment\": \"Boombayan LMS frontend (dev)\",
  \"DefaultRootObject\": \"index.html\",
  \"Origins\": {
    \"Quantity\": 1,
    \"Items\": [{
      \"Id\": \"s3-${BUCKET_NAME}\",
      \"DomainName\": \"${BUCKET_NAME}.s3.${REGION}.amazonaws.com\",
      \"S3OriginConfig\": {\"OriginAccessIdentity\": \"\"},
      \"OriginAccessControlId\": \"${OAC_ID}\"
    }]
  },
  \"DefaultCacheBehavior\": {
    \"TargetOriginId\": \"s3-${BUCKET_NAME}\",
    \"ViewerProtocolPolicy\": \"redirect-to-https\",
    \"AllowedMethods\": {
      \"Quantity\": 2,
      \"Items\": [\"GET\", \"HEAD\"],
      \"CachedMethods\": {\"Quantity\": 2, \"Items\": [\"GET\", \"HEAD\"]}
    },
    \"CachePolicyId\": \"658327ea-f89d-4fab-a63d-7e88639e58f6\",
    \"Compress\": true
  },
  \"CustomErrorResponses\": {
    \"Quantity\": 2,
    \"Items\": [
      {\"ErrorCode\": 403, \"ResponsePagePath\": \"/index.html\", \"ResponseCode\": \"200\", \"ErrorCachingMinTTL\": 0},
      {\"ErrorCode\": 404, \"ResponsePagePath\": \"/index.html\", \"ResponseCode\": \"200\", \"ErrorCachingMinTTL\": 0}
    ]
  },
  \"PriceClass\": \"PriceClass_100\",
  \"Enabled\": true
}")

DIST_ID=$(echo "$DIST_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['Distribution']['Id'])")
DIST_DOMAIN=$(echo "$DIST_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['Distribution']['DomainName'])")
echo "    Distribution ID: $DIST_ID"
echo "    Domain: $DIST_DOMAIN"

echo "==> Attaching S3 bucket policy for CloudFront OAC"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws s3api put-bucket-policy \
  --bucket "$BUCKET_NAME" \
  --policy "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Sid\": \"AllowCloudFrontOAC\",
      \"Effect\": \"Allow\",
      \"Principal\": {\"Service\": \"cloudfront.amazonaws.com\"},
      \"Action\": \"s3:GetObject\",
      \"Resource\": \"arn:aws:s3:::${BUCKET_NAME}/*\",
      \"Condition\": {
        \"StringEquals\": {
          \"AWS:SourceArn\": \"arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${DIST_ID}\"
        }
      }
    }]
  }"

echo "==> Writing scripts/.env.deploy"
cat > "${SCRIPT_DIR}/.env.deploy" << EOF
BUCKET_NAME=${BUCKET_NAME}
CLOUDFRONT_DIST_ID=${DIST_ID}
CLOUDFRONT_DOMAIN=${DIST_DOMAIN}
EOF

echo ""
echo "✅ Infrastructure setup complete!"
echo ""
echo "   CloudFront domain: https://${DIST_DOMAIN}"
echo "   (Distribution takes 5-15 minutes to finish deploying globally)"
echo ""
echo "Next steps:"
echo "  1. Add https://${DIST_DOMAIN} to CORS_ALLOWED_ORIGINS in infra/serverless.yml"
echo "  2. cd infra && sls deploy --stage dev"
echo "  3. Create frontend/.env.production (see frontend/.env.production.example)"
echo "  4. Run scripts/deploy-frontend.sh"
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x /Users/mjseno/Documents/Development/boombayan_project/scripts/setup-frontend-infra.sh
```

- [ ] **Step 3: Verify script syntax**

```bash
bash -n /Users/mjseno/Documents/Development/boombayan_project/scripts/setup-frontend-infra.sh
```

Expected: no output (no syntax errors).

- [ ] **Step 4: Commit**

```bash
git add scripts/setup-frontend-infra.sh
git commit -m "feat: add setup-frontend-infra.sh — one-time S3 + CloudFront provisioning"
```

- [ ] **Step 5: Run the setup script**

Ensure AWS CLI is configured (`aws sts get-caller-identity` should return your account ID). Then from the repo root:

```bash
bash scripts/setup-frontend-infra.sh
```

Expected: script prints each step, then prints the CloudFront domain (`dxxxxxxxxxx.cloudfront.net`) and next steps. `scripts/.env.deploy` is created.

- [ ] **Step 6: Verify `scripts/.env.deploy` was written**

```bash
cat /Users/mjseno/Documents/Development/boombayan_project/scripts/.env.deploy
```

Expected output (values will differ):
```
BUCKET_NAME=boombayan-frontend-dev
CLOUDFRONT_DIST_ID=E1XXXXXXXXX
CLOUDFRONT_DOMAIN=dxxxxxxxxxx.cloudfront.net
```

- [ ] **Step 7: Verify S3 bucket exists and is private**

```bash
aws s3api get-public-access-block --bucket boombayan-frontend-dev
```

Expected: all four settings are `true`.

---

### Task 3: deploy-frontend.sh

Script that builds the Vite frontend and pushes it to S3, then invalidates the CloudFront cache. Run on every release.

**Required IAM permissions for the executing AWS principal:**
- `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`
- `cloudfront:CreateInvalidation`

**Files:**
- Create: `scripts/deploy-frontend.sh`

**Interfaces:**
- Consumes: `scripts/.env.deploy` (from Task 2), `frontend/.env.production` (created by developer)
- Produces: live site at `https://$CLOUDFRONT_DOMAIN`

- [ ] **Step 1: Create `frontend/.env.production`**

Using `frontend/.env.production.example` as a template, create `frontend/.env.production` with the actual dev values (get `VITE_API_BASE_URL` from the API Gateway console or from the output of `cd infra && sls info --stage dev`, and `VITE_COGNITO_USER_POOL_ID` / `VITE_COGNITO_CLIENT_ID` from the Cognito console or Serverless stack outputs):

```
VITE_API_BASE_URL=https://<actual-api-id>.execute-api.us-east-1.amazonaws.com
VITE_COGNITO_USER_POOL_ID=us-east-1_pLYYQx3ey
VITE_COGNITO_CLIENT_ID=<actual-client-id>
```

This file is gitignored and stays only on the local machine.

- [ ] **Step 2: Create `scripts/deploy-frontend.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_DEPLOY="${SCRIPT_DIR}/.env.deploy"
ENV_PRODUCTION="${REPO_ROOT}/frontend/.env.production"

if [[ ! -f "$ENV_DEPLOY" ]]; then
  echo "Error: ${ENV_DEPLOY} not found."
  echo "Run scripts/setup-frontend-infra.sh first to provision S3 and CloudFront."
  exit 1
fi

if [[ ! -f "$ENV_PRODUCTION" ]]; then
  echo "Error: ${ENV_PRODUCTION} not found."
  echo "Create it using frontend/.env.production.example as a template."
  exit 1
fi

# shellcheck source=/dev/null
source "$ENV_DEPLOY"

echo "==> Building frontend (production)"
cd "${REPO_ROOT}/frontend"
npm run build

echo "==> Syncing dist/ to s3://${BUCKET_NAME}"
aws s3 sync dist/ "s3://${BUCKET_NAME}" --delete

echo "==> Invalidating CloudFront cache (distribution: ${CLOUDFRONT_DIST_ID})"
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DIST_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)
echo "    Invalidation ID: ${INVALIDATION_ID}"

echo ""
echo "✅ Deployed!"
echo "   https://${CLOUDFRONT_DOMAIN}"
```

- [ ] **Step 3: Make the script executable**

```bash
chmod +x /Users/mjseno/Documents/Development/boombayan_project/scripts/deploy-frontend.sh
```

- [ ] **Step 4: Verify script syntax**

```bash
bash -n /Users/mjseno/Documents/Development/boombayan_project/scripts/deploy-frontend.sh
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add scripts/deploy-frontend.sh
git commit -m "feat: add deploy-frontend.sh — build, S3 sync, CloudFront invalidation"
```

- [ ] **Step 6: Run the deploy script**

From the repo root:

```bash
bash scripts/deploy-frontend.sh
```

Expected: builds the frontend, syncs files to S3, prints the invalidation ID, prints `https://dxxxxxxxxxx.cloudfront.net`.

- [ ] **Step 7: Verify the site loads**

Wait ~5 minutes for the CloudFront distribution to finish deploying (only needed on first deploy; subsequent deploys are faster). Then open `https://<CLOUDFRONT_DOMAIN>` in a browser.

Expected: the Boombayan LMS login page loads over HTTPS.

- [ ] **Step 8: Verify React Router deep links work**

Navigate directly to `https://<CLOUDFRONT_DOMAIN>/dashboard` (or any sub-route) in a browser — do not navigate from the home page.

Expected: the app loads correctly (not a 403 or 404 XML error from S3). This confirms the custom error response → `/index.html` mapping is working.

---

### Task 4: CORS update + backend redeploy

Add the CloudFront domain to the backend's CORS allowed origins so API calls from the deployed frontend are not blocked.

**Prerequisite:** Task 2 has been run and `scripts/.env.deploy` contains the real `CLOUDFRONT_DOMAIN`.

**Files:**
- Modify: `infra/serverless.yml` (line 20 — `CORS_ALLOWED_ORIGINS`)

**Interfaces:**
- Consumes: `CLOUDFRONT_DOMAIN` from `scripts/.env.deploy`
- Produces: deployed backend that accepts requests from the CloudFront domain

- [ ] **Step 1: Read the CloudFront domain**

```bash
source /Users/mjseno/Documents/Development/boombayan_project/scripts/.env.deploy
echo "https://$CLOUDFRONT_DOMAIN"
```

Note the exact value (e.g. `https://dxxxxxxxxxx.cloudfront.net`).

- [ ] **Step 2: Update `CORS_ALLOWED_ORIGINS` in `infra/serverless.yml`**

Find line 20 in `infra/serverless.yml`:

```yaml
    CORS_ALLOWED_ORIGINS: http://localhost:5173,http://localhost:5174
```

Replace it with (substituting your actual CloudFront domain):

```yaml
    CORS_ALLOWED_ORIGINS: http://localhost:5173,http://localhost:5174,https://<your-cloudfront-domain>.cloudfront.net
```

Example with a real value:
```yaml
    CORS_ALLOWED_ORIGINS: http://localhost:5173,http://localhost:5174,https://d1abc2defg3hi.cloudfront.net
```

- [ ] **Step 3: Commit the CORS change**

```bash
git add infra/serverless.yml
git commit -m "chore: add CloudFront domain to CORS_ALLOWED_ORIGINS for dev"
```

- [ ] **Step 4: Redeploy the backend**

```bash
cd /Users/mjseno/Documents/Development/boombayan_project/infra
sls deploy --stage dev
```

Expected: Serverless Framework deploys successfully. The updated Lambda environment variable is live.

- [ ] **Step 5: Verify API calls work from the deployed frontend**

Open `https://<CLOUDFRONT_DOMAIN>` in a browser. Log in with a valid admin account (e.g. `michaelseno@gmail.com`). Navigate to Members, Loans, and Reports pages.

Expected: all pages load data without CORS errors in the browser console.
