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
