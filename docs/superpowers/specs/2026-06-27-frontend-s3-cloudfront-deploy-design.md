# Frontend S3 + CloudFront Deployment Design

Status: Approved
Scope: Manual deployment of the Vite/React frontend to a private S3 bucket served via CloudFront (dev stage). No custom domain. No CI/CD pipeline (deferred post-MVP).

---

## 1. Purpose

Deploy the Boombayan LMS frontend as a static site to AWS so the board can access it from a stable HTTPS URL without running a local dev server. The backend already runs on AWS (Lambda + API Gateway, `us-east-1`, dev stage). This plan brings the frontend to the same environment.

---

## 2. Architecture

Two independent scripts:

1. **`scripts/setup-frontend-infra.sh`** — one-time infrastructure provisioning via AWS CLI. Creates the S3 bucket and CloudFront distribution. Never needs to be run again unless rebuilding from scratch.

2. **`scripts/deploy-frontend.sh`** — deployment script. Builds the frontend and pushes it live. Run on every release.

Frontend environment variables are stored in `frontend/.env.production` (gitignored). A reference file `frontend/.env.production.example` is committed alongside the existing `frontend/.env.local.example`.

After setup, the CloudFront domain is manually added to `CORS_ALLOWED_ORIGINS` in `infra/serverless.yml` and the backend is redeployed once.

---

## 3. Infrastructure Setup Script

**File:** `scripts/setup-frontend-infra.sh`
**Run:** Once, by a developer with AWS CLI configured and sufficient IAM permissions.
**AWS region:** `us-east-1` (matches backend).

### Steps performed

1. **Create S3 bucket** — `boombayan-frontend-dev` in `us-east-1`.
   - All public access blocked (`block-public-access` enabled on all four settings).
   - No static website hosting enabled — CloudFront accesses the bucket directly via OAC (not via the S3 website endpoint).

2. **Create CloudFront Origin Access Control (OAC)** — named `boombayan-frontend-dev-oac`.
   - Signing behavior: `always`
   - Signing protocol: `sigv4`
   - Origin type: `s3`

3. **Create CloudFront distribution** with:
   - **Origin:** the private S3 bucket accessed via the OAC
   - **Default root object:** `index.html`
   - **Custom error responses:**
     - HTTP 403 → `/index.html`, response code 200
     - HTTP 404 → `/index.html`, response code 200
     (Required for React Router — deep links like `/members/123` would otherwise 403/404 from S3)
   - **Viewer protocol policy:** redirect HTTP to HTTPS
   - **Price class:** `PriceClass_100` (US, Canada, Europe — lowest cost tier)
   - **Default cache behavior:** GET/HEAD allowed, caching enabled

4. **Attach S3 bucket policy** granting the CloudFront distribution's OAC read access (`s3:GetObject`) to the bucket.

5. **Write `scripts/.env.deploy`** (gitignored) with:
   ```
   BUCKET_NAME=boombayan-frontend-dev
   CLOUDFRONT_DIST_ID=<distribution-id>
   CLOUDFRONT_DOMAIN=<d1xxxxx.cloudfront.net>
   ```

6. **Print the CloudFront domain** to stdout so the developer knows what to add to CORS.

### Post-setup manual step

Add the CloudFront domain to `CORS_ALLOWED_ORIGINS` in `infra/serverless.yml`:

```yaml
CORS_ALLOWED_ORIGINS: http://localhost:5173,http://localhost:5174,https://<cloudfront-domain>
```

Then redeploy the backend once: `cd infra && sls deploy --stage dev`.

---

## 4. Deploy Script

**File:** `scripts/deploy-frontend.sh`
**Run:** On every frontend release.
**Prerequisites:** `scripts/.env.deploy` exists, `frontend/.env.production` exists, AWS CLI configured.

### Steps performed

1. Source `scripts/.env.deploy` to read `BUCKET_NAME`, `CLOUDFRONT_DIST_ID`, `CLOUDFRONT_DOMAIN`.
2. Verify `frontend/.env.production` exists — exit with a clear error message if missing.
3. Build the frontend:
   ```bash
   cd frontend && npm run build
   ```
   Vite automatically picks up `frontend/.env.production` for production builds.
4. Sync build output to S3:
   ```bash
   aws s3 sync dist/ s3://$BUCKET_NAME --delete
   ```
   `--delete` removes files from S3 that no longer exist in the build.
5. Invalidate CloudFront cache:
   ```bash
   aws cloudfront create-invalidation --distribution-id $CLOUDFRONT_DIST_ID --paths "/*"
   ```
6. Print the live URL: `https://$CLOUDFRONT_DOMAIN`

---

## 5. Frontend Environment File

**File:** `frontend/.env.production` — gitignored, created once per developer machine.

```
VITE_API_BASE_URL=https://<api-id>.execute-api.us-east-1.amazonaws.com
VITE_COGNITO_USER_POOL_ID=us-east-1_pLYYQx3ey
VITE_COGNITO_CLIENT_ID=<cognito-client-id>
```

**File:** `frontend/.env.production.example` — committed to git as a reference. Contains placeholder values matching the pattern above.

---

## 6. Gitignore Updates

Add to root `.gitignore` (or create one if absent):
```
scripts/.env.deploy
frontend/.env.production
```

`frontend/.env.local` is already gitignored by the existing `frontend/.gitignore`.

---

## 7. File Summary

| File | Action | Purpose |
|---|---|---|
| `scripts/setup-frontend-infra.sh` | Create | One-time S3 + CloudFront provisioning |
| `scripts/deploy-frontend.sh` | Create | Build + sync + cache invalidation |
| `scripts/.env.deploy` | Gitignored (auto-generated) | Stores bucket name + CloudFront IDs |
| `frontend/.env.production` | Gitignored (manual) | Build-time Vite env vars for production |
| `frontend/.env.production.example` | Create | Reference template committed to git |
| `infra/serverless.yml` | Modify | Add CloudFront domain to CORS origins |

---

## 8. Out of Scope

- Custom domain and ACM certificate (deferred — use generated CloudFront URL for now)
- GitHub Actions CI/CD pipeline (deferred post-MVP)
- Production (`prod`) stage (deferred — dev only for now)
- WAF, access logging, or S3 versioning
- Multi-region or failover
