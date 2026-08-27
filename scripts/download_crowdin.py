#!/usr/bin/env python3
"""Download Pekzep translations from Crowdin via the API (no CLI path mapping)."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "translations"
OUT_FILE = OUT_DIR / "pz_ai.json"
PROJECT_ID = os.environ.get("CROWDIN_PROJECT_ID", "923393")
BASE = "https://api.crowdin.com/api/v2"


def token() -> str:
    value = os.environ.get("CROWDIN_PERSONAL_TOKEN", "").strip()
    if not value:
        raise SystemExit("CROWDIN_PERSONAL_TOKEN is not set")
    return value


def request(method: str, path: str, body: dict | None = None) -> dict:
    url = BASE + path
    data = None
    headers = {
        "Authorization": f"Bearer {token()}",
        "Accept": "application/json",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Crowdin API {e.code} {method} {path}: {detail}") from e
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


def fetch_url(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token()}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def paginate(path: str) -> list:
    items: list = []
    offset = 0
    while True:
        sep = "&" if "?" in path else "?"
        payload = request("GET", f"{path}{sep}limit=500&offset={offset}")
        chunk = payload.get("data", [])
        items.extend(chunk)
        pagination = payload.get("pagination") or {}
        offset += pagination.get("limit", len(chunk))
        if offset >= pagination.get("total", offset) or not chunk:
            break
    return items


def unwrap(item: dict) -> dict:
    return item.get("data", item)


def pick_language(project: dict) -> str:
    source = unwrap(project).get("sourceLanguageId") or "en"
    targets = unwrap(project).get("targetLanguageIds") or []
    print(f"source language: {source}")
    print(f"target languages: {targets}")
    if not targets:
        raise SystemExit("Crowdin project has no target languages")
    pz = [lang for lang in targets if "pz" in lang.lower()]
    if len(pz) == 1:
        return pz[0]
    remaining = [lang for lang in targets if lang != source]
    if len(remaining) == 1:
        return remaining[0]
    if len(pz) > 1:
        raise SystemExit(f"multiple pz languages: {pz}")
    raise SystemExit(f"cannot choose target language from {targets}")


def main() -> int:
    project = request("GET", f"/projects/{PROJECT_ID}")
    language = pick_language(project)
    print(f"downloading language: {language}")

    files = [unwrap(item) for item in paginate(f"/projects/{PROJECT_ID}/files")]
    if not files:
        raise SystemExit("Crowdin project has no files")
    for info in files:
        print(f"file id={info.get('id')} path={info.get('path')} name={info.get('name')}")

    merged: dict = {}
    for info in files:
        file_id = info["id"]
        built = request(
            "POST",
            f"/projects/{PROJECT_ID}/translations/builds/files/{file_id}",
            {
                "targetLanguageId": language,
                "skipUntranslatedStrings": False,
                "skipUntranslatedFiles": False,
                "exportApprovedOnly": False,
            },
        )
        url = unwrap(built).get("url")
        if not url:
            raise SystemExit(f"no download url for file {file_id}: {built}")
        raw = fetch_url(url)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise SystemExit(
                f"translation for {info.get('path')} is not JSON: {raw[:200]!r}"
            ) from e
        if not isinstance(payload, dict):
            raise SystemExit(f"translation for {info.get('path')} is not a JSON object")
        merged.update(payload)
        print(f"merged {len(payload)} keys from {info.get('path')}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with OUT_FILE.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"wrote {OUT_FILE.relative_to(ROOT)} ({len(merged)} keys)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
