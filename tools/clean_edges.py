#!/usr/bin/env python3
"""Убирает маджента-кайму по кромке силуэта и одиночные белые вкрапления.

Гасим только пиксели, прилегающие к прозрачности: цвета внутри арта
(румяна, сиреневатый металл робота) не трогаем.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from numpy.lib.stride_tricks import sliding_window_view

MAGENTA = np.array([255, 0, 255], dtype=np.int32)
STATES = ("closed", "half", "open", "round", "wide", "blink")


def load(path):
    return np.array(Image.open(path).convert("RGBA")).astype(np.int32)


def save(path, arr):
    Image.fromarray(arr.astype(np.uint8), "RGBA").save(path)


def border_mask(alpha):
    """Пиксели с alpha>0, у которых в окне 3×3 есть полностью прозрачный."""
    transparent = alpha == 0
    pad = np.pad(transparent, 1, constant_values=False)
    near = sliding_window_view(pad, (3, 3)).any(axis=(2, 3))
    return near & (alpha > 0)


def clusters(mask):
    """4-связные кластеры: список списков координат."""
    seen = np.zeros_like(mask, dtype=bool)
    h, w = mask.shape
    out = []
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or seen[y, x]:
                continue
            stack = [(y, x)]
            seen[y, x] = True
            group = []
            while stack:
                cy, cx = stack.pop()
                group.append((cy, cx))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            out.append(group)
    return out


def clean_frame(arr, base_white=None):
    rgb = arr[..., :3]
    alpha = arr[..., 3]
    border = border_mask(alpha)
    dist = ((rgb - MAGENTA) ** 2).sum(-1)
    pinkish = (rgb[..., 0] > 110) & (rgb[..., 2] > 110) & (rgb[..., 1] < 200) & (dist < 200**2)
    kill = border & pinkish

    # белые вкрапления: только мелкие кластеры на кромке, которых нет в базовом кадре
    white = (rgb.min(-1) > 210) & (alpha > 0)
    extra = white if base_white is None else (white & ~base_white)
    for group in clusters(extra):
        if len(group) <= 10 and any(border[y, x] for y, x in group):
            for y, x in group:
                kill[y, x] = True

    killed = int(kill.sum())
    alpha[kill] = 0
    return killed, int(((rgb[..., 0] > 110) & (rgb[..., 2] > 110) & (rgb[..., 1] < 200)
                        & (alpha > 0) & border).sum())


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "packs/pixel")
    total = 0
    for folder in sorted(p for p in root.iterdir() if p.is_dir()):
        base_path = folder / "closed.png"
        base_white = None
        if base_path.exists():
            b = load(base_path)
            base_white = (b[..., :3].min(-1) > 210) & (b[..., 3] > 0)
        for state in STATES:
            path = folder / f"{state}.png"
            if not path.exists():
                continue
            arr = load(path)
            killed, left = clean_frame(arr, None if state == "closed" else base_white)
            save(path, arr)
            total += killed
            print(f"{folder.name}/{state}: -{killed} px, осталось на кромке {left}")
    print("всего удалено:", total)


if __name__ == "__main__":
    main()
