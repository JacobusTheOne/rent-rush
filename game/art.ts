/**
 * Board artwork: every replaceable image, its file name and its pixel size.
 * Single source of truth for the board (components/Board.tsx) and for the
 * template generator (scripts/make-art-templates.py). See BOARD-ART.md.
 *
 * Files live in public/board/ and are served from /board/. A missing file
 * falls back to the built-in CSS look, so art can be added one piece at a time.
 */
import { BOARD, DISTRICTS, TOKEN_COLORS, TOKEN_ICONS, type Square } from "./board";

export const ART_BASE = "/board";

export type ArtKind = "square" | "center" | "background" | "token" | "die" | "card" | "deed";

export interface ArtSpec {
  kind: ArtKind;
  /** Path under public/ (and URL path), e.g. "/board/squares/01-mill-street.jpg". */
  src: string;
  width: number;
  height: number;
  /** What the image is for, shown in the template and the guide. */
  label: string;
  /** Extra data the template generator uses to draw a sensible starting point. */
  meta?: Record<string, string | number>;
}

export const SQUARE_PX = 300;

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function squareMeta(sq: Square): Record<string, string | number> {
  const meta: Record<string, string | number> = { name: sq.name, squareKind: sq.kind };
  if (sq.kind === "PROPERTY") {
    meta.price = sq.price;
    meta.color = DISTRICTS[sq.district].color;
    meta.district = DISTRICTS[sq.district].name;
  }
  if (sq.kind === "STATION") meta.price = sq.price;
  if (sq.kind === "TAX") meta.amount = sq.amount;
  return meta;
}

export const SQUARE_ART: ArtSpec[] = BOARD.map((sq, i) => ({
  kind: "square",
  src: `${ART_BASE}/squares/${String(i).padStart(2, "0")}-${slug(sq.name)}.jpg`,
  width: SQUARE_PX,
  height: SQUARE_PX,
  label: `Square ${i}: ${sq.name}`,
  meta: squareMeta(sq),
}));

export const CENTER_ART: ArtSpec = {
  kind: "center",
  src: `${ART_BASE}/center.jpg`,
  width: 1500,
  height: 1500,
  label: "Board centre (inside the ring of squares)",
};

export const BACKGROUND_ART: ArtSpec = {
  kind: "background",
  src: `${ART_BASE}/background.jpg`,
  width: 2100,
  height: 2100,
  label: "Whole-board background (shows in the gaps and border)",
};

/** One image per choosable icon (TOKEN_ICONS), shown as a circle in the player's colour ring. */
export const TOKEN_ART: ArtSpec[] = TOKEN_ICONS.map((name, i) => ({
  kind: "token",
  src: `${ART_BASE}/tokens/icon-${i + 1}-${slug(name)}.jpg`,
  width: 256,
  height: 256,
  label: `Token: ${name} (shown as a circle)`,
  meta: { color: TOKEN_COLORS[i % TOKEN_COLORS.length], n: i + 1, name },
}));

export const DIE_ART: ArtSpec[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  kind: "die",
  src: `${ART_BASE}/dice/die-${n}.jpg`,
  width: 160,
  height: 160,
  label: `Die face ${n}`,
  meta: { n },
}));

export const CARD_ART: ArtSpec = {
  kind: "card",
  src: `${ART_BASE}/cards/fortune.jpg`,
  width: 600,
  height: 340,
  label: "Fortune card background (card text is drawn on top)",
};

/**
 * Title-deed card images for every street and station, shown in the players' hands.
 * Made from the full-size originals in cards/ by `npm run art:deeds`.
 */
export const DEED_ART: Record<number, ArtSpec> = Object.fromEntries(
  BOARD.flatMap((sq, i) =>
    sq.kind === "PROPERTY" || sq.kind === "STATION"
      ? [
          [
            i,
            {
              kind: "deed" as const,
              src: `${ART_BASE}/deeds/${String(i).padStart(2, "0")}-${slug(sq.name)}.jpg`,
              width: 448,
              height: 600,
              label: `Title deed: ${sq.name}`,
              meta: { name: sq.name, source: `${sq.kind === "STATION" ? "station" : DISTRICTS[sq.district].name.toLowerCase().replace(/ /g, "_")}_${sq.name.toLowerCase().replace(/ /g, "_")}.jpg` },
            },
          ],
        ]
      : [],
  ),
);

export const ALL_ART: ArtSpec[] = [
  BACKGROUND_ART,
  CENTER_ART,
  ...SQUARE_ART,
  ...TOKEN_ART,
  ...DIE_ART,
  CARD_ART,
];
