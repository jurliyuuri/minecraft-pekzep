#!/usr/bin/env python3
"""Build a 1.16.1 language resource pack from Crowdin output + pinned en_us.json."""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_EN = ROOT / "source" / "en_us.json"
PACK_MCMETA = ROOT / "pack" / "pack.mcmeta"
TRANSLATIONS_DIR = ROOT / "translations"
DIST_DIR = ROOT / "dist"
ZIP_NAME = "pekzep-1.16.1.zip"

PLACEHOLDER = re.compile(r"%(?:\d+\$)?[sd]|%%")


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise SystemExit(f"{path} is not a JSON object")
    return data


def find_translation_file(explicit: Path | None) -> Path:
    if explicit is not None:
        if not explicit.is_file():
            raise SystemExit(f"translation file not found: {explicit}")
        return explicit

    preferred = [
        TRANSLATIONS_DIR / "pz_ai.json",
        TRANSLATIONS_DIR / "pz_ai" / "en_us.json",
        TRANSLATIONS_DIR / "pz-ai" / "en_us.json",
        TRANSLATIONS_DIR / "pz-AI" / "en_us.json",
    ]
    for path in preferred:
        if path.is_file():
            return path

    if TRANSLATIONS_DIR.is_dir():
        candidates = sorted(
            p for p in TRANSLATIONS_DIR.rglob("*.json") if p.is_file()
        )
        if len(candidates) == 1:
            return candidates[0]
        if candidates:
            pz = [
                p
                for p in candidates
                if "pz" in str(p.relative_to(TRANSLATIONS_DIR)).lower()
            ]
            if len(pz) == 1:
                return pz[0]
            names = ", ".join(str(p.relative_to(ROOT)) for p in candidates)
            raise SystemExit(
                "multiple translation JSON files; pass --translations. found: "
                + names
            )

    raise SystemExit(
        "no translation file. download from Crowdin into translations/"
    )


def language_meta(mcmeta: dict) -> tuple[str, str, str]:
    langs = mcmeta.get("language")
    if not isinstance(langs, dict) or len(langs) != 1:
        raise SystemExit("pack.mcmeta must define exactly one language")
    code, info = next(iter(langs.items()))
    if not isinstance(info, dict):
        raise SystemExit(f"invalid language entry for {code}")
    name = info.get("name")
    region = info.get("region")
    if not name or not region:
        raise SystemExit("language name and region are required in pack.mcmeta")
    return code, name, region


def merge(source: dict, translations: dict) -> dict:
    merged = dict(source)
    for key, value in translations.items():
        if isinstance(value, str) and value != "":
            merged[key] = value
    return merged


def warn_placeholders(source: dict, merged: dict) -> int:
    warnings = 0
    for key, src in source.items():
        if not isinstance(src, str):
            continue
        dst = merged.get(key)
        if not isinstance(dst, str) or dst == src:
            continue
        src_ph = PLACEHOLDER.findall(src)
        dst_ph = PLACEHOLDER.findall(dst)
        if src_ph != dst_ph:
            warnings += 1
            print(
                f"placeholder mismatch: {key}: {src_ph} -> {dst_ph}",
                file=sys.stderr,
            )
    return warnings


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def build_zip(mcmeta_text: str, lang_code: str, lang_json: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    lang_arcname = f"assets/minecraft/lang/{lang_code}.json"
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("pack.mcmeta", mcmeta_text)
        zf.write(lang_json, arcname=lang_arcname)


LANG_META_KEYS = ("language.name", "language.region", "language.code")


def count_progress(source: dict, merged: dict) -> tuple[int, int]:
    compared = [key for key in source if key not in LANG_META_KEYS]
    untranslated = sum(1 for key in compared if merged.get(key) == source[key])
    translated = len(compared) - untranslated
    return translated, untranslated


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--translations",
        type=Path,
        help="Crowdin JSON (default: translations/pz_ai.json)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DIST_DIR / ZIP_NAME,
        help=f"zip path (default: dist/{ZIP_NAME})",
    )
    args = parser.parse_args()

    source = load_json(SOURCE_EN)
    mcmeta = load_json(PACK_MCMETA)
    lang_code, name, region = language_meta(mcmeta)
    trans_path = find_translation_file(args.translations)
    translations = load_json(trans_path)

    merged = merge(source, translations)
    merged["language.name"] = name
    merged["language.region"] = region
    merged["language.code"] = lang_code

    placeholder_warnings = warn_placeholders(source, merged)
    translated, untranslated = count_progress(source, merged)

    staging = DIST_DIR / "pack"
    if staging.exists():
        for child in staging.rglob("*"):
            if child.is_file():
                child.unlink()
    lang_out = staging / "assets" / "minecraft" / "lang" / f"{lang_code}.json"
    write_json(lang_out, merged)

    mcmeta_text = PACK_MCMETA.read_text(encoding="utf-8")
    if not mcmeta_text.endswith("\n"):
        mcmeta_text += "\n"
    build_zip(mcmeta_text, lang_code, lang_out, args.output)

    stats = (
        f"keys: {len(source)}\n"
        f"translated (value differs from en_us, excl. language.*): {translated}\n"
        f"still English: {untranslated}\n"
        f"placeholder warnings: {placeholder_warnings}\n"
        f"source translations: {trans_path.relative_to(ROOT) if trans_path.is_relative_to(ROOT) else trans_path}\n"
        f"output: {args.output}\n"
    )
    (DIST_DIR / "stats.txt").write_text(stats, encoding="utf-8")
    print(stats, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
