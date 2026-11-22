#!/usr/bin/env python3
"""Собрать docs/preview.png из текущих кадров всех паков.

Читает готовые data-URI из plugins/x2ai-avatar/packs/<pack>.json и имена
паков из characters.json. Никаких внешних зависимостей, кроме PIL.
"""
from __future__ import annotations

import base64
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "plugins/x2ai-avatar/packs"
OUT = ROOT / "docs" / "preview.png"

W, H = 1500, 880
BG = (22, 22, 27)
ROW_BG = (31, 31, 39)
FG = (238, 238, 244)
MUTED = (148, 148, 164)
HEADER_H = 86
ROW_H = 188
SPRITE_H = 140
STEP_X = 118
SPRITE_X0 = 250


def face(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    paths = [
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for p in paths:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def decode(uri: str) -> Image.Image:
    raw = base64.b64decode(uri.split(",", 1)[1])
    return Image.open(io.BytesIO(raw)).convert("RGBA")


def main() -> int:
    meta = json.loads((PKG / "characters.json").read_text(encoding="utf-8"))
    names = meta.get("packs") or {}
    index = json.loads((PKG / "index.json").read_text(encoding="utf-8"))
    packs = [p for p in index if (PKG / f"{p}.json").exists()]
    if not packs:
        raise SystemExit("нет собранных паков: запустите tools/pack_sprites.py")

    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((34, 20), "x2ai-voice-avatar", font=face(34, True), fill=FG)
    total = sum(len(json.loads((PKG / f"{p}.json").read_text(encoding="utf-8"))) for p in packs)
    d.text(
        (34, 60),
        f"{len(packs)} пака · {total} персонажей · всё своё, офлайн",
        font=face(17),
        fill=MUTED,
    )

    for row, pack in enumerate(packs):
        top = HEADER_H + row * ROW_H
        bottom = top + ROW_H - 10
        d.rounded_rectangle((18, top + 4, W - 18, bottom), radius=14, fill=ROW_BG)
        label = (names.get(pack) or {}).get("name") or pack
        d.text((34, top + 22), label, font=face(23, True), fill=FG)
        voices = json.loads((PKG / f"{pack}.json").read_text(encoding="utf-8"))
        d.text((34, top + 54), f"{len(voices)} персонажей", font=face(15), fill=MUTED)

        for i, (voice, states) in enumerate(voices.items()):
            uri = states.get("closed")
            if not uri:
                continue
            sprite = decode(uri)
            w = max(1, round(sprite.width * SPRITE_H / sprite.height))
            sprite = sprite.resize((w, SPRITE_H), Image.LANCZOS)
            x = SPRITE_X0 + i * STEP_X
            y = bottom - SPRITE_H - 18
            img.paste(sprite, (x, y), sprite)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    print(f"готово: {OUT} ({W}×{H}, {OUT.stat().st_size} байт)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
