#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> NorthOps Fire Protection Dashboard — local setup"
echo

if [[ ! -f .env.local ]]; then
  if [[ -f ../totalfireprotection/.env ]]; then
    cp ../totalfireprotection/.env .env.local
    echo "Copied env from ../totalfireprotection/.env"
  elif [[ -f ENV_EXAMPLE.txt ]]; then
    cp ENV_EXAMPLE.txt .env.local
    echo "Created .env.local from ENV_EXAMPLE.txt — fill in required values."
  else
    echo "Missing .env.local and ENV_EXAMPLE.txt"
    exit 1
  fi
fi

if ! grep -q '^NEXTAUTH_SECRET=' .env.local; then
  SECRET="$(openssl rand -base64 32)"
  printf '\nNEXTAUTH_SECRET="%s"\n' "$SECRET" >> .env.local
  echo "Generated NEXTAUTH_SECRET"
fi

echo "==> Installing dependencies"
npm install

echo "==> Generating Prisma client"
npx prisma generate

echo "==> Applying database migrations"
npx prisma migrate deploy

echo "==> Seeding role permissions"
npm run db:seed-permissions

echo "==> Ensuring admin user exists"
npx tsx scripts/create-chaavan-admin.ts || true

echo
echo "Setup complete. Start the app with: npm run dev"
echo "Then open http://localhost:3000"
