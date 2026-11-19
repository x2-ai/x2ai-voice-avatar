#!/usr/bin/env python3
"""Отправка запроса озвучки в тёплый сервер teratts.

Код выхода: 0 — озвучено, 1 — ошибка, 3 — сервер не запущен,
4 — файл сокета есть, но слушателя нет (устаревший сокет).
"""

import errno
import json
import os
import socket
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "no socket"}))
        return 1
    sock_path = sys.argv[1]
    try:
        wait = float(os.environ.get("TERATTS_WAIT") or 300)
    except ValueError:
        wait = 300.0
    try:
        scale = float(os.environ.get("X2AI_TTS_SCALE") or 1.0)
    except ValueError:
        scale = 1.0

    payload = json.dumps(
        {
            "text": os.environ.get("X2AI_TTS_TEXT", ""),
            "voice": os.environ.get("X2AI_TTS_VOICE") or None,
            "sid": os.environ.get("X2AI_TTS_SID") or "",
            "duration_scale": scale,
            "emotion": (os.environ.get("X2AI_TTS_EMOTION") or "").strip() or None,
            "kind": (os.environ.get("X2AI_TTS_KIND") or "").strip() or None,
        }
    ).encode() + b"\n"

    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(wait)
    try:
        sock.connect(sock_path)
    except OSError as exc:
        # 3 — файла сокета нет (сервер не запущен), 4 — файл есть, но никто
        # не слушает (сервер умер и оставил мусор). Это разные починки:
        # в первом случае сокет трогать нельзя, во втором — надо удалить.
        return 4 if exc.errno == errno.ECONNREFUSED else 3
    try:
        sock.sendall(payload)
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = sock.recv(65536)
            if not chunk:
                break
            buf += chunk
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1
    finally:
        try:
            sock.close()
        except OSError:
            pass

    line = buf.decode("utf-8", "replace").strip() or '{"ok":false}'
    print(line)
    try:
        return 0 if json.loads(line).get("ok") else 1
    except Exception:  # noqa: BLE001
        return 1


if __name__ == "__main__":
    sys.exit(main())
