#!/usr/bin/env python3
"""Собирает docs/preview.png — контактный лист персонажей.

Берёт кадр «closed» из plugins/x2ai-avatar/sprites.json и раскладывает
10 персонажей в сетку 5×2 на тёмном фоне с подписями.

Запуск: python3 tools/make_preview.py
"""

import base64
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / "plugins" / "x2ai-avatar" / "sprites.json"
OUT = ROOT / "docs" / "preview.png"

NAMES = {
    "ru_f1": "Аня",
    "ru_f2": "Мила",
    "ru_m1": "Гриша",
    "ru_m5": "Тимур",
    "fx_robot": "Робик",
    "fx_demon": "Азазель",
    "fx_alien": "Зета",
    "fx_cat": "Мурзик",
    "fx_penguin": "Пико",
    "fx_ghost": "Юки",
}
ORDER = list(NAMES)

BG = (24, 24, 28)
FG = (210, 210, 215)
COLS = 5
CELL_W, CELL_H = 210, 330
SPRITE_H = 280
PAD_TOP = 18


def decode(uri: str) -> Image.Image:
    payload = uri.split(",", 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(payload))).convert("RGBA")


def main() -> None:
    data = json.loads(SPRITES.read_text(encoding="utf-8"))
    rows = (len(ORDER) + COLS - 1) // COLS
    W, H = CELL_W * COLS, CELL_H * rows
    canvas = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 20)
    except OSError:
        font = ImageFont.load_default()

    for i, voice in enumerate(ORDER):
        sprite = decode(data[voice]["closed"])
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
