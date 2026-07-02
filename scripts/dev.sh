#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -d ".next" ]]; then
  rm -rf .next
fi

exec npx next dev -H 0.0.0.0 -p 3000 "$@"
