#!/usr/bin/env python3
"""Собирает docs/preview.png — контактный лист пиксельного пака.

Берёт кадр «closed» из plugins/x2ai-avatar/sprites.json (пак pixel)
и раскладывает пять персонажей в один ряд на тёмном фоне с подписями.

Запуск: python3 tools/pack_sprites.py && python3 tools/make_preview.py
"""

import base64
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / "plugins" / "x2ai-avatar" / "sprites.json"
OUT = ROOT / "docs" / "preview.png"

PACK = "pixel"
NAMES = {
    "px_ru_f1": "Тянка",
    "px_fx_demoness": "Демонесса",
    "px_fx_robot": "Робот",
    "px_fx_penguin": "Инопланетянин",
    "px_ru_m1": "Программист",
}
ORDER = list(NAMES)

BG = (24, 24, 28)
FG = (210, 210, 215)
COLS = 5
CELL_W, CELL_H = 220, 360
SPRITE_H = 300
PAD_TOP = 18


def decode(uri: str) -> Image.Image:
    payload = uri.split(",", 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(payload))).convert("RGBA")


def main() -> None:
    data = json.loads(SPRITES.read_text(encoding="utf-8"))
    pack = data.get(PACK)
    if not pack:
        raise SystemExit(
            f"в {SPRITES} нет пака {PACK}: сначала запусти python3 tools/pack_sprites.py"
        )

    rows = (len(ORDER) + COLS - 1) // COLS
    W, H = CELL_W * COLS, CELL_H * rows
    canvas = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 20)
    except OSError:
        font = ImageFont.load_default()

    for i, voice in enumerate(ORDER):
        sprite = decode(pack[voice]["closed"])
        scale = SPRITE_H / sprite.height
        sprite = sprite.resize((round(sprite.width * scale), SPRITE_H), Image.LANCZOS)
        col, row = i % COLS, i // COLS
        x = col * CELL_W + (CELL_W - sprite.width) // 2
        y = row * CELL_H + PAD_TOP
        canvas.paste(sprite, (x, y), sprite)
        label = NAMES[voice]
        tw = draw.textlength(label, font=font)
        draw.text(
            (col * CELL_W + (CELL_W - tw) / 2, y + SPRITE_H + 6),
            label,
            font=font,
            fill=FG,
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT, optimize=True)
    print(f"{OUT} · {W}x{H} · {OUT.stat().st_size // 1024} КБ")


if __name__ == "__main__":
    main()
