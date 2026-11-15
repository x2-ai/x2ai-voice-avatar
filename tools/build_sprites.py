#!/usr/bin/env python3
"""Собирает кадры для новых персонажей (робот, демон, инопланетянин, кот, пингвин, призрак).

База — модели LivLiv (livliv-dev/player): берём готовые слои, перекрашиваем
кожу/глаза и дорисовываем детали (антенна, клыки, большие глаза).

Результат: /tmp/x2ai-char/new_sprites.json
    {"fx_robot": {"closed": "data:image/webp;base64,...", ...}, ...}
"""
from __future__ import annotations

import base64
import io
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen

from PIL import Image, ImageChops, ImageDraw

BASE = "https://raw.githubusercontent.com/livliv-dev/player/HEAD/characters"
CACHE = Path("/tmp/x2ai-char/cache")
OUT = Path("/tmp/x2ai-char/new_sprites.json")
STATES = ["closed", "half", "open", "round", "wide", "blink"]
HEIGHT = 336

SKIN = {"face", "eye_L_skin", "eye_R_skin", "neck_shadow"}
IRIS = {"iris_L", "iris_R"}
EYES = {"eye_L", "eye_R"}


def fetch(url: str) -> bytes:
    with urlopen(url, timeout=60) as r:
        return r.read()


def cached(char: str, rel: str) -> Path:
    p = CACHE / char / rel.replace("/", "_")
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(fetch(f"{BASE}/{char}/{rel}"))
    return p


def load_char(char: str) -> tuple[dict, dict[str, Image.Image]]:
    model = json.loads(fetch(f"{BASE}/{char}/model.json"))
    rels = set()
    for layer in model["layers"]:
        rels.add(layer["texture"])
        for frame in (layer.get("frames") or []):
            rels.add(frame)
    with ThreadPoolExecutor(max_workers=8) as pool:
        paths = list(pool.map(lambda rel: cached(char, rel), sorted(rels)))
    images = {}
    for rel, path in zip(sorted(rels), paths):
        images[rel] = Image.open(path).convert("RGBA")
    return model, images


def desaturate(img: Image.Image) -> Image.Image:
    gray = img.convert("LA").convert("RGBA")
    gray.putalpha(img.split()[3])
    return gray


def tint(img: Image.Image, color: tuple[int, int, int], strength: float) -> Image.Image:
    """Умножает цвет на color с сохранением альфы."""
    r, g, b, a = img.split()
    r = r.point(lambda v: int(v * (1 - strength) + v * color[0] / 255 * strength))
    g = g.point(lambda v: int(v * (1 - strength) + v * color[1] / 255 * strength))
    b = b.point(lambda v: int(v * (1 - strength) + v * color[2] / 255 * strength))
    return Image.merge("RGBA", (r, g, b, a))


