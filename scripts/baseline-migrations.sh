#!/usr/bin/env bash
# Fast baseline: one DB transaction for all migrations (see baseline-migrations-fast.ts).
# Slow fallback: BASELINE_SLOW=1 bash scripts/baseline-migrations.sh
#
# Usage:
#   BASELINE_CONFIRM=1 DATABASE_URL="postgresql://..." bash scripts/baseline-migrations.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required."
  exit 1
fi

if [ "${BASELINE_SLOW:-}" = "1" ]; then
  echo "Using slow per-migration resolve mode..."
  if [ "${BASELINE_CONFIRM:-}" != "1" ]; then
    echo "This marks ALL migrations in prisma/migrations/ as already applied."
    read -r -p "Baseline this database? [y/N] " confirm
    if [[ "${confirm,,}" != "y" ]]; then
      echo "Aborted."
      exit 1
    fi
  fi
  count=0
  for dir in "$ROOT"/prisma/migrations/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    [ -f "$dir/migration.sql" ] || continue
    echo "==> resolve --applied $name"
    if npx prisma migrate resolve --applied "$name"; then
      count=$((count + 1))
    fi
  done
  echo "Baselined $count migration(s)."
  exit 0
fi

exec npx tsx scripts/baseline-migrations-fast.ts
