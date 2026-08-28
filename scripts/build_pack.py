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
DIST_FONT = DIST_DIR / "linzi_font"
ZIP_NAME = "pekzep-1.16.1.zip"
LINZI_ZIP_NAME = "pekzep-linzi-1.16.1.zip"
LINZI_DESCRIPTION = "牌言・燐字 (Pekzep linzi) for Minecraft 1.16.1"

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


def remap_chunk(text: str, pua_map: dict[str, str]) -> str:
    return "".join(pua_map.get(ch, ch) for ch in text)


def remap_text(text: str, pua_map: dict[str, str]) -> str:
    out: list[str] = []
    last = 0
    for match in PLACEHOLDER.finditer(text):
        out.append(remap_chunk(text[last : match.start()], pua_map))
        out.append(match.group(0))
        last = match.end()
    out.append(remap_chunk(text[last:], pua_map))
    return "".join(out)


def remap_lang(data: dict, pua_map: dict[str, str]) -> dict:
    remapped = {}
    for key, value in data.items():
        if isinstance(value, str):
            remapped[key] = remap_text(value, pua_map)
        else:
            remapped[key] = value
    return remapped


def linzi_mcmeta_text(pua_map: dict[str, str]) -> str:
    mcmeta = load_json(PACK_MCMETA)
    mcmeta["pack"]["description"] = remap_text(LINZI_DESCRIPTION, pua_map)
    languages = mcmeta.get("language")
    if isinstance(languages, dict):
        for info in languages.values():
            if not isinstance(info, dict):
                continue
            for key in ("name", "region"):
                value = info.get(key)
                if isinstance(value, str):
                    info[key] = remap_text(value, pua_map)
    return json.dumps(mcmeta, ensure_ascii=False, indent=2) + "\n"


def linzi_font_files(font_dir: Path) -> list[tuple[Path, str]]:
    default_json = font_dir / "default.json"
    if not default_json.is_file():
        raise SystemExit(
            f"missing {default_json}; run scripts/build_linzi_font.py first"
        )
    files = [(default_json, "assets/minecraft/font/default.json")]
    pngs = sorted(font_dir.glob("linzi_e*.png"))
    if not pngs:
        raise SystemExit(f"no linzi_e*.png in {font_dir}")
    for png in pngs:
        files.append((png, f"assets/minecraft/textures/font/{png.name}"))
    return files


def build_zip(
    mcmeta_text: str,
    lang_code: str,
    lang_json: Path,
    dest: Path,
    extra: list[tuple[Path, str]] | None = None,
) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    lang_arcname = f"assets/minecraft/lang/{lang_code}.json"
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("pack.mcmeta", mcmeta_text)
        zf.write(lang_json, arcname=lang_arcname)
        for src, arcname in extra or []:
            zf.write(src, arcname=arcname)


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
        "--linzi",
        action="store_true",
        help="remap kanji to PUA and embed the linzi bitmap font",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="zip path (default: dist/pekzep-1.16.1.zip or pekzep-linzi-1.16.1.zip)",
    )
    parser.add_argument(
        "--font-dir",
        type=Path,
        default=DIST_FONT,
        help="directory with default.json and linzi_e*.png",
    )
    args = parser.parse_args()
    if args.output is None:
        args.output = DIST_DIR / (LINZI_ZIP_NAME if args.linzi else ZIP_NAME)

    source = load_json(SOURCE_EN)
    mcmeta = load_json(PACK_MCMETA)
    lang_code, name, region = language_meta(mcmeta)
    trans_path = find_translation_file(args.translations)
    translations = load_json(trans_path)

    merged = merge(source, translations)
    merged["language.name"] = name
    merged["language.region"] = region
    merged["language.code"] = lang_code

    extra: list[tuple[Path, str]] = []
    pua_count = 0
    pua_map: dict[str, str] | None = None
    if args.linzi:
        pua_path = args.font_dir / "pua_map.json"
        if not pua_path.is_file():
            raise SystemExit(
                f"missing {pua_path}; run scripts/build_linzi_font.py first"
            )
        pua_map = load_json(pua_path)
        merged = remap_lang(merged, pua_map)
        pua_count = sum(1 for value in merged.values() if isinstance(value, str) and any("\ue000" <= ch <= "\uf8ff" for ch in value))
        extra = linzi_font_files(args.font_dir)

    placeholder_warnings = warn_placeholders(source, merged)
    translated, untranslated = count_progress(source, merged)

    staging = DIST_DIR / ("pack_linzi" if args.linzi else "pack")
    if staging.exists():
        for child in staging.rglob("*"):
            if child.is_file():
                child.unlink()
    lang_out = staging / "assets" / "minecraft" / "lang" / f"{lang_code}.json"
    write_json(lang_out, merged)

    if args.linzi:
        assert pua_map is not None
        mcmeta_text = linzi_mcmeta_text(pua_map)
    else:
        mcmeta_text = PACK_MCMETA.read_text(encoding="utf-8")
        if not mcmeta_text.endswith("\n"):
            mcmeta_text += "\n"
    build_zip(mcmeta_text, lang_code, lang_out, args.output, extra)

    stats = (
        f"keys: {len(source)}\n"
        f"translated (value differs from en_us, excl. language.*): {translated}\n"
        f"still English: {untranslated}\n"
        f"placeholder warnings: {placeholder_warnings}\n"
        f"source translations: {trans_path.relative_to(ROOT) if trans_path.is_relative_to(ROOT) else trans_path}\n"
        f"linzi: {args.linzi}\n"
        f"strings with PUA: {pua_count}\n"
        f"output: {args.output}\n"
    )
    stats_path = DIST_DIR / ("stats-linzi.txt" if args.linzi else "stats.txt")
    stats_path.write_text(stats, encoding="utf-8")
    print(stats, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
