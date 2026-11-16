#!/usr/bin/env python3
"""Собирает общий sprites.json из папок паков.

Каждый пак — отдельная папка со своим sprites.json:

    packs/pixel/sprites.json   — наш пак (в репозитории)
    packs/anime/sprites.json   — чужой пак LivLiv (в .gitignore, только локально)

Если в папке пака нет sprites.json, но есть PNG-кадры по персонажам,
файл собирается из них и сохраняется рядом.

Итог пишется в plugins/x2ai-avatar/sprites.json (этот файл в .gitignore).

Запуск: python3 tools/pack_sprites.py
"""

from __future__ import annotations

import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PACKS = ROOT / "packs"
OUT = ROOT / "plugins" / "x2ai-avatar" / "sprites.json"
STATES = ["closed", "half", "open", "round", "wide", "blink"]
HEIGHT = 336


def uri(path: Path) -> str:
    img = Image.open(path).convert("RGBA")
    if img.height != HEIGHT:
        ratio = HEIGHT / img.height
        img = img.resize((max(1, int(round(img.width * ratio))), HEIGHT), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=86, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def from_png(pack_dir: Path) -> dict[str, dict[str, str]]:
    voices: dict[str, dict[str, str]] = {}
    for voice_dir in sorted(p for p in pack_dir.iterdir() if p.is_dir()):
        files = {p.stem: p for p in voice_dir.glob("*.png")}
        if "closed" not in files:
            continue
        closed = uri(files["closed"])
        opened = uri(files["open"]) if "open" in files else closed
        entry = {"closed": closed}
        for state in STATES[1:]:
            if state == "blink":
                entry[state] = uri(files["blink"]) if "blink" in files else closed
            else:
                entry[state] = uri(files[state]) if state in files else opened
        voices[voice_dir.name] = entry
    return voices


def main() -> int:
    packs: dict[str, dict[str, dict[str, str]]] = {}
    for pack_dir in sorted(p for p in PACKS.iterdir() if p.is_dir()):
        file = pack_dir / "sprites.json"
        if file.exists():
            voices = json.loads(file.read_text(encoding="utf-8"))
        else:
            voices = from_png(pack_dir)
            if voices:
                file.write_text(json.dumps(voices, ensure_ascii=False), encoding="utf-8")
                print(f"{pack_dir.name}: собран sprites.json из PNG")
        if not voices:
            continue
        # В пиксельном паке папка исторически fx_demon, а персонаж — fx_demoness.
        if pack_dir.name == "pixel" and "fx_demon" in voices:
            voices["fx_demoness"] = voices.pop("fx_demon")
        packs[pack_dir.name] = voices

    OUT.write_text(json.dumps(packs, ensure_ascii=False), encoding="utf-8")
    total = sum(len(v) for v in packs.values())
    names = ", ".join(f"{k} ({len(v)})" for k, v in packs.items())
    print(f"готово: паков {len(packs)}, персонажей {total} — {names}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
