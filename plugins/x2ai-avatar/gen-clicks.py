#!/usr/bin/env python3
"""Готовит короткие фразы для клика по персонажу.

Для каждого из четырёх голосов синтезирует набор коротких реплик,
сжимает в m4a (48 кбит/с, моно) и складывает JSON с data-URI и длительностью:

    ~/.config/opencode/x2ai-avatar/clicks.json

Запуск (нужен venv с onnxruntime):

    ~/.config/opencode/teratts-venv/bin/python gen-clicks.py
"""
from __future__ import annotations

import base64
import json
import subprocess
import sys
import time
from pathlib import Path

HOME = Path.home()
ROOT = HOME / ".config/opencode/teratts-model"
SERVER_DIR = HOME / ".config/opencode/x2ai-teratts"
OUT = Path(__file__).with_name("clicks.json")
TMP = Path("/tmp/x2ai-clicks")
VOICES = ["ru_f1", "ru_f2", "ru_m1", "ru_m5",
          "fx_robot", "fx_demon", "fx_alien", "fx_cat", "fx_penguin", "fx_ghost"]

PHRASES = [
    "Ага?",
    "Слушаю.",
    "Я тут.",
    "Ну?",
    "Говори.",
    "Ммм.",
    "Да-да?",
    "Чего?",
    "Я всё слышу.",
    "Продолжай.",
]


def main() -> int:
    sys.path.insert(0, str(ROOT))
    sys.path.insert(0, str(SERVER_DIR))
    import teratts  # noqa: PLC0415
    import server  # noqa: PLC0415  (нужен loudify)

    TMP.mkdir(parents=True, exist_ok=True)
    tts = teratts.load_model(
        ROOT,
        model="distilled",
        provider="CPUExecutionProvider",
        russian_stress=True,
        ruaccent_mode="dictionary",
    )

    out: dict[str, list[dict]] = {}
    for voice in VOICES:
        items: list[dict] = []
        for i, text in enumerate(PHRASES):
            t0 = time.time()
            audio = teratts.generate_speech(
                tts, f"<ru>{text}</ru>", server.resolve_voice(voice)
            )
            audio = server.apply_fx(voice, audio)
            audio = server.loudify(audio)
            wav = TMP / f"{voice}-{i}.wav"
            teratts.write_wav(wav, audio)
            m4a = TMP / f"{voice}-{i}.m4a"
            subprocess.run(
                [
                    "afconvert", "-f", "m4af", "-d", "aac", "-b", "48000",
                    "-c", "1", str(wav), str(m4a),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            dur = subprocess.run(
                ["afinfo", str(m4a)], capture_output=True, text=True, check=True
            ).stdout
            ms = 0
            for line in dur.splitlines():
                if "estimated duration" in line:
                    value = line.split(":")[1].strip().split()[0]
                    ms = int(float(value) * 1000)
            data = base64.b64encode(m4a.read_bytes()).decode()
            items.append({"text": text, "ms": ms, "src": f"data:audio/mp4;base64,{data}"})
            print(f"{voice} {i + 1}/{len(PHRASES)} {text!r} {ms}ms "
                  f"({time.time() - t0:.2f}s, {len(data) // 1024} КБ)", flush=True)
        out[voice] = items

    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    size = OUT.stat().st_size / 1024
    print(f"готово: {OUT} ({size:.0f} КБ)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
