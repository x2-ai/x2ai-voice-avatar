#!/usr/bin/env python3
"""Достраивает кадры рта и моргания для пиксельного пака из двух кадров.

У «Тянки» есть все шесть состояний (closed/half/open/round/wide/blink),
у остальных — только closed и open. Скрипт сам синтезирует недостающие:

  half  — смесь closed и open на 50 %
  round — рот из open, сжатый по ширине и вытянутый по высоте
  wide  — рот из open, растянутый по ширине и приплюснутый
  blink — закрытые глаза: тёмные пятна глаз заменяются линией и кожей

Запуск: python3 tools/make_pixel_frames.py [--check]
"""

from __future__ import annotations

import base64
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PIXEL = ROOT / "packs" / "pixel"
SPRITES = ROOT / "plugins" / "x2ai-avatar" / "sprites.json"
STATES = ["closed", "half", "open", "round", "wide", "blink"]
HEIGHT = 336


def load(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def mouth_bbox(closed: Image.Image, opened: Image.Image) -> tuple[int, int, int, int] | None:
    """Ищет рот как разницу кадров, но только в нижней части лица.

    Иначе в область попадают волосы и антенны, и «круглый» рот растягивает
    всё лицо.
    """
    a = np.asarray(closed).astype(np.int16)
    b = np.asarray(opened).astype(np.int16)
    h, w = a.shape[:2]
    diff = np.abs(a[..., :3] - b[..., :3]).max(axis=2) > 14
    region = np.zeros((h, w), dtype=bool)
    region[int(h * 0.40) : int(h * 0.88), int(w * 0.18) : int(w * 0.82)] = True
    diff &= region
    ys, xs = np.nonzero(diff)
    if len(xs) < 4:
        return None
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    bw, bh = box[2] - box[0], box[3] - box[1]
    # Слишком большая область — берём типовой рот по центру лица.
    if bw > w * 0.45 or bh > h * 0.28:
        cx, cy = w // 2, int(h * 0.63)
        box = (cx - int(w * 0.16), cy - int(h * 0.05), cx + int(w * 0.16), cy + int(h * 0.07))
    return box


def make_half(closed: Image.Image, opened: Image.Image, box) -> Image.Image:
    out = closed.copy()
    patch_c = closed.crop(box)
    patch_o = opened.crop(box)
    blend = Image.blend(patch_c, patch_o, 0.5)
    out.paste(blend, box)
    return out


def make_shaped(closed: Image.Image, opened: Image.Image, box, sx: float, sy: float) -> Image.Image:
    out = closed.copy()
    patch = opened.crop(box)
    w, h = patch.size
    new_size = (max(2, int(round(w * sx))), max(2, int(round(h * sy))))
    scaled = patch.resize(new_size, Image.LANCZOS)
    cx = (box[0] + box[2]) // 2
    cy = (box[1] + box[3]) // 2
    pos = (cx - new_size[0] // 2, cy - new_size[1] // 2)
    out.paste(scaled, pos, scaled)
    return out


def _blobs(mask: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Простые связные области через заливку по строкам (без scipy)."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    boxes = []
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or seen[y, x]:
                continue
            stack = [(y, x)]
            seen[y, x] = True
            ys, xs = [], []
            while stack:
                cy, cx = stack.pop()
                ys.append(cy)
                xs.append(cx)
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            boxes.append((min(xs), min(ys), max(xs) + 1, max(ys) + 1))
    return boxes


def make_blink(closed: Image.Image) -> Image.Image:
    """Ищет глаза в верхней половине лица и рисует закрытые веки."""
    out = closed.copy()
    arr = np.asarray(closed).astype(np.float32)
    h, w = arr.shape[:2]
    luma = arr[..., :3].mean(axis=2)
    alpha = arr[..., 3]
    region = np.zeros((h, w), dtype=bool)
    region[int(h * 0.18) : int(h * 0.55), int(w * 0.2) : int(w * 0.8)] = True
    mask = (luma < 110) & (alpha > 128) & region
    if not mask.any():
        return out
    px = np.array(out)
    for box in _blobs(mask):
        x0, y0, x1, y1 = box
        bw, bh = x1 - x0, y1 - y0
        if bw < 2 or bh < 2 or bw > w * 0.22 or bh > h * 0.12:
            continue
        # Кожа вокруг глаза — медиана пикселей по рамке снаружи.
        pad = 3
        sx0, sy0 = max(0, x0 - pad), max(0, y0 - pad)
        sx1, sy1 = min(w, x1 + pad), min(h, y1 + pad)
        ring = px[sy0:sy1, sx0:sx1].reshape(-1, 4)
        ring = ring[(ring[:, 3] > 200)]
        if not len(ring):
            continue
        skin = np.median(ring[:, :3], axis=0).astype(np.uint8)
        px[y0:y1, x0:x1, :3] = skin
        mid = (y0 + y1) // 2
        px[mid : mid + 2, x0:x1, :3] = (skin * 0.55).astype(np.uint8)
        px[y0:y1, x0:x1, 3] = 255
    return Image.fromarray(px, "RGBA")


def data_uri(img: Image.Image) -> str:
    if img.height != HEIGHT:
        ratio = HEIGHT / img.height
        img = img.resize((max(1, int(round(img.width * ratio))), HEIGHT), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=86, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def main() -> int:
    check = "--check" in sys.argv
    sprites = json.loads(SPRITES.read_text(encoding="utf-8"))
    pixel = sprites.setdefault("pixel", {})
    made = 0

    for voice_dir in sorted(p for p in PIXEL.iterdir() if p.is_dir()):
        voice = voice_dir.name
        closed_p, open_p = voice_dir / "closed.png", voice_dir / "open.png"
        if not closed_p.exists() or not open_p.exists():
            print(f"пропуск {voice}: нет closed.png/open.png")
            continue
        # Если все кадры уже есть (рисованные вручную) — не трогаем.
        if all((voice_dir / f"{st}.png").exists() for st in STATES):
            print(f"  {voice}: все кадры на месте, пропуск")
            continue
        closed, opened = load(closed_p), load(open_p)
        if closed.size != opened.size:
            opened = opened.resize(closed.size, Image.LANCZOS)

        box = mouth_bbox(closed, opened)
        frames: dict[str, Image.Image] = {"closed": closed, "open": opened}
        if box:
            frames["half"] = make_half(closed, opened, box)
            frames["round"] = make_shaped(closed, opened, box, 0.62, 1.15)
            frames["wide"] = make_shaped(closed, opened, box, 1.35, 0.65)
        else:
            print(f"  {voice}: рот не найден, half/round/wide = open")
            frames["half"] = frames["round"] = frames["wide"] = opened
        frames["blink"] = make_blink(closed)

        pixel[voice] = {}
        for state in STATES:
            img = frames[state]
            pixel[voice][state] = data_uri(img)
            if not check:
                img.save(voice_dir / f"{state}.png")
        made += 1
        print(f"  {voice}: кадры готовы")

    if check:
        print(f"проверка: обработано {made} персонажей, файлы не тронуты")
        return 0

    SPRITES.write_text(json.dumps(sprites, ensure_ascii=False), encoding="utf-8")
    print(f"готово: {made} персонажей, sprites.json обновлён")
    return 0


if __name__ == "__main__":
    sys.exit(main())
