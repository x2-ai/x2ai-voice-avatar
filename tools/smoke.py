#!/usr/bin/env python3
"""Смоук-тесты x2ai-voice-avatar: проверяют, что сборка не сломана.

Запуск: python3 tools/smoke.py
Код выхода 0 — всё в порядке, 1 — есть ошибки.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugins" / "x2ai-avatar" / "gui-experimental.cjs"
TEMPLATE = ROOT / "plugins" / "x2ai-avatar" / "gui.template.cjs"
TTS = ROOT / "plugins" / "x2ai-tts-done.js"
SPRITES = ROOT / "plugins" / "x2ai-avatar" / "sprites.json"
LINES = ROOT / "plugins" / "x2ai-avatar" / "lines.json"
SERVER = ROOT / "x2ai-teratts" / "server.py"
BRIDGE = "http://127.0.0.1:47821"

problems: list[str] = []
passed: list[str] = []


def ok(name: str) -> None:
    passed.append(name)


def bad(name: str, detail: str = "") -> None:
    problems.append(f"{name}: {detail}" if detail else name)


def check_syntax() -> None:
    for path in (PLUGIN, TEMPLATE, TTS):
        if not path.exists():
            bad(f"нет файла {path.relative_to(ROOT)}")
            continue
        res = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
        if res.returncode != 0:
            bad(f"синтаксис {path.name}", res.stderr.strip()[:200])
        else:
            ok(f"синтаксис {path.name}")


def check_bundle_markers() -> None:
    if not PLUGIN.exists():
        return
    text = PLUGIN.read_text(encoding="utf-8", errors="replace")
    markers = [
        "Рассуждения",
        "Вспомогательная модель",
        "Обращение к пользователю",
        "Статистика",
        "Тихие часы",
        "Повторить",
        "x2ai-avatar:stats",
        "pingReset",
        "voiceGender",
        "sayWhenFree" if False else "bridge(\"/say\"",
        "centerActive",
        "x2ai-active",
    ]
    for marker in markers:
        if marker in text:
            ok(f"маркер «{marker}»")
        else:
            bad(f"в бандле нет «{marker}»")


def check_sprites() -> None:
    if not SPRITES.exists():
        bad("нет sprites.json")
        return
    data = json.loads(SPRITES.read_text(encoding="utf-8"))
    for pack, frames in data.items():
        for voice, states in frames.items():
            for state in ("closed", "blink"):
                if state not in states:
                    bad(f"спрайт {pack}/{voice} без кадра {state}")
    if not problems:
        ok("у всех спрайтов есть closed и blink")


def check_lines() -> None:
    if not LINES.exists():
        bad("нет lines.json")
        return
    data = json.loads(LINES.read_text(encoding="utf-8"))
    samples = data.get("samples") or {}
    packs = data.get("packs") or {}
    if not samples:
        bad("lines.json без samples")
    if not packs:
        bad("lines.json без packs")
    lines = data.get("lines") or {}
    if len(lines) < 8:
        bad("lines.json: слишком мало голосов", str(len(lines)))
    for voice, items in lines.items():
        if not isinstance(items, list) or len(items) < 2:
            bad(f"lines.json: у {voice} меньше двух реплик")
    if not problems:
        ok(f"lines.json: {len(lines)} голосов, {len(samples)} примеров")


def check_tts_markers() -> None:
    if not TTS.exists():
        return
    text = TTS.read_text(encoding="utf-8", errors="replace")
    markers = [
        "function agreeGender",
        "function stripCode",
        "function decorate",
        "function llmReason",
        "reasonSeen",
        "function readReason",
        "inQuietHours",
        "FULL_MAX_CHARS",
        "CODE_PHRASES",
        "LINK_PHRASES",
    ]
    for marker in markers:
        if marker in text:
            ok(f"tts: «{marker}»")
        else:
            bad(f"tts: нет «{marker}»")


def check_server() -> None:
    if not SERVER.exists():
        bad("нет server.py")
        return
    res = subprocess.run(
        [sys.executable, "-c", f"import ast,pathlib;ast.parse(pathlib.Path({str(SERVER)!r}).read_text())"],
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        bad("server.py: синтаксис", res.stderr.strip()[:200])
        return
    ok("server.py: синтаксис")
    text = SERVER.read_text(encoding="utf-8")
    for marker in ("fx_spec", "emotion", "CHUNK_CHARS", "announce_playback"):
        if marker in text:
            ok(f"server: «{marker}»")
        else:
            bad(f"server: нет «{marker}»")


def get(path: str) -> dict | None:
    try:
        with urllib.request.urlopen(f"{BRIDGE}{path}", timeout=4) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        return None


def post(path: str, payload: dict) -> dict | None:
    try:
        req = urllib.request.Request(
            f"{BRIDGE}{path}",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        return None


def check_bridge() -> None:
    state = get("/state")
    if state is None:
        bad("мост не отвечает на /state (приложение запущено?)")
        return
    ok("мост: /state")
    if "speaking" not in state:
        bad("мост: в /state нет speaking")

    speech = get("/speech")
    if speech is None:
        bad("мост: /speech не отвечает")
    else:
        ok("мост: /speech")
        for key in ("mode", "speed", "quiet", "reason"):
            if key not in speech:
                bad(f"мост: в /speech нет {key}")
        modes = speech.get("reason", {}).get("mode")
        if modes not in ("off", "brief", "full"):
            bad("мост: неверный режим рассуждений", str(modes))

    user = get("/user")
    if user is None:
        bad("мост: /user не отвечает")
    else:
        ok("мост: /user")

    models = get("/models")
    if models is None:
        bad("мост: /models не отвечает")
    else:
        ok(f"мост: /models ({len(models.get('models') or [])} шт.)")


def check_deploy() -> None:
    home = Path.home()
    deployed = [
        home / ".config/opencode/plugins/x2ai-avatar/gui-experimental.cjs",
        home / ".config/opencode/plugins/x2ai-tts-done.js",
        home / ".config/opencode/x2ai-teratts/server.py",
    ]
    for path in deployed:
        if path.exists():
            ok(f"задеплоено: {path.name}")
        else:
            bad(f"не задеплоено: {path}")


def main() -> int:
    check_syntax()
    check_bundle_markers()
    check_sprites()
    check_lines()
    check_tts_markers()
    check_server()
    check_deploy()
    check_bridge()

    print(f"Пройдено: {len(passed)}")
    for name in passed:
        print(f"  ok  {name}")
    if problems:
        print(f"\nПровалено: {len(problems)}")
        for name in problems:
            print(f"  !!  {name}")
        return 1
    print("\nВсё в порядке.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
