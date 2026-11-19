"""
Draws starter/template JPGs for every board image listed in game/art.ts.

Usage (from the project root):
    npm run art:templates            # create only the files that are missing
    npm run art:templates -- --force # overwrite everything (destroys your art!)

Reads the spec as JSON on stdin (see scripts/print-art-spec.ts). Each template is
drawn at the exact size the game expects, with faint dashed boxes marking where
the game draws live information on top (tokens, owner marker, dice, ...).
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
FORCE = "--force" in sys.argv

FONT_DIR = Path("C:/Windows/Fonts")
CREAM, CORNER, INK, GUIDE = "#f4efe1", "#e3dcc6", "#1e2a30", "#9aa7ad"
GREEN_DARK, GREEN, GOLD = "#0b2a22", "#173a32", "#f2c94c"


def font(size, bold=False, symbol=False):
    names = ["seguisym.ttf"] if symbol else (["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"])
    for name in names:
        try:
            return ImageFont.truetype(str(FONT_DIR / name), size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def centered(d, xy, text, f, fill):
    d.text(xy, text, font=f, fill=fill, anchor="mm")


def wrap(d, text, f, max_width):
    words, lines, line = text.split(), [], ""
    for w in words:
        test = f"{line} {w}".strip()
        if d.textlength(test, font=f) <= max_width or not line:
            line = test
        else:
            lines.append(line)
            line = w
    lines.append(line)
    return lines


def dashed_box(d, box, label, color=GUIDE, dash=10, width=2, label_size=16):
    x0, y0, x1, y1 = box
    for x in range(x0, x1, dash * 2):
        d.line([(x, y0), (min(x + dash, x1), y0)], fill=color, width=width)
        d.line([(x, y1), (min(x + dash, x1), y1)], fill=color, width=width)
    for y in range(y0, y1, dash * 2):
        d.line([(x0, y), (x0, min(y + dash, y1))], fill=color, width=width)
        d.line([(x1, y), (x1, min(y + dash, y1))], fill=color, width=width)
    if label:
        centered(d, ((x0 + x1) // 2, (y0 + y1) // 2), label, font(label_size), color)


def size_note(d, spec, color=GUIDE, size=14):
    d.text((8, 6), f"{spec['width']}x{spec['height']}", font=font(size), fill=color)


def draw_train(d, cx, cy, s, fill):
    d.rounded_rectangle([cx - s, cy - s * 0.7, cx + s, cy + s * 0.5], radius=s * 0.25, fill=fill)
    for wx in (-0.55, 0.15):
        d.rectangle([cx + s * wx, cy - s * 0.45, cx + s * (wx + 0.4), cy - s * 0.05], fill=CREAM)
    for wx in (-0.55, 0.55):
        d.ellipse([cx + s * wx - s * 0.2, cy + s * 0.4, cx + s * wx + s * 0.2, cy + s * 0.8], fill=fill)


def square(spec):
    W, H = spec["width"], spec["height"]
    m = spec["meta"]
    kind = m["squareKind"]
    corner = kind in ("START", "CELL", "REST", "GO_TO_CELL")
    img = Image.new("RGB", (W, H), CORNER if corner else CREAM)
    d = ImageDraw.Draw(img)
    top = 0
    if kind == "PROPERTY":
        top = int(H * 0.22)
        d.rectangle([0, 0, W, top], fill=m["color"])
        centered(d, (W // 2, top // 2), m["district"].upper(), font(22, bold=True), "white")

    icons = {"START": "➜", "CELL": "▦", "REST": "★", "GO_TO_CELL": "⚠", "FORTUNE": "?", "TAX": "$"}
    name_y = top + int(H * 0.2)
    if kind == "STATION":
        draw_train(d, W // 2, int(H * 0.3), W * 0.12, INK)
        name_y = int(H * 0.56)
    elif kind in icons:
        centered(d, (W // 2, int(H * 0.32)), icons[kind], font(int(H * 0.27), symbol=True), INK)
        name_y = int(H * 0.6)

    f = font(34, bold=True)
    lines = wrap(d, m["name"], f, W - 40)
    for k, line in enumerate(lines):
        centered(d, (W // 2, name_y + k * 40), line, f, INK)

    if "price" in m:
        centered(d, (W // 2, int(H * (0.72 if kind == 'PROPERTY' else 0.73))), f"${m['price']}", font(30), INK)
    if "amount" in m:
        centered(d, (W // 2, int(H * 0.73)), f"Pay ${m['amount']}", font(26), INK)

    # Live overlays drawn by the game: owner badge (top-right), player tokens (bottom-left).
    dashed_box(d, (W - 80, 6, W - 6, 44), "owner", label_size=13)
    dashed_box(d, (6, H - 50, W - 90, H - 6), "player tokens", label_size=14)
    size_note(d, spec)
    return img


def center(spec):
    W, H = spec["width"], spec["height"]
    img = Image.new("RGB", (W, H), GREEN_DARK)
    d = ImageDraw.Draw(img)
    for r in range(W // 2, 0, -12):  # soft radial glow
        t = r / (W / 2)
        c = tuple(int(a + (b - a) * (1 - t)) for a, b in zip((11, 42, 34), (23, 58, 50)))
        d.ellipse([W // 2 - r, H // 2 - r, W // 2 + r, H // 2 + r], fill=c)
    title = Image.new("RGBA", (W, 300), (0, 0, 0, 0))
    centered(ImageDraw.Draw(title), (W // 2, 150), "RENT RUSH", font(210, bold=True), GOLD)
    title = title.rotate(8, expand=False, resample=Image.BICUBIC)
    img.paste(title, (0, int(H * 0.12)), title)
    dashed_box(d, (W // 2 - 420, int(H * 0.3), W // 2 + 420, int(H * 0.78)),
               "live info drawn here: round, dice, Jackpot, Fortune card", color="#6f8f84", dash=18, width=4, label_size=34)
    size_note(d, spec, color="#6f8f84", size=30)
    return img


def background(spec):
    W, H = spec["width"], spec["height"]
    img = Image.new("RGB", (W, H), GREEN_DARK)
    d = ImageDraw.Draw(img)
    cell = W / 7
    for r in range(7):  # where the squares sit (they cover most of the background)
        for c in range(7):
            if r in (0, 6) or c in (0, 6):
                d.rectangle([c * cell + 6, r * cell + 6, (c + 1) * cell - 6, (r + 1) * cell - 6], outline="#24584a", width=3)
    d.rectangle([cell + 6, cell + 6, 6 * cell - 6, 6 * cell - 6], outline="#24584a", width=3)
    centered(d, (W // 2, H // 2), "Board background: only the gaps and edge show", font(48), "#3d7a68")
    size_note(d, spec, color="#3d7a68", size=36)
    return img


def token(spec):
    W, H = spec["width"], spec["height"]
    img = Image.new("RGB", (W, H), spec["meta"]["color"])
    d = ImageDraw.Draw(img)
    d.ellipse([10, 10, W - 10, H - 10], outline="white", width=6)
    centered(d, (W // 2, H // 2), str(spec["meta"]["n"]), font(64, bold=True), "white")
    return img  # shown cropped to a circle


def die(spec):
    W, H = spec["width"], spec["height"]
    img = Image.new("RGB", (W, H), "#f7f7f2")
    d = ImageDraw.Draw(img)
    n = spec["meta"]["n"]
    p = {"tl": (0.27, 0.27), "tr": (0.73, 0.27), "ml": (0.27, 0.5), "c": (0.5, 0.5),
         "mr": (0.73, 0.5), "bl": (0.27, 0.73), "br": (0.73, 0.73)}
    layout = {1: ["c"], 2: ["tl", "br"], 3: ["tl", "c", "br"], 4: ["tl", "tr", "bl", "br"],
              5: ["tl", "tr", "c", "bl", "br"], 6: ["tl", "tr", "ml", "mr", "bl", "br"]}[n]
    r = W * 0.08
    for key in layout:
        x, y = p[key][0] * W, p[key][1] * H
        d.ellipse([x - r, y - r, x + r, y + r], fill=INK)
    return img


def card(spec):
    W, H = spec["width"], spec["height"]
    img = Image.new("RGB", (W, H), "#f6ecd2")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([8, 8, W - 8, H - 8], radius=18, outline="#b48a3c", width=6)
    centered(d, (W - 70, H // 2), "?", font(220, bold=True), "#eadcb6")
    centered(d, (W // 2, 40), "FORTUNE", font(36, bold=True), "#8a6420")
    dashed_box(d, (40, 80, W - 40, H - 30), "card text drawn here", label_size=22)
    size_note(d, spec)
    return img


DRAW = {"square": square, "center": center, "background": background, "token": token, "die": die, "card": card}


def main():
    specs = json.load(sys.stdin)
    made = skipped = 0
    for spec in specs:
        out = PUBLIC / spec["src"].lstrip("/")
        if out.exists() and not FORCE:
            skipped += 1
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        img = DRAW[spec["kind"]](spec)
        assert img.size == (spec["width"], spec["height"]), spec["src"]
        img.save(out, "JPEG", quality=88, optimize=True)
        made += 1
    print(f"templates written: {made}, kept existing: {skipped}")


if __name__ == "__main__":
    main()
