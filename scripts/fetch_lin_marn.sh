#!/usr/bin/env bash
# Sparse-checkout jurliyuuri/lin-marn at the pinned SHA, then add noborder folders.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA="$(tr -d '[:space:]' < "$ROOT/font/lin-marn.sha")"
DEST="${LIN_MARN:-$ROOT/vendor/lin-marn}"
REPO="${LIN_MARN_REPO:-https://github.com/jurliyuuri/lin-marn.git}"

mkdir -p "$(dirname "$DEST")"
if [[ ! -d "$DEST/.git" ]]; then
  git clone --filter=blob:none --sparse "$REPO" "$DEST"
fi

git -C "$DEST" fetch --filter=blob:none origin "$SHA"
git -C "$DEST" sparse-checkout set image_table
git -C "$DEST" checkout --detach "$SHA"

mapfile -t EXTRA < <(node "$ROOT/scripts/list_noborder_folders.js" "$DEST")
if [[ ${#EXTRA[@]} -eq 0 ]]; then
  echo "list_noborder_folders.js returned no paths" >&2
  exit 1
fi
git -C "$DEST" sparse-checkout set image_table "${EXTRA[@]}"
git -C "$DEST" checkout --detach "$SHA"

echo "lin-marn $SHA at $DEST"
printf 'sparse paths:\n'
printf '  %s\n' image_table "${EXTRA[@]}"
