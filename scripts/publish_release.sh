#!/usr/bin/env bash
# Publish kanji and linzi zips when either asset changed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KANJI_ZIP="$ROOT/dist/pekzep-1.16.1.zip"
LINZI_ZIP="$ROOT/dist/pekzep-linzi-1.16.1.zip"
STATS="$ROOT/dist/stats.txt"
LINZI_STATS="$ROOT/dist/stats-linzi.txt"

for zip in "$KANJI_ZIP" "$LINZI_ZIP"; do
  if [[ ! -f "$zip" ]]; then
    echo "missing $zip" >&2
    exit 1
  fi
done

kanji_hash="$(sha256sum "$KANJI_ZIP" | awk '{print $1}')"
linzi_hash="$(sha256sum "$LINZI_ZIP" | awk '{print $1}')"

PREV_TAG="$(gh release list --limit 1 --json tagName --jq '.[0].tagName // empty')"
if [[ -n "$PREV_TAG" ]]; then
  tmpdir="$(mktemp -d)"
  same=0
  if gh release download "$PREV_TAG" --pattern 'pekzep-1.16.1.zip' --dir "$tmpdir" 2>/dev/null \
    && [[ "$(sha256sum "$tmpdir/pekzep-1.16.1.zip" | awk '{print $1}')" == "$kanji_hash" ]]; then
    same=$((same + 1))
  fi
  if gh release download "$PREV_TAG" --pattern 'pekzep-linzi-1.16.1.zip' --dir "$tmpdir" 2>/dev/null \
    && [[ "$(sha256sum "$tmpdir/pekzep-linzi-1.16.1.zip" | awk '{print $1}')" == "$linzi_hash" ]]; then
    same=$((same + 1))
  fi
  rm -rf "$tmpdir"
  if [[ "$same" -eq 2 ]]; then
    echo "both packs unchanged; skipping release"
    exit 0
  fi
fi

DAY="$(date -u +%Y.%m.%d)"
TAG="$DAY"
if gh release view "$TAG" >/dev/null 2>&1; then
  TAG="${DAY}.$(date -u +%H%M)"
fi

NOTES="Pekzep (牌言) resource packs for Minecraft 1.16.1

pekzep-1.16.1.zip sha256: ${kanji_hash}
pekzep-linzi-1.16.1.zip sha256: ${linzi_hash}

"
if [[ -f "$STATS" ]]; then
  NOTES+=$'kanji pack:\n'
  NOTES+="$(cat "$STATS")"$'\n'
fi
if [[ -f "$LINZI_STATS" ]]; then
  NOTES+=$'linzi pack:\n'
  NOTES+="$(cat "$LINZI_STATS")"$'\n'
fi

gh release create "$TAG" "$KANJI_ZIP" "$LINZI_ZIP" \
  --title "牌言 ${TAG}" \
  --notes "$NOTES"

echo "published $TAG"
