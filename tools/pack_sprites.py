#!/usr/bin/env python3
"""Собирает sprites.json из наших PNG-кадров в packs/.

Аниме-пак (чужие ассеты LivLiv) в репозитории не хранится: если он есть
локально в packs/anime, он тоже попадёт в sprites.json. Пиксельный пак —
наш, он лежит в packs/pixel и всегда собирается.

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
    img.save(buf, "WEBP", quality=86, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def main() -> int:
    packs: dict[str, dict[str, dict[str, str]]] = {}
    for pack_dir in sorted(p for p in PACKS.iterdir() if p.is_dir()):
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
        if voices:
            # В пиксельном паке папка исторически называется fx_demon,
            # а в интерфейсе персонаж — fx_demoness.
            if pack_dir.name == "pixel" and "fx_demon" in voices:
                voices["fx_demoness"] = voices.pop("fx_demon")
            packs[pack_dir.name] = voices

    # Аниме-пак не хранится в репозитории (чужие ассеты): если он уже собран
    # локально, сохраняем его как есть и только обновляем наши паки.
    if OUT.exists():
        try:
            existing = json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            existing = {}
        for name, voices in existing.items():
            if name not in packs and name == "anime":
                packs[name] = voices

    OUT.write_text(json.dumps(packs, ensure_ascii=False), encoding="utf-8")
    total = sum(len(v) for v in packs.values())
    print(f"готово: {OUT.name} — паков {len(packs)}, персонажей {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
