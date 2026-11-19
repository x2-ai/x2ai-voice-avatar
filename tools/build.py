#!/usr/bin/env python3
"""Собирает gui-experimental.cjs из шаблона и payload'ов.

GUI-плагины OpenCode Desktop исполняются через new Function(code), поэтому
относительные require внутри плагина не работают: всё нужное должно лежать
прямо в файле. Этот скрипт подставляет в шаблон:

    __TALK_PLAN__   plugins/x2ai-avatar/talk-plan.js  (чистая логика рта)
    __PACK_INDEX__  plugins/x2ai-avatar/packs/index.json (паки и персонажи)
    __CLICKS__      plugins/x2ai-avatar/clicks.json   (реплики на клик)
    __LINES__       plugins/x2ai-avatar/lines.json    (реплики/паки/примеры)

Сами кадры спрайтов в бандл НЕ кладутся: они лежат отдельными файлами
plugins/x2ai-avatar/packs/<пак>.json и приходят в окно с моста (/pack) —
окно грузит только выбранный пак.

    python3 tools/pack_sprites.py && python3 tools/build.py

Пишет plugins/x2ai-avatar/gui-experimental.cjs — его и подключает OpenCode.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugins/x2ai-avatar"


def load(path: Path, what: str) -> str:
    if not path.exists():
        sys.exit(
            f"нет {path}\n"
            f"сначала собери {what}: см. plugins/x2ai-avatar/README.md"
        )
    raw = path.read_text(encoding="utf-8").strip()
    json.loads(raw)  # проверка, что это валидный JSON
    return raw


def main() -> int:
    template = (PLUGIN / "gui.template.cjs").read_text(encoding="utf-8")
    talk = (PLUGIN / "talk-plan.js").read_text(encoding="utf-8").strip()
    index = load(PLUGIN / "packs/index.json", "спрайты (tools/pack_sprites.py)")
    clicks = load(PLUGIN / "clicks.json", "реплики (clicks.json)")
    lines = load(PLUGIN / "lines.json", "реплики панели (plugins/x2ai-avatar/gen-lines.py)")

    for marker in ("__TALK_PLAN__", "__PACK_INDEX__", "__CLICKS__", "__LINES__"):
        if marker not in template:
            sys.exit(f"в шаблоне нет маркера {marker}")

    out = (
        template.replace("__TALK_PLAN__", talk)
        .replace("__PACK_INDEX__", index)
        .replace("__CLICKS__", clicks)
        .replace("__LINES__", lines)
    )
    target = PLUGIN / "gui-experimental.cjs"
    target.write_text(out, encoding="utf-8")
    packs = json.loads(index)
    names = ", ".join(f"{k} ({len(v)})" for k, v in packs.items())
    print(f"готово: {target} ({target.stat().st_size / 1024:.0f} КБ), паки: {names}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
