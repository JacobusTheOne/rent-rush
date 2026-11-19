"""
Cuts a 2x2 sheet of player figures (on a light background) into the four
token images, cropped to head and shoulders because tokens are shown as small
circles.

Usage (from the project root):
    npm run art:tokens -- "Glossy Board-Game Player Tokens.png"
    npm run art:tokens -- "sheet.png" --order 4,2,3,1

--order lists which sheet position (1 = top-left, 2 = top-right,
3 = bottom-left, 4 = bottom-right) becomes token 1..4. Token N is player N,
whose colour is TOKEN_COLORS[N-1] in game/board.ts: 1 yellow, 2 red, 3 blue,
4 green. The default 4,1,2,3 suits the Glossy sheet (bases yellow, red,
blue, green).
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "board" / "tokens"
SIZE = 128  # must match TOKEN_ART in game/art.ts
HEAD_FRACTION = 0.66  # square side as a fraction of the figure's height


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("--"):
        raise SystemExit(__doc__)
    order = [4, 1, 2, 3]
    if "--order" in args:
        order = [int(n) for n in args[args.index("--order") + 1].split(",")]
    sheet = Image.open(args[0]).convert("RGB")
    W, H = sheet.size
    quads = [(0, 0, W // 2, H // 2), (W // 2, 0, W, H // 2), (0, H // 2, W // 2, H), (W // 2, H // 2, W, H)]
    OUT.mkdir(parents=True, exist_ok=True)

    for token, pos in enumerate(order, start=1):
        x0, y0, x1, y1 = quads[pos - 1]
        q = sheet.crop((x0, y0, x1, y1))
        mask = ImageChops.difference(q, Image.new("RGB", q.size, "white")).convert("L").point(lambda v: 255 if v > 40 else 0)
        fx0, fy0, fx1, fy1 = mask.getbbox()
        head = mask.crop((fx0, fy0, fx1, fy0 + int((fy1 - fy0) * 0.35))).getbbox()
        side = int((fy1 - fy0) * HEAD_FRACTION)
        cx = x0 + fx0 + (head[0] + head[2]) // 2
        top = max(0, y0 + fy0 - 8)
        box = (cx - side // 2, top, cx - side // 2 + side, top + side)
        # Pad with white if the square runs off the sheet.
        canvas = Image.new("RGB", (side, side), "white")
        canvas.paste(sheet.crop(box), (0, 0))
        canvas.resize((SIZE, SIZE), Image.LANCZOS).save(OUT / f"token-{token}.jpg", "JPEG", quality=92, optimize=True)
        print(f"token-{token}.jpg <- sheet position {pos}, crop {box}")


if __name__ == "__main__":
    main()
