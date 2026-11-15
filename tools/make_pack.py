#!/usr/bin/env python3
# Сборка кадров персонажа: маджента-фон -> прозрачность, общая рамка, 336 px.
#   python3 tools/make_pack.py <каталог-кадров> custom/<пак>/<голос> [--nearest]
"""Готовит набор кадров персонажа из картинок на плоском маджента-фоне.

    python make_pack.py <каталог-исходников> <каталог-назначения> [--height 336] [--nearest]

В каталоге исходников лежат файлы по именам состояний: closed.png, open.png,
half.png, round.png, wide.png, blink.png (достаточно любых, какие есть).
Делает: убирает #FF00FF с полупрозрачной кромкой, берёт общую рамку по всем
кадрам, приводит все кадры к одной высоте и одной ширине холста.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

MAGENTA = np.array([255.0, 0.0, 255.0])
STATES = ["closed", "open", "half", "round", "wide", "blink"]


def key_out(img: Image.Image) -> Image.Image:
    arr = np.asarray(img.convert("RGB")).astype(np.float32)
    dist = np.linalg.norm(arr - MAGENTA, axis=2)
    alpha = np.clip((dist - 18.0) / 90.0, 0.0, 1.0)
    a = np.clip(alpha, 1e-3, 1.0)[..., None]
    color = (arr - (1.0 - a) * MAGENTA) / a
    color = np.clip(color, 0, 255)
    out = np.dstack([color, alpha * 255.0]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def bbox(img: Image.Image, pad: float = 0.05) -> tuple[int, int, int, int]:
    alpha = np.asarray(img)[..., 3]
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        raise SystemExit("кадр целиком прозрачный — фон не распознан")
    x0, x1 = xs.min(), xs.max()
    y0, y1 = ys.min(), ys.max()
    dx = int((x1 - x0) * pad)
    dy = int((y1 - y0) * pad)
    return (
        max(0, x0 - dx),
        max(0, y0 - dy),
        min(img.width, x1 + dx + 1),
        min(img.height, y1 + dy + 1),
    )


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    src, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    height = 336
    if "--height" in sys.argv:
        height = int(sys.argv[sys.argv.index("--height") + 1])
    resample = Image.NEAREST if "--nearest" in sys.argv else Image.LANCZOS

    files = {s: src / f"{s}.png" for s in STATES if (src / f"{s}.png").exists()}
    if "closed" not in files:
        raise SystemExit(f"нет {src}/closed.png — без закрытого рта не собрать")
    frames = {name: key_out(Image.open(p)) for name, p in files.items()}

    boxes = [bbox(img) for img in frames.values()]
    box = (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    crops = {}
    for name, img in frames.items():
        crop = img.crop(box)
        scale = height / crop.height
        crops[name] = crop.resize(
            (max(1, round(crop.width * scale)), height), resample
        )

    w = max(c.width for c in crops.values())
    for name, img in crops.items():
        canvas = Image.new("RGBA", (w, height), (0, 0, 0, 0))
        canvas.paste(img, ((w - img.width) // 2, 0), img)
        canvas.save(out_dir / f"{name}.png")
        print(f"{name}: {w}x{height}")
    print(f"готово: {out_dir} ({w}x{height}, кадров {len(crops)})")


if __name__ == "__main__":
    main()
