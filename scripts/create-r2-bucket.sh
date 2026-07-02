#!/usr/bin/env bash
set -euo pipefail

BUCKET_NAME="${1:-northops-fireprotectiondashboard}"

echo "==> Cloudflare R2 bucket setup"
echo "Bucket name: $BUCKET_NAME"
echo

if ! command -v wrangler >/dev/null 2>&1; then
  echo "Installing Wrangler..."
  npm install -g wrangler
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "Set CLOUDFLARE_API_TOKEN first:"
  echo "  1. Go to https://dash.cloudflare.com/profile/api-tokens"
  echo "  2. Create token with 'Account → R2 → Edit' permission"
  echo "  3. export CLOUDFLARE_API_TOKEN=your_token"
  echo
  exit 1
fi

echo "Creating bucket (skips if it already exists)..."
wrangler r2 bucket create "$BUCKET_NAME" || true

echo
echo "Next: create an R2 API token scoped to this bucket"
echo "  Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API token"
echo "  Permissions: Object Read & Write on bucket '$BUCKET_NAME'"
echo
echo "Then update .env:"
echo "  CLOUDFLARE_R2_ACCOUNT_ID=<your account id>"
echo "  CLOUDFLARE_R2_ACCESS_KEY_ID=<from token>"
echo "  CLOUDFLARE_R2_SECRET_ACCESS_KEY=<from token>"
echo "  CLOUDFLARE_R2_BUCKET_NAME=$BUCKET_NAME"
