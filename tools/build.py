#!/usr/bin/env python3
"""Собирает gui-experimental.cjs из шаблона и payload'ов.

GUI-плагины OpenCode Desktop исполняются через new Function(code), поэтому
относительные require внутри плагина не работают: спрайты и реплики должны
лежать прямо в файле. Этот скрипт подставляет их в шаблон.

    plugins/x2ai-avatar/gui.template.cjs   код с __SPRITES__ и __CLICKS__
    plugins/x2ai-avatar/sprites.json       кадры персонажей (build_sprites.py)
    plugins/x2ai-avatar/clicks.json        реплики на клик (gen-clicks.py)

    python3 tools/build.py

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
    sprites = load(PLUGIN / "sprites.json", "спрайты (tools/build_sprites.py)")
    clicks = load(PLUGIN / "clicks.json", "реплики (plugins/x2ai-avatar/gen-clicks.py)")

    out = template.replace("__SPRITES__", sprites).replace("__CLICKS__", clicks)
    target = PLUGIN / "gui-experimental.cjs"
    target.write_text(out, encoding="utf-8")
    print(f"готово: {target} ({target.stat().st_size / 1024:.0f} КБ)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
