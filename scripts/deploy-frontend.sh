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
