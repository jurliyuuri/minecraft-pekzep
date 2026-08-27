#!/usr/bin/env bash
# Publish dist/pekzep-1.16.1.zip as a GitHub Release when the bytes changed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="$ROOT/dist/pekzep-1.16.1.zip"
STATS="$ROOT/dist/stats.txt"

if [[ ! -f "$ZIP" ]]; then
  echo "missing $ZIP" >&2
  exit 1
fi

NEW_HASH="$(sha256sum "$ZIP" | awk '{print $1}')"

PREV_TAG="$(gh release list --limit 1 --json tagName --jq '.[0].tagName // empty')"
if [[ -n "$PREV_TAG" ]]; then
  tmp="$(mktemp)"
  if gh release download "$PREV_TAG" --pattern 'pekzep-1.16.1.zip' --output "$tmp"; then
    OLD_HASH="$(sha256sum "$tmp" | awk '{print $1}')"
    rm -f "$tmp"
    if [[ "$NEW_HASH" == "$OLD_HASH" ]]; then
      echo "pack unchanged ($NEW_HASH); skipping release"
      exit 0
    fi
  else
    rm -f "$tmp"
  fi
fi

DAY="$(date -u +%Y.%m.%d)"
TAG="$DAY"
if gh release view "$TAG" >/dev/null 2>&1; then
  TAG="${DAY}.$(date -u +%H%M)"
fi

NOTES="Pekzep (牌言) resource pack for Minecraft 1.16.1

sha256: ${NEW_HASH}

"
if [[ -f "$STATS" ]]; then
  NOTES+="$(cat "$STATS")"
fi

gh release create "$TAG" "$ZIP" \
  --title "牌言 ${TAG}" \
  --notes "$NOTES"

echo "published $TAG"
