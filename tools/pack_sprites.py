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

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
PACKS = ROOT / "packs"
OUT = ROOT / "plugins" / "x2ai-avatar" / "sprites.json"
PKG = ROOT / "plugins" / "x2ai-avatar" / "packs"
# Паки с пиксельными персонажами: их id живут с префиксом px_.
PX_PACKS = {"pixel", "bit16", "bit16night", "bit16ninety"}
STATES = ["closed", "half", "open", "round", "wide", "blink"]
HEIGHT = 336


def uri(path: Path) -> str:
    img = Image.open(path).convert("RGBA")
    # Высокие спрайты (выше 336) оставляем как есть — см. x2ai-sync_pack.py.
    if img.height < HEIGHT:
        ratio = HEIGHT / img.height
        size = (max(1, int(round(img.width * ratio))), HEIGHT)
        # LANCZOS по обычной RGBA подмешивает RGB прозрачных пикселей и
        # рисует светлый ореол по краю. Ресайзим с премультиплицированной
        # альфой и возвращаем цвет обратно.
        arr = np.asarray(img, dtype=np.float32)
        alpha = arr[..., 3:4] / 255.0
        arr[..., :3] *= alpha
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).resize(size, Image.LANCZOS)
        arr = np.asarray(img, dtype=np.float32)
        alpha = arr[..., 3:4] / 255.0
        arr[..., :3] = np.where(alpha > 0, arr[..., :3] / np.maximum(alpha, 1e-6), 0)
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    buf = io.BytesIO()
    # WebP q86: так кадры выглядели до всех экспериментов — мягче по краям,
    # без резкой пиксельной «лесенки». PNG-без-потерь, наоборот, проявлял её.
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
        # Пиксельный пак: папка fx_demon = персонаж fx_demoness, и у всех
        # персонажей свой префикс px_, чтобы не путались с аниме-паком.
        if pack_dir.name in PX_PACKS:
            # Порядок берём из sprites.json как есть: переименование fx_demon
            # делаем на месте, а не через pop (иначе персонаж уезжал в конец).
            renamed = {}
            for key, value in voices.items():
                key = "fx_demoness" if key == "fx_demon" else key
                renamed[key if key.startswith("px_") else f"px_{key}"] = value
            voices = renamed
        packs[pack_dir.name] = voices

    OUT.write_text(json.dumps(packs, ensure_ascii=False), encoding="utf-8")
    # По паку на файл: окно грузит только тот пак, который выбрано, а не все
    # кадры сразу (аниме-пак — половина веса бандла).
    PKG.mkdir(parents=True, exist_ok=True)
    for name, voices in packs.items():
        (PKG / f"{name}.json").write_text(json.dumps(voices, ensure_ascii=False), encoding="utf-8")
    # Манифест: имена паков и персонажи в них. Маленький, едет в бандл.
    index = {name: sorted(voices.keys()) for name, voices in packs.items()}
    (PKG / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    total = sum(len(v) for v in packs.values())
    names = ", ".join(f"{k} ({len(v)})" for k, v in packs.items())
    print(f"готово: паков {len(packs)}, персонажей {total} — {names}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
