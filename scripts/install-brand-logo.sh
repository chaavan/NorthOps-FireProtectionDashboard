#!/usr/bin/env bash
# Install a client logo into public/ as a browser-safe PNG.
#
# Photos on macOS often exports HEIC, which browsers will not render, so the
# source is converted rather than just copied. Uses sips, which ships with macOS.
#
# Usage:
#   bash scripts/install-brand-logo.sh ~/Desktop/cce-logo.png
#   bash scripts/install-brand-logo.sh ~/Desktop/IMG_1234.HEIC cce-logo.png
#
# Then point NEXT_PUBLIC_SOFTWARE_LOGO_URL at /<name> and commit the file.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-}"
NAME="${2:-cce-logo.png}"

if [ -z "$SRC" ]; then
  echo "Usage: bash scripts/install-brand-logo.sh <source-image> [output-name.png]"
  exit 1
fi

# Expand a leading ~ that survived quoting.
SRC="${SRC/#\~/$HOME}"

if [ ! -f "$SRC" ]; then
  echo "ERROR: no file at: $SRC"
  exit 1
fi

case "$NAME" in
  *.png) ;;
  *) echo "ERROR: output name must end in .png (got: $NAME)"; exit 1 ;;
esac

DEST="$ROOT/public/$NAME"
mkdir -p "$ROOT/public"

fmt="$(sips -g format "$SRC" 2>/dev/null | awk '/format:/{print $2}')"
w="$(sips -g pixelWidth "$SRC" 2>/dev/null | awk '/pixelWidth:/{print $2}')"
h="$(sips -g pixelHeight "$SRC" 2>/dev/null | awk '/pixelHeight:/{print $2}')"

if [ -z "${fmt:-}" ]; then
  echo "ERROR: not a readable image: $SRC"
  exit 1
fi

echo "source: $SRC"
echo "  format ${fmt}, ${w}x${h}, $(wc -c <"$SRC" | tr -d ' ') bytes"

if [ "$fmt" = "png" ]; then
  cp "$SRC" "$DEST"
  echo "copied as-is (already PNG, so any transparency is preserved)"
else
  sips -s format png "$SRC" --out "$DEST" >/dev/null
  echo "converted ${fmt} -> png"
  if [ "$fmt" = "jpeg" ]; then
    echo "NOTE: JPEG has no transparency, so the logo carries its background."
    echo "      Fine here — the dark-mode treatment puts a light plate behind it."
  fi
fi

nw="$(sips -g pixelWidth "$DEST" | awk '/pixelWidth:/{print $2}')"
nh="$(sips -g pixelHeight "$DEST" | awk '/pixelHeight:/{print $2}')"
bytes="$(wc -c <"$DEST" | tr -d ' ')"
echo
echo "installed: public/$NAME  (${nw}x${nh}, ${bytes} bytes)"

if [ "$nh" -gt 400 ] 2>/dev/null; then
  echo "HINT: taller than needed — it renders at ~32px. Downscaling keeps the"
  echo "      bundle small:  sips -Z 256 public/$NAME"
fi
echo
echo "Next:"
echo "  1. Confirm NEXT_PUBLIC_SOFTWARE_LOGO_URL=/$NAME in .env and .env.local"
echo "  2. git add public/$NAME && commit"
echo "  3. For Vercel, set the same env var in the project settings"