def tint_region(img: Image.Image, color: tuple[int, int, int], strength: float, box) -> Image.Image:
    """Тонирует только пиксели кожи внутри box (координаты слоя)."""
    base = img.copy()
    tinted = tint(img, color, strength)
    mask = Image.new("L", img.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rectangle(box, fill=255)
    mask = ImageChops.multiply(mask, img.getchannel("A"))
    return Image.composite(tinted, base, mask)


def decorate(canvas: Image.Image, spec: dict, model: dict) -> None:
    """Дорисовывает детали поверх готового кадра."""
    head = model["anchors"]["head"]
    cx, cy, rx, ry = head["cx"], head["cy"], head["rx"], head["ry"]
    top = model["anchors"]["top_y"]
    d = ImageDraw.Draw(canvas)

    for kind in spec.get("extras", []):
        if kind == "antenna":
            x = cx
            base_y = top + 150
            d.line([(x, base_y), (x, base_y - 90)], fill=(120, 130, 145, 255), width=9)
            d.ellipse([x - 17, base_y - 124, x + 17, base_y - 90], fill=(90, 220, 235, 255))
        elif kind == "antennae2":
            for dx in (-0.5, 0.5):
                x = cx + dx * rx
                base_y = top + 170
                d.line([(x, base_y), (x + dx * 60, base_y - 80)],
                       fill=(90, 160, 110, 255), width=8)
                ex = x + dx * 60
                d.ellipse([ex - 15, base_y - 110, ex + 15, base_y - 80],
                          fill=(120, 230, 150, 255))
        elif kind == "big_eyes":
            for ex in model["anchors"]["eyes"]:
                x0, y0, x1, y1 = ex
                w = (x1 - x0) * 0.92
                h = (y1 - y0) * 1.25
                mx = (x0 + x1) / 2 - w / 2
                my = (y0 + y1) / 2 - h / 2
                d.ellipse([mx, my, mx + w, my + h], fill=(14, 16, 24, 255))
                d.ellipse([mx + w * 0.55, my + h * 0.18, mx + w * 0.75, my + h * 0.34],
                          fill=(235, 255, 255, 255))
        elif kind == "fangs":
            jaw = model["anchors"]["jaw"]
            chin = jaw["chin"]
            for dx in (-16, 16):
                x = cx + dx
                d.polygon([(x - 7, chin - 26), (x + 7, chin - 26), (x, chin + 6)],
                          fill=(250, 248, 240, 255))


def compose(model: dict, images: dict[str, Image.Image], spec: dict, state: str) -> Image.Image:
    w, h = model["canvas"]
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    skin = tuple(spec["skin"]) if spec.get("skin") else None
    iris = tuple(spec["iris"]) if spec.get("iris") else None
    blink = state == "blink"

    for layer in model["layers"]:
        lid = layer.get("role")
        if lid in ("expr", "expr_brows"):
            continue
        if blink and lid in ("eye_L", "eye_R", "iris_L", "iris_R"):
            continue
        if not blink and lid in ("lid_L", "lid_R"):
            continue

        if lid == "mouth":
            frames = layer.get("frames") or []
            visemes = layer.get("visemes") or []
            idx = visemes.index(state) if state in visemes else 0
            rel = frames[idx] if idx < len(frames) else layer["texture"]
        else:
            rel = layer["texture"]

        img = images[rel]
        if skin and layer["id"] == "body":
            # шея/плечи — часть слоя body, красим только полосу шеи
            head_a = model["anchors"]["head"]
            chin = model["anchors"]["jaw"]["chin"]
            neck = model["anchors"]["neck_y"]
            box = (
                int(head_a["cx"] - 0.42 * head_a["rx"]) - layer["x"],
                int(chin) - layer["y"],
                int(head_a["cx"] + 0.42 * head_a["rx"]) - layer["x"],
                int(neck + 0.25 * (neck - chin)) - layer["y"],
            )
            if spec.get("desat"):
                img = desaturate(img)
            img = tint_region(img, skin, float(spec.get("strength", 0.72)), box)
        elif skin and layer["id"] in SKIN:
            if spec.get("desat"):
                img = desaturate(img)
            img = tint(img, skin, float(spec.get("strength", 0.72)))
        elif iris and layer["id"] in IRIS:
            img = tint(img, iris, 0.95)
        elif skin and spec.get("tint_mouth") and layer["id"] == "mouth":
            img = tint(img, tuple(spec.get("mouth_color", skin)), float(spec.get("mouth_strength", 0.45)))
        elif iris and spec.get("eye_glow") and layer["id"] in EYES:
            img = tint(desaturate(img), iris, 0.7)
        canvas.alpha_composite(img, (layer["x"], layer["y"]))

    decorate(canvas, spec, model)

    neck = model["anchors"]["neck_y"]
    top = int(model["anchors"]["top_y"] - 10)
    bottom = int(neck + 1.05 * (neck - model["anchors"]["top_y"]))
    band = canvas.crop((0, max(0, top), w, min(h, bottom)))
    box = band.getbbox()  # видимое содержимое: ничего не срезаем по бокам
    if box is None:
        box = (0, 0, band.width, band.height)
    pad = 8
    # Асимметричный кроп: слева срезаем «за край экрана», справа показываем всё.
    head = model["anchors"]["head"]
    left = max(box[0], int(head["cx"] - 1.8 * head["rx"]))
    right = min(w, box[2] + pad)
    crop = canvas.crop((left, max(0, top), right, min(h, bottom)))
    ratio = HEIGHT / crop.height
    return crop.resize((int(crop.width * ratio), HEIGHT), Image.LANCZOS)


SPECS = {
    "ru_f1": {"char": "char06"},
    "ru_f2": {"char": "f06"},
    "ru_m1": {"char": "char07"},
    "ru_m5": {"char": "w01"},
    "fx_robot": {"char": "d02"},
    "fx_demon": {"char": "v05"},
    "fx_alien": {"char": "f07"},
    "fx_cat": {"char": "q03"},
    "fx_penguin": {"char": "p03"},
    "fx_ghost": {"char": "v07"},
}

# Свои персонажи: custom/<голос>/{closed,half,open,round,wide,blink}.png
# Если каталог есть — он главнее LivLiv-модели. Обязательны только closed и open,
# остальные формы рта подставляются из open, blink — из closed.
CUSTOM = Path(__file__).resolve().parent.parent / "custom"
FALLBACK = {"half": "open", "round": "open", "wide": "open", "blink": "closed"}


def load_custom(voice: str) -> dict[str, str] | None:
    folder = CUSTOM / voice
    if not folder.is_dir():
        return None

    meta = {}
    if (folder / "meta.json").exists():
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    crop = meta.get("crop")

    out: dict[str, str] = {}
    for state in STATES:
        path = folder / f"{state}.png"
        if not path.exists():
            alt = FALLBACK.get(state)
            path = folder / f"{alt}.png" if alt else path
        if not path.exists():
            raise SystemExit(f"{folder}: нет {state}.png (и нет {FALLBACK.get(state)}.png)")
        img = Image.open(path).convert("RGBA")
        if crop:
            img = img.crop(tuple(crop))
        ratio = HEIGHT / img.height
        if abs(ratio - 1) > 0.01:
            img = img.resize((round(img.width * ratio), HEIGHT), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=90, method=6)
        out[state] = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()
    return out


def main() -> int:
    CACHE.mkdir(parents=True, exist_ok=True)
    out: dict[str, dict[str, str]] = {}
    for voice, spec in SPECS.items():
        custom = load_custom(voice)
        if custom:
            out[voice] = custom
            print(voice, "custom", len(custom["closed"]) // 1024, "КБ")
            continue
        model, images = load_char(spec["char"])
        frames = {}
        for state in STATES:
            img = compose(model, images, spec, state)
            buf = io.BytesIO()
            img.save(buf, "WEBP", quality=86, method=6)
            data = base64.b64encode(buf.getvalue()).decode()
            frames[state] = f"data:image/webp;base64,{data}"
            if state == "closed":
                img.save(f"/tmp/x2ai-char/{voice}.png")
        out[voice] = frames
        print(voice, "ok", len(frames["closed"]) // 1024, "КБ")
    OUT.write_text(json.dumps(out, ensure_ascii=False))
    print("готово:", OUT, OUT.stat().st_size // 1024, "КБ")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
