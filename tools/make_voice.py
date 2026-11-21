#!/usr/bin/env python3
"""Смешать стили TeraTTS в новый голос.

Стиль голоса в TeraTTS — два массива в `styles/<voice>/`:

    style_ttl.npy   (1, 50, 256)  тембр
    style_dp.npy    (1, 8, 16)    длительности

Их средневзвешенное даёт новый тембр, которого нет в репозитории модели.
Файлы крошечные (~56 КБ на голос), движок читает стили с диска при каждом
синтезе — перезапуск сервера не нужен.

    python3 tools/make_voice.py ru_m1 ru_m5 --w 0.5 --name x2ai_m15_m
    python3 tools/make_voice.py --mix "ru_m5:0.45,ru_m1:0.35,ru_f2:0.20" \\
        --name x2ai_gopnik --label "Гопник"

`--w` — вес ПЕРВОГО голоса (0.5 — равная смесь). `--mix` — сколько угодно
голосов, веса нормализуются сами. `--label` кладёт человеческое имя в
`~/.config/opencode/x2ai-voice-labels.json` — панель показывает его в списке
голосов вместо имени папки. Каталог по умолчанию —
`~/.config/opencode/teratts-model/styles` (или `$TERATTS_DIR/styles`).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

import numpy as np

ROOT = Path(os.environ.get("TERATTS_DIR", Path.home() / ".config/opencode/teratts-model"))
LABELS_FILE = Path.home() / ".config/opencode/x2ai-voice-labels.json"
FILES = ("style_ttl.npy", "style_dp.npy")
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_]{1,63}$")


def load_style(base: Path, voice: str) -> dict:
    folder = base / voice
    if not folder.is_dir():
        raise SystemExit(f"нет голоса «{voice}» в {base}")
    out = {}
    for name in FILES:
        file = folder / name
        if not file.exists():
            raise SystemExit(f"у «{voice}» нет {name}")
        out[name] = np.load(file).astype(np.float32)
    return out


def parse_mix(spec: str) -> list[tuple[str, float]]:
    """`ru_m5:0.45,ru_m1:0.35` → [("ru_m5", 0.45), ("ru_m1", 0.35)]."""
    parts = []
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        voice, _, weight = chunk.partition(":")
        voice = voice.strip()
        if not voice:
            raise SystemExit("в --mix пустое имя голоса")
        try:
            w = float(weight) if weight.strip() else 1.0
        except ValueError:
            raise SystemExit(f"в --mix не число: «{weight}»")
        if w < 0:
            raise SystemExit("вес не может быть отрицательным")
        parts.append((voice, w))
    if len(parts) < 2:
        raise SystemExit("в --mix нужно минимум два голоса")
    total = sum(w for _, w in parts)
    if total <= 0:
        raise SystemExit("сумма весов в --mix должна быть больше нуля")
    return [(v, w / total) for v, w in parts]


def save_label(name: str, label: str, file: Path) -> None:
    """Человеческое имя голоса для панели: {id: label}."""
    data = {}
    try:
        raw = json.loads(file.read_text("utf8"))
        if isinstance(raw, dict):
            data = raw
    except (OSError, ValueError):
        pass
    data[name] = label
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", "utf8")
    print(f"  метка: «{label}» → {file}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Смешать голоса TeraTTS")
    ap.add_argument("a", nargs="?", help="первый голос (его вес задаёт --w)")
    ap.add_argument("b", nargs="?", help="второй голос")
    ap.add_argument("--w", type=float, default=0.5, help="вес первого голоса, 0..1 (0.5)")
    ap.add_argument("--mix", help='список «голос:вес» через запятую, например "ru_m5:0.5,ru_f2:0.2"')
    ap.add_argument("--name", required=True, help="имя нового голоса, например x2ai_gopnik")
    ap.add_argument("--label", help="человеческое имя для панели, например «Гопник»")
    ap.add_argument("--style-dir", default=str(ROOT / "styles"), help="каталог styles")
    ap.add_argument("--label-file", default=str(LABELS_FILE), help="файл меток голосов")
    ap.add_argument("--force", action="store_true", help="перезаписать существующий голос")
    args = ap.parse_args()

    if not NAME_RE.match(args.name):
        raise SystemExit("имя: строчные латинские буквы, цифры и _, до 64 символов")

    if args.mix:
        parts = parse_mix(args.mix)
    elif args.a and args.b:
        if not 0.0 <= args.w <= 1.0:
            raise SystemExit("--w должен быть от 0 до 1")
        if args.a == args.b:
            raise SystemExit("голоса должны быть разными")
        parts = [(args.a, args.w), (args.b, 1.0 - args.w)]
    else:
        raise SystemExit("укажи два голоса (a b --w ...) или --mix")

    base = Path(args.style_dir).expanduser()
    sources = [(load_style(base, voice), w) for voice, w in parts]
    shape = sources[0][0][FILES[0]].shape
    for src, _ in sources:
        if src[FILES[0]].shape != shape:
            raise SystemExit(f"у голосов разная форма тембра: {src[FILES[0]].shape} и {shape}")

    dst = base / args.name
    if dst.exists() and not args.force:
        raise SystemExit(f"«{args.name}» уже есть — добавь --force, чтобы перезаписать")

    print("смесь: " + " + ".join(f"{v} × {w:.2f}" for v, w in parts) + f" → {args.name}")
    dst.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        mixed = np.zeros_like(sources[0][0][name])
        for src, w in sources:
            mixed += src[name] * np.float32(w)
        np.save(dst / name, mixed.astype(np.float32))
        print(f"  {name}: {mixed.shape} → {dst / name}")
    total = sum((dst / n).stat().st_size for n in FILES)
    print(f"готово: {dst} ({total / 1024:.0f} КБ)")
    if args.label:
        save_label(args.name, args.label, Path(args.label_file))
    return 0


if __name__ == "__main__":
    sys.exit(main())
