#!/usr/bin/env python3
"""Готовит озвучку для панели персонажа.

Три набора фраз, каждый — своим голосом (голос = персонаж):

    lines[voice][0..2]   три забавные реплики персонажа (при смене персонажа)
    packs[pack][voice]   название пака (при смене пака)
    samples[voice]       пример голоса (при выборе голоса в списке)

Всё сжимается в m4a (48 кбит/с, моно) и складывается в JSON рядом со скриптом:

    plugins/x2ai-avatar/lines.json

Запуск (нужен venv с onnxruntime):

    ~/.config/opencode/teratts-venv/bin/python gen-lines.py [голос ...]

Без аргументов пересобирает всё, с аргументами — только указанные голоса,
остальные берёт из существующего lines.json.
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
OUT = Path(__file__).with_name("lines.json")
TMP = Path("/tmp/x2ai-lines")

VOICES = [
    "ru_f1", "ru_f2", "ru_m1", "ru_m5",
    "fx_robot", "fx_demon", "fx_demoness", "fx_alien", "fx_cat",
    "fx_penguin", "fx_ghost",
]

LINES = {
    "ru_f1": [
        "Я на связи, шеф.",
        "Проверила дважды, всё чисто.",
        "Отойду на минуту, не скучай.",
    ],
    "ru_f2": [
        "Всё под контролем, как всегда.",
        "Мне нравится, когда ты просишь сложное.",
        "Тише, я думаю.",
    ],
    "ru_m1": [
        "Код компилируется, я проверял.",
        "Тут всё просто, даже обидно.",
        "Дай мне пять минут и кофе.",
    ],
    "ru_m5": [
        "Погнали, чего стоим?",
        "Я всё сделал, пока ты моргал.",
        "Ошибок нет, я их съел.",
    ],
    "fx_robot": [
        "Бип. Система в норме.",
        "Человек, я тебя вычислил.",
        "Ошибка не найдена. Странно.",
    ],
    "fx_demon": [
        "Твоя душа мне и не нужна.",
        "Я здесь просто для атмосферы.",
        "Сделка? Нет, я по работе.",
    ],
    "fx_demoness": [
        "Не бойся, я только с виду.",
        "Я знаю, о чём ты думаешь.",
        "Тьма тоже устаёт.",
    ],
    "fx_alien": [
        "Мы наблюдали за вами давно.",
        "На твоей планете плохой интернет.",
        "Забирай меня, я тут застрял.",
    ],
    "fx_cat": [
        "Мяу. Это значит да.",
        "Я не сплю, я медитирую.",
        "Ещё раз, и я тебя укушу.",
    ],
    "fx_penguin": [
        "Пип-пип, я пришелец.",
        "Мой корабль сломался, дай рыбу.",
        "Земляне странные.",
    ],
    "fx_ghost": [
        "Я тут уже сто лет.",
        "Не оборачивайся.",
        "Я не страшный, я просто холодный.",
    ],
}

PACKS = {
    "anime": "Аниме!",
    "pixel": "Пиксельарт!",
}

SAMPLE = "Привет. Это мой голос."


def main() -> int:
    sys.path.insert(0, str(ROOT))
    sys.path.insert(0, str(SERVER_DIR))
    import teratts  # noqa: PLC0415
    import server  # noqa: PLC0415  (нужен apply_fx и loudify)

    TMP.mkdir(parents=True, exist_ok=True)
    tts = teratts.load_model(
        ROOT,
        model="distilled",
        provider="CPUExecutionProvider",
        russian_stress=True,
        ruaccent_mode="dictionary",
    )

    only = [a for a in sys.argv[1:] if a in VOICES]
    voices = only or VOICES

    out: dict = {"lines": {}, "packs": {}, "samples": {}}
    if OUT.exists():
        out = json.loads(OUT.read_text(encoding="utf-8"))
        out.setdefault("lines", {})
        out.setdefault("packs", {})
        out.setdefault("samples", {})

    def synth(voice: str, text: str, tag: str) -> dict:
        t0 = time.time()
        audio = teratts.generate_speech(tts, f"<ru>{text}</ru>", server.resolve_voice(voice))
        audio = server.apply_fx(voice, audio)
        audio = server.loudify(audio)
        safe = f"{voice}-{tag}"
        wav = TMP / f"{safe}.wav"
        teratts.write_wav(wav, audio)
        m4a = TMP / f"{safe}.m4a"
        subprocess.run(
            ["afconvert", "-f", "m4af", "-d", "aac", "-b", "48000", "-c", "1", str(wav), str(m4a)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        info = subprocess.run(["afinfo", str(m4a)], capture_output=True, text=True, check=True).stdout
        ms = 0
        for line in info.splitlines():
            if "estimated duration" in line:
                ms = int(float(line.split(":")[1].strip().split()[0]) * 1000)
        data = base64.b64encode(m4a.read_bytes()).decode()
        print(f"{voice} {tag} {text!r} {ms}ms ({time.time() - t0:.2f}s, {len(data) // 1024} КБ)", flush=True)
        return {"text": text, "ms": ms, "src": f"data:audio/mp4;base64,{data}"}

    for voice in voices:
        out["lines"][voice] = [
            synth(voice, text, f"line{i}") for i, text in enumerate(LINES.get(voice, []))
        ]
        for pack, phrase in PACKS.items():
            out["packs"].setdefault(pack, {})[voice] = synth(voice, phrase, f"pack-{pack}")
        out["samples"][voice] = synth(voice, SAMPLE, "sample")

    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"готово: {OUT} ({OUT.stat().st_size / 1024:.0f} КБ)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
