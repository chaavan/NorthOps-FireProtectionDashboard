#!/usr/bin/env bash
# Remove leaked Google API keys from entire git history (one-time, rewrites history).
#
# Prerequisites:
#   pip install git-filter-repo   OR   brew install git-filter-repo
#
# After running:
#   1. Revoke the old key in Google Cloud Console (APIs & Services → Credentials).
#   2. Force-push all branches that were published: git push --force-with-lease --all
#   3. Force-push tags if any: git push --force-with-lease --tags
#   4. Close / resolve GitHub secret scanning alerts.
#
# WARNING: Coordinate with anyone else using this repo — everyone must re-clone or reset.
#
# Usage:
#   bash scripts/purge-secrets-from-history.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "ERROR: git-filter-repo is required."
  echo "  pip install git-filter-repo"
  echo "  brew install git-filter-repo"
  exit 1
fi

if [ "${PURGE_SECRETS_CONFIRM:-}" != "1" ]; then
  echo "This REWRITES git history to redact Google API key patterns."
  echo "You will need to force-push and all collaborators must re-sync."
  read -r -p "Continue? [y/N] " confirm
  if [[ "${confirm,,}" != "y" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

REPLACE_FILE="$(mktemp)"
trap 'rm -f "$REPLACE_FILE"' EXIT

# Regex only — no literal leaked key stored in this repository.
cat >"$REPLACE_FILE" <<'EOF'
regex:AIzaSy[0-9A-Za-z_-]{33}==>REDACTED_GOOGLE_API_KEY
regex:GOOGLE_API_KEY=AIzaSy[^\s"']+==># GOOGLE_API_KEY removed — use ENV_EXAMPLE.txt / .env.local
EOF

echo "==> Redacting secrets from all commits (this may take a minute)..."
git filter-repo --force --replace-text "$REPLACE_FILE"

echo
echo "Done. Verify:"
echo "  npm run check:secrets"
echo "  git log -S 'AIzaSy' --oneline -- README.md   # should be empty"
echo
echo "Then force-push (after revoking the key in Google Cloud):"
echo "  git push --force-with-lease --all"
echo "  git push --force-with-lease --tags"
