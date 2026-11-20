"""Resizes the full-size title-deed cards in cards/ into public/board/deeds/ for the web.

Reads the list of deeds as JSON on stdin (scripts/print-deed-spec.ts). Each source file is
cards/<district>_<street>.jpg (stations: station_<name>.jpg), e.g. cards/old_town_mill_street.jpg.
Usage: npm run art:deeds
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
specs = json.load(sys.stdin)
missing = []
for spec in specs:
    src = os.path.join(ROOT, "cards", spec["meta"]["source"])
    if not os.path.exists(src):
        missing.append(spec["meta"]["source"])
        continue
    out = os.path.join(ROOT, "public", spec["src"].lstrip("/"))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im = Image.open(src).convert("RGB")
    im = im.resize((spec["width"], spec["height"]), Image.LANCZOS)
    im.save(out, "JPEG", quality=85, optimize=True, progressive=True)
    print(f"{spec['meta']['source']:40} -> {spec['src']} ({os.path.getsize(out) // 1024} KB)")
if missing:
    print("Missing (the game shows the built-in card instead):", ", ".join(missing))
