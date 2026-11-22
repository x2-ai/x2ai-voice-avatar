#!/usr/bin/env python3
"""Собирает общий sprites.json из папок паков.

Каждый пак — отдельная папка со своим sprites.json:

    packs/pixel/sprites.json   — наш пак (в репозитории)
    packs/anime/sprites.json   — чужой пак LivLiv (в .gitignore, только локально)

Если в папке пака нет sprites.json, но есть PNG-кадры по персонажам,
файл собирается из них и сохраняется рядом.

Обязательные кадры персонажа: `closed` (покой) и ХОТЯ БЫ ОДИН кадр
разговора (`half`/`open`/`round`/`wide`). `blink` и `idle2` необязательны:
моргание подменяется покоем, idle2 используется только если есть.
Недостающие кадры разговора берутся из доступных по кругу, поэтому пак
из двух кадров тоже говорит.

Итог пишется в plugins/x2ai-avatar/sprites.json (этот файл в .gitignore).

Запуск: python3 tools/pack_sprites.py
"""

from __future__ import annotations

import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
PACKS = ROOT / "packs"
OUT = ROOT / "plugins" / "x2ai-avatar" / "sprites.json"
PKG = ROOT / "plugins" / "x2ai-avatar" / "packs"
# Паки с пиксельными персонажами: их id живут с префиксом px_.
PX_PACKS = {"pixel", "bit16", "bit16night", "bit16ninety"}
CLOSED = "closed"
TALK_STATES = ["half", "open", "round", "wide"]
OPTIONAL_STATES = ["blink", "idle2"]
STATES = [CLOSED, *TALK_STATES, *OPTIONAL_STATES]
HEIGHT = 336


