#!/usr/bin/env python3
"""x2ai-teratts — постоянный локальный TTS-сервер (TeraTTSv2, ONNX, CPU).

Слушает unix-сокет, принимает JSON-строки вида
    {"text": "Привет", "voice": "ru_f1", "duration_scale": 1.0}
синтезирует wav и проигрывает его через afplay. Модель грузится один раз,
поэтому озвучка стартует почти сразу; по простою сервер сам выходит.

Переменные окружения:
    TERATTS_DIR    каталог модели (по умолчанию ~/.config/opencode/teratts-model)
    TERATTS_SOCK   unix-сокет (по умолчанию /tmp/x2ai-teratts.sock)
    TERATTS_VOICE  голос (ru_f1, ru_f2, ru_m1, ru_m5; по умолчанию ru_f1)
    TERATTS_ACCENT dictionary|full (по умолчанию dictionary)
    TERATTS_IDLE   секунд простоя до выхода (по умолчанию 900)
"""
from __future__ import annotations

import json

import numpy as np
import os
import re
import socket
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path

HOME = Path.home()
ROOT = Path(os.environ.get("TERATTS_DIR", HOME / ".config/opencode/teratts-model"))
SOCK = Path(os.environ.get("TERATTS_SOCK", "/tmp/x2ai-teratts.sock"))
LOG = Path(os.environ.get("TERATTS_LOG", HOME / ".config/opencode/x2ai-teratts.log"))
STATE = Path(os.environ.get("TERATTS_STATE", HOME / ".config/opencode/x2ai-teratts.state"))
VOICE = os.environ.get("TERATTS_VOICE", "ru_f1")
_VFILE = HOME / ".config/opencode/teratts-voice.txt"
try:
    if _VFILE.exists():
        VOICE = _VFILE.read_text(encoding="utf-8").strip() or VOICE
except Exception:
    pass
ACCENT = os.environ.get("TERATTS_ACCENT", "dictionary")
IDLE = float(os.environ.get("TERATTS_IDLE", "600"))


def log(*args: object) -> None:
    try:
        line = time.strftime("%Y-%m-%dT%H:%M:%S") + " " + " ".join(str(a) for a in args)
        with LOG.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except Exception:
        pass


TARGET_DB = float(os.environ.get("TERATTS_RMS_DB", "-15"))
MAX_GAIN = float(os.environ.get("TERATTS_MAX_GAIN", "8"))
LIMIT_THR = float(os.environ.get("TERATTS_LIMIT", "0.97"))


