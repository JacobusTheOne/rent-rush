"""
Cuts a full board picture (7x7 layout, Start bottom-right, same square order as
the game) into the board art files in public/board/.

Usage (from the project root):
    npm run art:slice -- "path/to/board.png"           # writes squares + centre + background
    npm run art:slice -- "path/to/board.png" --dry-run # only prints the detected grid

The grid is detected from the dark gaps between squares, so the source does not
have to be perfectly regular. Non-square cells are padded by repeating their own
edge pixels (no stretched text) and then scaled to the size game/art.ts expects.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
INSET = 4  # px trimmed inside each detected square


def p90(values):
    s = sorted(values)
    return s[int(len(s) * 0.9)]


def gap_runs(profile, thr=150, min_width=3):
    """Runs where (almost) the whole band is dark: the gaps between squares."""
    runs, start = [], None
    for i, v in enumerate(profile + [255]):
        if v < thr and start is None:
            start = i
        elif v >= thr and start is not None:
            if i - start >= min_width:
                runs.append((start, i - 1))
            start = None
    return runs


def spans(profile, size, cells=7):
    """Pick the cells+1 real gaps: each next gap starts at least min_cell after the previous one."""
    runs = gap_runs(profile)
    min_cell = size / cells * 0.65
    chosen = [runs[0]]
    for r in runs[1:]:
        if r[0] >= chosen[-1][1] + min_cell:
            chosen.append(r)
    if len(chosen) != cells + 1:
        raise SystemExit(f"Could not find {cells} cells (found gaps {chosen}); is it a 7x7 board?")
    return [(chosen[k][1] + 1, chosen[k + 1][0]) for k in range(cells)]  # [start, end)


def square_by_edge_padding(img):
    """Make an image square by repeating its edge pixels (keeps text proportions)."""
    w, h = img.size
    if w == h:
        return img
    n = max(w, h)
    out = Image.new("RGB", (n, n))
    x0, y0 = (n - w) // 2, (n - h) // 2
    out.paste(img, (x0, y0))
    if w < n:  # pad left/right with the edge columns
        out.paste(img.crop((0, 0, 1, h)).resize((x0, h)), (0, y0)) if x0 else None
        right = n - x0 - w
        out.paste(img.crop((w - 1, 0, w, h)).resize((right, h)), (x0 + w, y0)) if right else None
    else:  # pad top/bottom with the edge rows
        out.paste(img.crop((0, 0, w, 1)).resize((w, y0)), (x0, 0)) if y0 else None
        bottom = n - y0 - h
        out.paste(img.crop((0, h - 1, w, h)).resize((w, bottom)), (x0, y0 + h)) if bottom else None
    return out


def board_index(row, col):
    """Grid (row, col), 0-based, to square index; inverse of gridPosition() in game/board.ts."""
    if row == 6:
        return 6 - col
    if col == 0:
        return 6 + (6 - row)
    if row == 0:
        return 12 + col
    if col == 6:
        return 18 + row
    return None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        raise SystemExit(__doc__)
    dry = "--dry-run" in sys.argv
    specs = json.loads(sys.stdin.read())  # from scripts/print-art-spec.ts (see npm run art:slice)
    src = Image.open(args[0]).convert("RGB")
    W, H = src.size
    gray = src.convert("L")
    px = gray.load()

    def prof_x(y0, y1):
        return [p90([px[x, y] for y in range(y0, y1)]) for x in range(W)]

    def prof_y(x0, x1):
        return [p90([px[x, y] for x in range(x0, x1)]) for y in range(H)]

    band = lambda k: (int(H * (k + 0.15) / 7), int(H * (k + 0.85) / 7))  # noqa: E731
    cols_top = spans(prof_x(*band(0)), W)
    cols_bottom = spans(prof_x(*band(6)), W)
    rows_left = spans(prof_y(*band(0)), H)
    rows_right = spans(prof_y(*band(6)), H)

    def cell_box(row, col):
        # Bottom-row cells use the bottom row's column edges; everything else the top row's.
        x0, x1 = (cols_bottom if row == 6 else cols_top)[col]
        y0, y1 = (rows_left if col == 0 else rows_right)[row]
        return (x0, y0, x1, y1)

    # Centre: between the inner edges of the side squares.
    cx0, cx1 = max(cols_top[0][1], cols_bottom[0][1]), min(cols_top[6][0], cols_bottom[6][0])
    cy0, cy1 = max(rows_left[0][1], rows_right[0][1]), min(rows_left[6][0], rows_right[6][0])
    # trim the dark gap around it
    cx0, cy0, cx1, cy1 = cx0 + 8, cy0 + 8, cx1 - 8, cy1 - 8

    print(f"source {W}x{H}")
    print("columns (top):", cols_top)
    print("rows (left):  ", rows_left)
    print(f"centre: x {cx0}-{cx1}, y {cy0}-{cy1} ({cx1 - cx0}x{cy1 - cy0})")
    if dry:
        return

    squares = [a for a in specs if a["kind"] == "square"]
    by_kind = {a["kind"]: a for a in specs if a["kind"] in ("center", "background")}

    def save(img, a):
        out = PUBLIC / a["src"].lstrip("/")
        out.parent.mkdir(parents=True, exist_ok=True)
        img.resize((a["width"], a["height"]), Image.LANCZOS).save(out, "JPEG", quality=90, optimize=True)

    written = 0
    for row in range(7):
        for col in range(7):
            i = board_index(row, col)
            if i is None:
                continue
            # Trim the tile's dark outline so edge padding repeats tile colour, not outline.
            x0, y0, x1, y1 = cell_box(row, col)
            cell = src.crop((x0 + INSET, y0 + INSET, x1 - INSET, y1 - INSET))
            save(square_by_edge_padding(cell), squares[i])
            written += 1

    # Centre: square crop from the middle (the source centre is rarely exactly square).
    cw, ch = cx1 - cx0, cy1 - cy0
    side = min(cw, ch)
    ox, oy = cx0 + (cw - side) // 2, cy0 + (ch - side) // 2
    save(src.crop((ox, oy, ox + side, oy + side)), by_kind["center"])
    written += 1

    # Background: only the gaps/edge show, so use the source's own gap colour with a soft texture.
    gap_px = [src.getpixel((x, (rows_left[k][1] + rows_left[k + 1][0]) // 2)) for k in range(6) for x in range(30, 150, 10)]
    gap_color = tuple(sorted(c[i] for c in gap_px)[len(gap_px) // 2] for i in range(3))
    bg = src.resize((256, 256)).filter(ImageFilter.GaussianBlur(40))
    bg = Image.blend(Image.new("RGB", bg.size, gap_color), bg, 0.25)
    save(bg, by_kind["background"])
    written += 1
    print(f"written: {written} files (gap colour {gap_color})")


if __name__ == "__main__":
    main()
