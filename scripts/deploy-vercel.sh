#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v vercel >/dev/null 2>&1; then
  echo "Installing Vercel CLI..."
  npm install -g vercel
fi

echo "==> Vercel deploy for NorthOps-FireProtectionDashboard"
echo "If prompted, log in and link to chaavan/NorthOps-FireProtectionDashboard"
echo

vercel link --yes --project northops-fire-protection-dashboard 2>/dev/null || vercel link

echo
echo "Set production env vars in Vercel (or pull from .env.local):"
echo "  vercel env pull .env.vercel.local"
echo
echo "Required: DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL"
echo "If Vercel build fails with Prisma P3005, baseline production once:"
echo "  BASELINE_CONFIRM=1 DATABASE_URL=<prod-url> bash scripts/baseline-migrations.sh"
echo "Recommended: OPENAI_API_KEY, GOOGLE_DOCUMENT_AI_*, CLOUDFLARE_R2_*, NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN"
echo

read -r -p "Deploy to production now? [y/N] " CONFIRM
if [[ "${CONFIRM,,}" == "y" ]]; then
  vercel --prod
fi
