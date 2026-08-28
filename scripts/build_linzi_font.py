#!/usr/bin/env python3
"""Assemble noborder 16x16 glyphs into Minecraft bitmap font providers."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DIST_FONT = ROOT / "dist" / "linzi_font"
CELL = 16
COLS = 16
ROWS = 16
PAGE = COLS * ROWS
PUA_BASE = 0xE000
HEIGHT = 16
ASCENT = 14


def load_glyphs(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if "encoding" not in data or "glyphs" not in data:
        raise SystemExit(f"{path} is not collect_noborder.js output")
    return data


def to_mc_glyph(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    if rgba.size != (CELL, CELL):
        rgba = rgba.resize((CELL, CELL), Image.Resampling.NEAREST)
    out = Image.new("RGBA", (CELL, CELL), (255, 255, 255, 0))
    src = rgba.load()
    dst = out.load()
    assert src is not None and dst is not None
    for y in range(CELL):
        for x in range(CELL):
            r, g, b, a = src[x, y]
            if a == 0:
                continue
            luma = 0.299 * r + 0.587 * g + 0.114 * b
            alpha = int(round((a / 255.0) * (255.0 - luma)))
            dst[x, y] = (255, 255, 255, max(0, min(255, alpha)))
    return out


def page_chars(start: int, count: int) -> list[str]:
    rows = []
    for row in range(ROWS):
        chars = []
        for col in range(COLS):
            index = start + row * COLS + col
            if index >= count:
                chars.append("\u0000")
            else:
                chars.append(chr(PUA_BASE + index))
        rows.append("".join(chars))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--glyphs",
        type=Path,
        default=ROOT / "dist" / "noborder.json",
        help="JSON from collect_noborder.js",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DIST_FONT,
        help="output directory for default.json and atlas pngs",
    )
    args = parser.parse_args()

    data = load_glyphs(args.glyphs)
    encoding: list[str] = data["encoding"]
    glyphs: dict[str, str | None] = data["glyphs"]
    lin_root = Path(data["root"])

    n_pages = (len(encoding) + PAGE - 1) // PAGE
    args.out.mkdir(parents=True, exist_ok=True)

    providers = []
    pua_map: dict[str, str] = {}
    placed = 0
    for page in range(n_pages):
        start = page * PAGE
        atlas = Image.new("RGBA", (COLS * CELL, ROWS * CELL), (255, 255, 255, 0))
        for offset in range(PAGE):
            index = start + offset
            if index >= len(encoding):
                break
            ch = encoding[index]
            rel = glyphs.get(ch) if ch != "??" else None
            if not rel:
                continue
            src_path = lin_root / rel
            if not src_path.is_file():
                print(f"missing file for {ch}: {src_path}", file=sys.stderr)
                continue
            glyph = to_mc_glyph(Image.open(src_path))
            col = offset % COLS
            row = offset // COLS
            atlas.paste(glyph, (col * CELL, row * CELL))
            pua_map[ch] = chr(PUA_BASE + index)
            placed += 1

        name = f"linzi_e{page}.png"
        atlas.save(args.out / name)
        providers.append(
            {
                "type": "bitmap",
                "file": f"minecraft:font/{name}",
                "height": HEIGHT,
                "ascent": ASCENT,
                "chars": page_chars(start, len(encoding)),
            }
        )

    default_json = {"providers": providers}
    (args.out / "default.json").write_text(
        json.dumps(default_json, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (args.out / "pua_map.json").write_text(
        json.dumps(pua_map, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"pages: {n_pages}\n"
        f"encoding slots: {len(encoding)}\n"
        f"glyphs placed: {placed}\n"
        f"pua_map: {len(pua_map)}\n"
        f"out: {args.out}\n",
        end="",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