def uri(path: Path) -> str:
    img = Image.open(path).convert("RGBA")
    # Высокие спрайты (выше 336) оставляем как есть — см. x2ai-sync_pack.py.
    if img.height < HEIGHT:
        ratio = HEIGHT / img.height
        size = (max(1, int(round(img.width * ratio))), HEIGHT)
        # LANCZOS по обычной RGBA подмешивает RGB прозрачных пикселей и
        # рисует светлый ореол по краю. Ресайзим с премультиплицированной
        # альфой и возвращаем цвет обратно.
        arr = np.asarray(img, dtype=np.float32)
        alpha = arr[..., 3:4] / 255.0
        arr[..., :3] *= alpha
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).resize(size, Image.LANCZOS)
        arr = np.asarray(img, dtype=np.float32)
        alpha = arr[..., 3:4] / 255.0
        arr[..., :3] = np.where(alpha > 0, arr[..., :3] / np.maximum(alpha, 1e-6), 0)
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    buf = io.BytesIO()
    # WebP q86: так кадры выглядели до всех экспериментов — мягче по краям,
    # без резкой пиксельной «лесенки». PNG-без-потерь, наоборот, проявлял её.
    img.save(buf, format="WEBP", quality=86, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def normalize(entry: dict | None) -> dict | None:
    """Покой + доступные кадры рта → полный набор для окна.

    Разговор строится только из кадров разговора, которые реально есть в паке:
    недостающие состояния подменяются доступными по кругу. Моргание без
    `blink` становится покоем; `idle2` не добавляется, если его нет.
    """
    if not isinstance(entry, dict) or not entry.get(CLOSED):
        return None
    talk = [s for s in TALK_STATES if entry.get(s)]
    if not talk:
        return None
    out = {CLOSED: entry[CLOSED]}
    for idx, state in enumerate(TALK_STATES):
        out[state] = entry.get(state) or entry[talk[idx % len(talk)]]
    out["blink"] = entry.get("blink") or entry[CLOSED]
    if entry.get("idle2"):
        out["idle2"] = entry["idle2"]
    return out


def from_png(pack_dir: Path) -> dict[str, dict[str, str]]:
    voices: dict[str, dict[str, str]] = {}
    for voice_dir in sorted(p for p in pack_dir.iterdir() if p.is_dir()):
        files = {p.stem: p for p in voice_dir.glob("*.png")}
        if CLOSED not in files:
            continue
        entry = {CLOSED: uri(files[CLOSED])}
        for state in [*TALK_STATES, *OPTIONAL_STATES]:
            if state in files:
                entry[state] = uri(files[state])
        voices[voice_dir.name] = entry
    return voices


def main() -> int:
    packs: dict[str, dict[str, dict[str, str]]] = {}
    for pack_dir in sorted(p for p in PACKS.iterdir() if p.is_dir()):
        file = pack_dir / "sprites.json"
        if file.exists():
            voices = json.loads(file.read_text(encoding="utf-8"))
        else:
            voices = from_png(pack_dir)
            if voices:
                file.write_text(json.dumps(voices, ensure_ascii=False), encoding="utf-8")
                print(f"{pack_dir.name}: собран sprites.json из PNG")
        if not voices:
            continue
        # Кадры из двух состояний (покой + любой рот) тоже рабочие.
        norm: dict[str, dict[str, str]] = {}
        for voice, entry in voices.items():
            item = normalize(entry)
            if item is None:
                print(
                    f"ошибка: {pack_dir.name}/{voice}: нужен кадр {CLOSED} "
                    f"и хотя бы один из {', '.join(TALK_STATES)}",
                    file=sys.stderr,
                )
                return 1
            norm[voice] = item
        voices = norm
        # Префикс id: из метаданных пака (characters.json), иначе старый
        # список пиксельных паков. Так новый пак может сам объявить префикс.
        meta_prefix = None
        meta_file = pack_dir / "characters.json"
        if meta_file.exists():
            try:
                meta_prefix = json.loads(meta_file.read_text(encoding="utf-8")).get("prefix")
            except Exception:
                meta_prefix = None
        prefix = meta_prefix if meta_prefix is not None else ("px_" if pack_dir.name in PX_PACKS else "")
        # Пиксельный пак: папка fx_demon = персонаж fx_demoness, и у всех
        # персонажей свой префикс px_, чтобы не путались с аниме-паком.
        if prefix:
            # Порядок берём из sprites.json как есть: переименование fx_demon
            # делаем на месте, а не через pop (иначе персонаж уезжал в конец).
            renamed = {}
            for key, value in voices.items():
                key = "fx_demoness" if key == "fx_demon" else key
                renamed[key if key.startswith(prefix) else f"{prefix}{key}"] = value
            voices = renamed
        packs[pack_dir.name] = voices

    OUT.write_text(json.dumps(packs, ensure_ascii=False), encoding="utf-8")
    # По паку на файл: окно грузит только тот пак, который выбрано, а не все
    # кадры сразу (аниме-пак — половина веса бандла).
    PKG.mkdir(parents=True, exist_ok=True)
    for name, voices in packs.items():
        (PKG / f"{name}.json").write_text(json.dumps(voices, ensure_ascii=False), encoding="utf-8")
    # Манифест: имена паков и персонажи в них. Маленький, едет в бандл.
    index = {name: sorted(voices.keys()) for name, voices in packs.items()}
    (PKG / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    # Обвязка персонажей (имя, голос, характер, реплики) — данные пака.
    # Собираем в один файл: его читают и окно (в бандл), и серверный плагин.
    char_packs: dict[str, dict[str, str]] = {}
    chars: dict[str, dict] = {}
    for pack_dir in sorted(p for p in PACKS.iterdir() if p.is_dir()):
        file = pack_dir / "characters.json"
        if not file.exists():
            continue
        meta = json.loads(file.read_text(encoding="utf-8"))
        char_packs[pack_dir.name] = {
            "name": meta.get("name") or pack_dir.name,
            "prefix": meta.get("prefix") or "",
        }
        for full, rec in (meta.get("characters") or {}).items():
            item = dict(rec)
            item["pack"] = pack_dir.name
            chars[full] = item
    (PKG / "characters.json").write_text(
        json.dumps({"packs": char_packs, "characters": chars}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    total = sum(len(v) for v in packs.values())
    names = ", ".join(f"{k} ({len(v)})" for k, v in packs.items())
    print(f"готово: паков {len(packs)}, персонажей {total} — {names}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