def _limit(y, thr: float, block: int):
    """Мягкий лимитер: режет только пики, громкость фразы не трогает."""
    import numpy as np

    a = np.abs(y)
    if a.size == 0 or a.max() <= thr:
        return y
    blocks = -(-a.size // block)
    padded = np.pad(a, (0, blocks * block - a.size), mode="edge")
    peaks = padded.reshape(blocks, block).max(axis=1)
    gains = np.minimum(1.0, thr / np.maximum(peaks, 1e-6))
    g = np.repeat(gains, block)[: a.size]
    # сгладить ступеньки на границах блоков, чтобы не было щелчков
    k = max(1, block // 4)
    g = np.convolve(g, np.ones(k, dtype=np.float32) / k, mode="same")
    g = np.minimum(g, np.repeat(gains, block)[: a.size])
    return y * g


def loudify(audio):
    """Выровнять громкость фразы: RMS к цели, пики — лимитером."""
    import numpy as np

    if audio.size == 0:
        return audio
    target = 10 ** (TARGET_DB / 20.0)
    y = np.asarray(audio, dtype=np.float32)
    block = max(64, int(0.010 * 44100))
    for _ in range(3):
        rms = float(np.sqrt(np.mean(np.square(y))))
        if rms < 1e-6:
            return y
        gain = min(target / rms, MAX_GAIN)
        if abs(gain - 1.0) < 0.03:
            break
        y = _limit(y * gain, LIMIT_THR, block)
    return np.clip(y, -0.999, 0.999)


SR = 44100.0

# Характерные голоса поверх четырёх базовых: робот, демон, пришелец, кот,
# пингвин, призрак. Базовый голос даёт артикуляцию, FX — характер.
FX = {
    "fx_robot": {"base": "ru_m1", "ring": 55.0, "mix": 0.55, "bits": 7},
    "fx_demon": {"base": "ru_m5", "pitch": 0.80, "drive": 0.45, "reverb": 0.30},
    # Демонесса: женская артикуляция, но низко и с хрипотцой.
    "fx_demoness": {"base": "ru_f2", "pitch": 0.84, "vibrato": (5.5, 0.015), "drive": 0.62, "reverb": 0.30},
    "fx_alien": {"base": "ru_f2", "pitch": 1.16, "vibrato": (5.0, 0.030)},
    "fx_cat": {"base": "ru_f1", "pitch": 1.34},
    "fx_penguin": {"base": "ru_m1", "pitch": 1.55, "vibrato": (7.0, 0.020)},
    "fx_ghost": {"base": "ru_f2", "pitch": 0.96, "reverb": 0.55},
}


def _resample(y, k: float):
    """Скорость и высота вместе: k > 1 — выше и короче."""
    import numpy as np

    if abs(k - 1.0) < 1e-3:
        return y
    n = max(1, int(len(y) / k))
    idx = np.linspace(0, len(y) - 1, n)
    return np.interp(idx, np.arange(len(y)), y).astype(np.float32)


def _vibrato(y, freq: float, depth: float):
    import numpy as np

    n = len(y)
    t = np.arange(n) / SR
    rate = 1.0 + depth * np.sin(2 * np.pi * freq * t)
    pos = np.cumsum(rate)
    pos = pos / pos[-1] * (n - 1)
    return np.interp(pos, np.arange(n), y).astype(np.float32)


def _reverb(y, amount: float):
    import numpy as np

    out = y.astype(np.float32).copy()
    for delay, gain in ((0.07, 0.45), (0.13, 0.30), (0.21, 0.18)):
        d = int(delay * SR)
        if d >= len(y):
            continue
        out[d:] += y[:-d] * (gain * amount)
    return out



# Длинный текст модель читает сжато (предиктор длительности насыщается),
# поэтому режем на куски по границам предложений и склеиваем с паузами.
CHUNK_CHARS = int(os.environ.get("X2AI_TTS_CHUNK") or 240)
CHUNK_GAP = 0.22


def split_chunks(text: str, limit: int = CHUNK_CHARS) -> list:
    if len(text) <= limit:
        return [text]
    parts, cur = [], ""
    for piece in re.split(r"(?<=[.!?…])\s+", text):
        if not piece:
            continue
        if len(piece) > limit:
            for i in range(0, len(piece), limit):
                parts.append(piece[i:i + limit])
            cur = ""
            continue
        if len(cur) + len(piece) + 1 <= limit:
            cur = (cur + " " + piece).strip()
        else:
            if cur:
                parts.append(cur)
            cur = piece
    if cur:
        parts.append(cur)
    return parts


def synth(tts, text: str, voice: str, scale: float):
    import teratts

    # Теги языка нужны каждому куску, иначе модель ругается.
    tag = "ru"
    body = text
    m = re.match(r"^<(ru|en)>(.*)</\1>$", text, re.S)
    if m:
        tag, body = m.group(1), m.group(2)
    chunks = [f"<{tag}>{c}</{tag}>" for c in split_chunks(body)]
    if len(chunks) == 1:
        return teratts.generate_speech(tts, chunks[0], voice, duration_scale=scale)
    gap = np.zeros(int(CHUNK_GAP * float(teratts.SAMPLE_RATE)), dtype=np.float32)
    out = []
    for idx, chunk in enumerate(chunks):
        audio = teratts.generate_speech(tts, chunk, voice, duration_scale=scale)
        out.append(np.asarray(audio, dtype=np.float32).reshape(-1))
        if idx != len(chunks) - 1:
            out.append(gap)
    return np.concatenate(out)


def fx_spec(voice: str, emotion: str | None = None) -> dict | None:
    """Параметры обработки голоса с поправкой на настроение.

    up — успех: чуть выше и живее; down — ошибка: ниже, медленнее, с хрипотцой.
    """
    spec = FX.get(voice)
    if not spec:
        return None
    spec = dict(spec)
    if emotion == "up":
        spec["pitch"] = float(spec.get("pitch", 1.0)) * 1.06
        spec["reverb"] = float(spec.get("reverb", 0.0)) * 0.9
    elif emotion == "think":
        spec["pitch"] = float(spec.get("pitch", 1.0)) * 0.96
        spec["reverb"] = max(float(spec.get("reverb", 0.0)), 0.22)
        spec["drive"] = min(0.5, float(spec.get("drive", 0.0)) * 0.6)
    elif emotion == "down":
        spec["pitch"] = float(spec.get("pitch", 1.0)) * 0.92
        spec["drive"] = min(1.0, float(spec.get("drive", 0.0)) + 0.06)
        spec["reverb"] = float(spec.get("reverb", 0.0)) * 1.1
    return spec


def apply_fx(voice: str, audio, emotion: str | None = None):
    """Прогоняет базовый голос через характерную обработку."""
    import numpy as np

    spec = fx_spec(voice, emotion)
    if not spec:
        return audio
    y = np.asarray(audio, dtype=np.float32)
    if y.size == 0:
        return y
    if "pitch" in spec:
        y = _resample(y, spec["pitch"])
    if "vibrato" in spec:
        y = _vibrato(y, *spec["vibrato"])
    if "ring" in spec:
        t = np.arange(len(y)) / SR
        carrier = np.sin(2 * np.pi * spec["ring"] * t).astype(np.float32)
        mix = spec.get("mix", 0.5)
        y = y * (1 - mix) + y * carrier * mix
    if "bits" in spec:
        q = 2 ** spec["bits"]
        y = np.round(y * q) / q
    if "drive" in spec:
        g = 1.0 + 6.0 * spec["drive"]
        y = np.tanh(y * g) / np.tanh(g)
    if "reverb" in spec:
        y = _reverb(y, spec["reverb"])
    peak = float(np.max(np.abs(y))) or 1.0
    return (y / peak * 0.9).astype(np.float32)


def resolve_voice(voice: str) -> str:
    spec = FX.get(voice)
    return spec["base"] if spec else voice


def _socket_alive(path: Path) -> bool:
    """Есть ли уже живой сервер на этом сокете."""
    probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    probe.settimeout(1.0)
    try:
        probe.connect(str(path))
        return True
    except OSError:
        return False
    finally:
        try:
            probe.close()
        except OSError:
            pass


LOCK = Path("/tmp/x2ai-teratts.lock")


def main() -> int:
    # Один сервер на сокет: файловая блокировка атомарна и не даёт гонки
    # при одновременном запуске из нескольких запросов озвучки.
    lock_handle = open(LOCK, "w")
    try:
        import fcntl

        fcntl.flock(lock_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log("already running, exit")
        return 0

    # Сокет занимаем сразу: пока грузится модель, второй запуск уже
    # не сможет занять тот же сокет и выйдет, не съев ещё 800 МБ.
    try:
        SOCK.unlink()
    except FileNotFoundError:
        pass
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        srv.bind(str(SOCK))
    except OSError:
        log("socket busy, exit")
        return 0
    srv.listen(8)
    srv.settimeout(IDLE)

    sys.path.insert(0, str(ROOT))
    import teratts  # noqa: PLC0415

    started = time.time()
    tts = teratts.load_model(
        ROOT,
        model="distilled",
        provider="CPUExecutionProvider",
        # Не отдаём движку все 16 потоков: иначе синтез занимает все ядра
        # и ноут встаёт. 4 потоков хватает с запасом.
        threads=int(os.environ.get("X2AI_TTS_THREADS") or 4),
        russian_stress=True,
        ruaccent_mode=ACCENT,
    )
    log(f"loaded in {time.time() - started:.1f}s voice={VOICE} accent={ACCENT}")


    players: list[subprocess.Popen] = []

    def announce_playback(audio_s: float, sid: str = "", kind: str = "") -> None:
        """Сообщить персонажу в окне, что звук пошёл: файл читает GUI-плагин.

        sid нужен, чтобы губами двигал только тот чат, чья это озвучка.
        """
        try:
            STATE.write_text(
                json.dumps(
                    {
                        "speaking": True,
                        "ms": int(audio_s * 1000),
                        "at": time.time(),
                        "sid": sid,
                        "kind": kind,
                    }
                ),
                encoding="utf-8",
            )
        except Exception as exc:
            log(f"state write failed: {exc}")

    def sweep_wavs(max_age: float = 600.0) -> None:
        """Убрать старые wav, чтобы /tmp не пух."""
        now = time.time()
        for path in Path("/tmp").glob("x2ai-teratts-*.wav"):
            try:
                if now - path.stat().st_mtime > max_age:
                    path.unlink()
            except Exception:
                pass

    def stop_players() -> int:
        """Оборвать текущее воспроизведение: одна реплика за раз."""
        stopped = 0
        for p in players:
            if p.poll() is None:
                try:
                    p.terminate()
                    stopped += 1
                except Exception:
                    pass
        players.clear()
        return stopped

    sweep_wavs(0)
    while True:
        try:
            conn, _ = srv.accept()
        except socket.timeout:
            log("idle timeout, exit")
            break
        with conn:
            try:
                raw = b""
                while not raw.endswith(b"\n"):
                    chunk = conn.recv(65536)
                    if not chunk:
                        break
                    raw += chunk
                req = json.loads(raw.decode("utf-8") or "{}")
                if req.get("stop"):
                    stopped = stop_players()
                    log(f"stop {stopped}")
                    conn.sendall(json.dumps({"ok": True, "stopped": stopped}).encode() + b"\n")
                    continue
                text = " ".join(str(req.get("text", "")).split())
                if not text:
                    conn.sendall(b'{"ok":false,"error":"empty"}\n')
                    continue
                if "<ru>" not in text and "<en>" not in text:
                    text = f"<ru>{text}</ru>"
                sid = str(req.get("sid") or "")
                voice = req.get("voice") or VOICE
                scale = float(req.get("duration_scale", 1.0))
                emotion = str(req.get("emotion") or "").strip() or None
                if emotion == "up":
                    scale *= 0.96
                elif emotion == "down":
                    scale *= 1.06
                elif emotion == "think":
                    scale *= 1.10
                t0 = time.time()
                audio = synth(tts, text, resolve_voice(voice), scale)
                audio = apply_fx(voice, audio, emotion)
                audio = loudify(audio)
                gen_ms = (time.time() - t0) * 1000
                wav = Path(f"/tmp/x2ai-teratts-{os.getpid()}-{int(time.time() * 1000)}.wav")
                teratts.write_wav(wav, audio)
                audio_s = len(audio) / float(teratts.SAMPLE_RATE)
                stop_players()
                player = subprocess.Popen(
                    ["afplay", str(wav)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                players.append(player)
                announce_playback(
                    audio_s,
                    str(req.get("sid") or ""),
                    str(req.get("kind") or ""),
                )

                def _cleanup(p=player, f=wav):
                    p.wait()
                    try:
                        f.unlink()
                    except Exception:
                        pass

                threading.Thread(target=_cleanup, daemon=True).start()
                log(f"spoke {audio_s:.2f}s audio in {gen_ms:.0f}ms: {text[:60]}")
                conn.sendall(
                    (
                        json.dumps(
                            {
                                "ok": True,
                                "ms": round(gen_ms),
                                "audio": round(audio_s, 2),
                                "wav": str(wav),
                            }
                        )
                        + "\n"
                    ).encode("utf-8")
                )
            except Exception as exc:  # noqa: BLE001
                log("ERROR", exc, traceback.format_exc(limit=2))
                try:
                    conn.sendall(
                        (json.dumps({"ok": False, "error": str(exc)}) + "\n").encode("utf-8")
                    )
                except Exception:
                    pass
    try:
        SOCK.unlink()
    except FileNotFoundError:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
