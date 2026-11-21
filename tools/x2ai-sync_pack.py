#!/usr/bin/env python3
"""Пережимает PNG из packs/<пак>/<голос>/ в packs/<пак>/sprites.json.

Зачем: pack_sprites.py берёт готовый sprites.json, если он есть, и PNG не
перечитывает. После правки PNG в папке нужно обновить JSON — этот скрипт и
делает это для одного персонажа (остальные записи не трогает).

  python3 tools/x2ai-sync_pack.py pixel x2ai_narik
  python3 tools/x2ai-sync_pack.py pixel x2ai_narik idle2   # если добавился кадр
"""
import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
HEIGHT = 336


def uri(path: Path) -> str:
    img = Image.open(path).convert("RGBA")
    # Спрайты выше эталона (самурай с пучком — 362 px) не сплющиваем:
    # GUI сам рисует их пропорционально выше, низ кадра остаётся на месте.
    if img.height < HEIGHT:
        ratio = HEIGHT / img.height
        img = img.resize((max(1, int(round(img.width * ratio))), HEIGHT), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=86, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    pack, voice = sys.argv[1], sys.argv[2]
    src_dir = ROOT / "packs" / pack / voice
    if not src_dir.is_dir():
        print(f"нет папки {src_dir}")
        return 1
    p = ROOT / "packs" / pack / "sprites.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    entry = data.setdefault(voice, {})
    updated = []
    for png in sorted(src_dir.glob("*.png")):
        entry[png.stem] = uri(png)
        updated.append(png.stem)
    p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"{pack}/{voice}: обновлено {len(updated)} кадров — {', '.join(updated)}")
    print("дальше: python3 tools/pack_sprites.py && python3 tools/build.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
