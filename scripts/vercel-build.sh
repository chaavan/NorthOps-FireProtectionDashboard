#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> prisma generate"
npx prisma generate

if [ -n "${DATABASE_URL:-}" ]; then
  echo "==> prisma migrate deploy"
  migrate_log="$(mktemp)"
  if ! npx prisma migrate deploy 2>"$migrate_log"; then
    if grep -q P3005 "$migrate_log"; then
      echo
      echo "ERROR: Prisma P3005 — database has tables but no migration history."
      echo "This usually means the DB was set up with 'prisma db push' instead of migrations."
      echo
      echo "One-time fix (against this DATABASE_URL, when schema already matches prisma/schema.prisma):"
      echo "  BASELINE_CONFIRM=1 bash scripts/baseline-migrations.sh"
      echo
      echo "Then redeploy. See: https://pris.ly/d/migrate-baseline"
      cat "$migrate_log" >&2
      rm -f "$migrate_log"
      exit 1
    fi
    cat "$migrate_log" >&2
    rm -f "$migrate_log"
    exit 1
  fi
  rm -f "$migrate_log"
else
  echo "==> DATABASE_URL not set; skipping prisma migrate deploy"
fi

echo "==> next build"
npx next build --webpack
