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
    # Цвет НЕ выпрямляем (unpremultiply): при малой альфе деление на неё
    # выносит каналы за 255 и даёт одиночные белые пиксели на волосах.
    # Розовую кайму убирает clean_edges.py / harden_alpha по кромке.
    color = np.clip(arr, 0, 255)
    out = np.dstack([color, alpha * 255.0]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def key_out_flood(img: Image.Image, tol: float = 70.0) -> Image.Image:
    """Вырезает фон заливкой от краёв, а не по цвету во всём кадре.

    Так фиолетовые пиксели зрачков не считаются фоном: они не связаны
    с внешней областью мадженты.
    """
    arr = np.asarray(img.convert("RGB")).astype(np.float32)
    h, w = arr.shape[:2]
    dist = np.linalg.norm(arr - MAGENTA, axis=2)
    candidate = dist < tol
    bg = np.zeros((h, w), dtype=bool)
    stack = []
    for x in range(w):
        for y in (0, h - 1):
            if candidate[y, x] and not bg[y, x]:
                bg[y, x] = True
                stack.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if candidate[y, x] and not bg[y, x]:
                bg[y, x] = True
                stack.append((y, x))
    while stack:
        cy, cx = stack.pop()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < h and 0 <= nx < w and candidate[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True
                stack.append((ny, nx))
    # Остатки мадженты внутри силуэта (щели между волосами и капюшоном)
    # тоже убираем: настоящая маджента в арте не встречается, а фиолетовые
    # зрачки от неё далеко по цвету.
    bg |= dist < 40.0
    out = np.dstack([np.clip(arr, 0, 255), np.where(bg, 0, 255)]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def harden_alpha(img: Image.Image, threshold: int = 110, magenta_tol: int = 120) -> Image.Image:
    """Пиксель-арт: полупрозрачная кайма после вырезания фона даёт розовый ореол.

    Поэтому альфу делаем двоичной: пиксель либо есть, либо нет. Плюс гасим всё,
    что осталось близким по цвету к мадженте, — иначе на волосах видны розовые
    точки, у которых альфа уже была высокой.
    """
    arr = np.asarray(img).copy()
    a = arr[..., 3].astype(np.int32)
    rgb = arr[..., :3].astype(np.int32)
    dist = np.sqrt(
        (rgb[..., 0] - 255) ** 2 + rgb[..., 1] ** 2 + (rgb[..., 2] - 255) ** 2
    )
    keep = (a >= threshold) & (dist >= magenta_tol)
    arr[..., 3] = np.where(keep, 255, 0).astype(np.uint8)
    return _despeckle(Image.fromarray(arr, "RGBA"))


def _despeckle(img: Image.Image, max_neighbors: int = 2) -> Image.Image:
    """Убирает одиночные розовые точки, пережившие вырезание фона.

    Такие точки почти не связаны с остальным рисунком: у них максимум два
    «розовых» соседа в окне 3×3. Румяна и прочие пятна — это десятки пикселей,
    они не трогаются.
    """
    from numpy.lib.stride_tricks import sliding_window_view

    arr = np.asarray(img).copy()
    rgb = arr[..., :3].astype(np.int32)
    a = arr[..., 3].astype(np.int32)
    pink = (a > 0) & (rgb[..., 0] > 140) & (rgb[..., 2] > 140) & (rgb[..., 1] < 130)
    if not pink.any():
        return img
    kernel = np.ones((3, 3), np.int32)
    kernel[1, 1] = 0
    window = sliding_window_view(np.pad(pink.astype(np.int32), 1), (3, 3))
    lonely = pink & ((window * kernel).sum(axis=(2, 3)) <= max_neighbors)
    if lonely.any():
        arr[lonely] = 0
    return Image.fromarray(arr, "RGBA")


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
    # Пиксель-арту нужны жёсткие края без полупрозрачной каймы.
    harden = "--nearest" in sys.argv or "--harden" in sys.argv

    files = {s: src / f"{s}.png" for s in STATES if (src / f"{s}.png").exists()}
    if "closed" not in files:
        raise SystemExit(f"нет {src}/closed.png — без закрытого рта не собрать")
    flood = "--flood" in sys.argv
    frames = {
        name: (key_out_flood(Image.open(p)) if flood else key_out(Image.open(p)))
        for name, p in files.items()
    }
    if harden and not flood:
        frames = {name: harden_alpha(img) for name, img in frames.items()}

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
