#!/usr/bin/env bash
# Fail if tracked files contain common secret patterns (API keys, tokens).
# Run from CI or before push: npm run check:secrets

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "check-tracked-secrets: not a git repository"
  exit 1
fi

# Patterns that must not appear in committed source/docs (placeholders are OK).
PATTERNS=(
  'AIzaSy[0-9A-Za-z_-]{20,}'
  'sk-[A-Za-z0-9]{20,}'
  '-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----'
)

# Paths to scan (git-tracked only).
FILES=()
while IFS= read -r file; do
  case "$file" in
    *.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico|*.pdf|*.xlsx|*.accdb|*.lock) continue ;;
    *) FILES+=("$file") ;;
  esac
done < <(git ls-files)

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "check-tracked-secrets: no tracked files"
  exit 0
fi

FOUND=0
for pattern in "${PATTERNS[@]}"; do
  if matches=$(grep -nE "$pattern" "${FILES[@]}" 2>/dev/null || true); then
    if [ -n "$matches" ]; then
      if [ "$FOUND" -eq 0 ]; then
        echo "ERROR: Possible secrets in tracked files:"
      fi
      FOUND=1
      echo "$matches" | sed 's/^/  /'
    fi
  fi
done

# Explicit env var lines with real-looking Google API keys (not placeholders).
if matches=$(git grep -nE '^[^#]*GOOGLE_API_KEY=AIza' -- "${FILES[@]}" 2>/dev/null || true); then
  if [ -n "$matches" ]; then
    echo "ERROR: GOOGLE_API_KEY must not be committed:"
    echo "$matches" | sed 's/^/  /'
    FOUND=1
  fi
fi

if [ "$FOUND" -ne 0 ]; then
  echo
  echo "Remove secrets, rotate compromised keys, and use .env.local (gitignored)."
  exit 1
fi

echo "check-tracked-secrets: OK"
