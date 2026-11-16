#!/usr/bin/env python3
"""Синтез кадров речи и моргания для пиксельного пака.

Берём только два исходника (closed.png и open.png) и достраиваем остальное
без масштабирования картинки: меняется лишь область рта, окружение остаётся
пиксель-в-пиксель исходным.

  half  — смесь closed/open внутри маски рта
  round — маска рта сжата по ширине, вытянута по высоте
  wide  — маска рта растянута по ширине, приплюснута
  blink — глаза сжаты по вертикали, вокруг подставлен цвет кожи

Запуск:
    python3 tools/make_pixel_mouths.py --dry     # только превью в /tmp
    python3 tools/make_pixel_mouths.py           # записать PNG в packs/pixel
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
PIXEL = ROOT / "packs" / "pixel"
STATES = ["closed", "half", "open", "round", "wide", "blink"]
PREVIEW = Path("/tmp/pixel-preview.png")


def load(path: Path) -> np.ndarray:
    return np.array(Image.open(path).convert("RGBA"), dtype=np.uint8)


def save(arr: np.ndarray, path: Path) -> None:
    Image.fromarray(arr, "RGBA").save(path)


def diff_mask(closed: np.ndarray, opened: np.ndarray) -> np.ndarray:
    a = closed[..., :3].astype(np.int16)
    b = opened[..., :3].astype(np.int16)
    return (np.abs(a - b).max(axis=2) > 12).astype(np.uint8)


def restrict(mask: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    out = np.zeros_like(mask)
    x0, y0, x1, y1 = box
    out[y0:y1, x0:x1] = mask[y0:y1, x0:x1]
    return out


def bbox(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(mask)
    if len(xs) < 4:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def resize_mask(mask: np.ndarray, sx: float, sy: float) -> np.ndarray:
    """Меняет размер маски, сохраняя её центр."""
    h, w = mask.shape
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return mask
    x0, x1 = xs.min(), xs.max() + 1
    y0, y1 = ys.min(), ys.max() + 1
    crop = (mask[y0:y1, x0:x1] * 255).astype(np.uint8)
    img = Image.fromarray(crop, "L")
    nw = max(2, int(round(img.width * sx)))
    nh = max(2, int(round(img.height * sy)))
    img = img.resize((nw, nh), Image.NEAREST)
    out = np.zeros_like(mask)
    cx = (x0 + x1) // 2
    cy = (y0 + y1) // 2
    px = cx - nw // 2
    py = cy - nh // 2
    small = (np.array(img) > 127).astype(np.uint8)
    h2, w2 = small.shape
    sx0, sy0 = max(0, px), max(0, py)
    sx1, sy1 = min(w, px + w2), min(h, py + h2)
    out[sy0:sy1, sx0:sx1] = small[sy0 - py : sy1 - py, sx0 - px : sx1 - px]
    return out


def composite(base: np.ndarray, top: np.ndarray, mask: np.ndarray, strength: float) -> np.ndarray:
    """Кладёт top на base только там, где mask, с мягкой кромкой."""
    alpha = mask.astype(np.float32)
    alpha = np.array(Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.8)))
    alpha = (alpha.astype(np.float32) / 255.0) * strength
    out = base.astype(np.float32)
    a = alpha[..., None]
    out[..., :3] = out[..., :3] * (1 - a) + top[..., :3].astype(np.float32) * a
    out[..., 3] = np.maximum(out[..., 3], (a[..., 0] * top[..., 3]))
    return out.clip(0, 255).astype(np.uint8)


def make_blink(closed: np.ndarray) -> np.ndarray:
    """Сжимает глаза по вертикали и подставляет кожу вокруг."""
    h, w = closed.shape[:2]
    arr = closed.copy()
    luma = arr[..., :3].astype(np.float32).mean(axis=2)
    alpha = arr[..., 3]
    region = np.zeros((h, w), dtype=bool)
    region[int(h * 0.15) : int(h * 0.58), int(w * 0.15) : int(w * 0.85)] = True
    # Глаза: тёмные пиксели или яркий «экран» (робот).
    dark = (luma < 105) & (alpha > 200) & region
    mask = dark
    if not mask.any():
        return arr

    # Связные области.
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

    for x0, y0, x1, y1 in boxes:
        bw, bh = x1 - x0, y1 - y0
        if bw < 2 or bh < 2 or bw > w * 0.25 or bh > h * 0.14:
            continue
        patch = arr[y0:y1, x0:x1].copy()
        # Кожа вокруг глаза.
        pad = 3
        sx0, sy0 = max(0, x0 - pad), max(0, y0 - pad)
        sx1, sy1 = min(w, x1 + pad), min(h, y1 + pad)
        ring = arr[sy0:sy1, sx0:sx1].reshape(-1, 4)
        ring = ring[ring[:, 3] > 200]
        if not len(ring):
            continue
        skin = np.median(ring[:, :3], axis=0).astype(np.uint8)
        arr[y0:y1, x0:x1, :3] = skin
        # Сжатый глаз: тонкая полоска по центру.
        nh = max(2, bh // 4)
        img = Image.fromarray(patch, "RGBA").resize((bw, nh), Image.LANCZOS)
        small = np.array(img)
        py = y0 + (bh - nh) // 2
        arr[py : py + nh, x0:x1] = small
    return arr


def build(voice_dir: Path, dry: bool) -> list[tuple[str, np.ndarray]]:
    closed = load(voice_dir / "closed.png")
    opened = load(voice_dir / "open.png")
    if closed.shape != opened.shape:
        opened = np.array(Image.fromarray(opened).resize((closed.shape[1], closed.shape[0]), Image.LANCZOS))

    h, w = closed.shape[:2]
    face = (int(w * 0.18), int(h * 0.40), int(w * 0.82), int(h * 0.88))
    mask = restrict(diff_mask(closed, opened), face)
    if not mask.any():
        box = bbox(diff_mask(closed, opened))
        mask = diff_mask(closed, opened) if box else np.zeros_like(mask)
    if not mask.any():
        # Рот не найден — просто повторяем open, как раньше.
        return [("half", opened), ("round", opened), ("wide", opened), ("blink", closed)]

    frames = [("half", composite(closed, opened, mask, 0.55))]
    frames.append(("round", composite(closed, opened, resize_mask(mask, 0.62, 1.18), 1.0)))
    frames.append(("wide", composite(closed, opened, resize_mask(mask, 1.38, 0.62), 1.0)))
    frames.append(("blink", make_blink(closed)))
    return frames


def contact_sheet(items: list[tuple[str, str, np.ndarray]]) -> Image.Image:
    h = max(a.shape[0] for _, _, a in items)
    w = sum(a.shape[1] for _, _, a in items)
    sheet = Image.new("RGBA", (w, h), (30, 30, 34, 255))
    x = 0
    for _, _, arr in items:
        img = Image.fromarray(arr, "RGBA")
        sheet.alpha_composite(img, (x, h - img.height))
        x += img.width
    return sheet


def main() -> int:
    dry = "--dry" in sys.argv
    voices = [p for p in sorted(PIXEL.iterdir()) if p.is_dir()]
    previews = []
    for voice_dir in voices:
        if not (voice_dir / "closed.png").exists() or not (voice_dir / "open.png").exists():
            continue
        if all((voice_dir / f"{s}.png").exists() for s in STATES):
            print(f"  {voice_dir.name}: все кадры на месте — пропуск")
            continue
        frames = build(voice_dir, dry)
        for state, arr in frames:
            if not dry:
                save(arr, voice_dir / f"{state}.png")
            previews.append((voice_dir.name, state, arr))
        print(f"  {voice_dir.name}: {', '.join(s for s, _ in frames)}")

    if previews:
        sheet = contact_sheet(previews)
        sheet.save(PREVIEW)
        print(f"превью: {PREVIEW} ({sheet.width}×{sheet.height})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
