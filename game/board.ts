/**
 * Rent Rush board: 24 squares around a 7x7 grid (vs. 40 in the classic game),
 * six two-street districts, three stations, Fortune cards, two taxes.
 * Shared by the game Lambda (rules) and the browser (rendering).
 */

export type DistrictId = "amber" | "teal" | "rose" | "sky" | "jade" | "royal";

export const DISTRICTS: Record<DistrictId, { name: string; color: string }> = {
  amber: { name: "Old Town", color: "#c98a3c" },
  teal: { name: "Harborside", color: "#2bb3a3" },
  rose: { name: "Lantern Quarter", color: "#e0608a" },
  sky: { name: "Hilltop", color: "#5aa9e6" },
  jade: { name: "Greenbelt", color: "#3fa34d" },
  royal: { name: "Gold Coast", color: "#8f6bea" },
};

export type Square =
  | { kind: "START"; name: string }
  | { kind: "CELL"; name: string }
  | { kind: "REST"; name: string }
  | { kind: "GO_TO_CELL"; name: string }
  | { kind: "FORTUNE"; name: string }
  | { kind: "TAX"; name: string; amount: number }
  | { kind: "STATION"; name: string; price: number }
  | { kind: "PROPERTY"; name: string; district: DistrictId; price: number };

export type OwnableSquare = Extract<Square, { kind: "STATION" | "PROPERTY" }>;

export const BOARD: Square[] = [
  { kind: "START", name: "Start" },
  { kind: "PROPERTY", name: "Mill Street", district: "amber", price: 60 },
  { kind: "PROPERTY", name: "Canal Walk", district: "amber", price: 80 },
  { kind: "FORTUNE", name: "Fortune" },
  { kind: "STATION", name: "North Station", price: 200 },
  { kind: "TAX", name: "Parking Fine", amount: 75 },
  { kind: "CELL", name: "Holding Cell" },
  { kind: "PROPERTY", name: "Pine Court", district: "teal", price: 100 },
  { kind: "PROPERTY", name: "Harbor View", district: "teal", price: 120 },
  { kind: "FORTUNE", name: "Fortune" },
  { kind: "PROPERTY", name: "Lantern Square", district: "rose", price: 140 },
  { kind: "PROPERTY", name: "Velvet Avenue", district: "rose", price: 160 },
  { kind: "REST", name: "Rest Stop" },
  { kind: "PROPERTY", name: "Cloud Terrace", district: "sky", price: 180 },
  { kind: "PROPERTY", name: "Summit Road", district: "sky", price: 200 },
  { kind: "STATION", name: "East Station", price: 200 },
  { kind: "PROPERTY", name: "Orchard Park", district: "jade", price: 220 },
  { kind: "PROPERTY", name: "Willow Drive", district: "jade", price: 240 },
  { kind: "GO_TO_CELL", name: "Go to Cell" },
  { kind: "PROPERTY", name: "Crown Heights", district: "royal", price: 280 },
  { kind: "FORTUNE", name: "Fortune" },
  { kind: "STATION", name: "South Station", price: 200 },
  { kind: "TAX", name: "Luxury Levy", amount: 150 },
  { kind: "PROPERTY", name: "Golden Mile", district: "royal", price: 320 },
];

export const BOARD_SIZE = BOARD.length;
export const CELL_INDEX = BOARD.findIndex((s) => s.kind === "CELL");

export const RULES = {
  startingCash: 1500,
  passStartBonus: 200,
  /** Twist: landing exactly on Start pays double. */
  landOnStartBonus: 400,
  /** Twist: landing on a street you own pays a small bonus. */
  homeTurfBonus: 20,
  bail: 50,
  maxCellAttempts: 3,
  maxLevel: 3,
  /** Rent multiplier per upgrade level (level 0 = bare street). */
  levelMultipliers: [1, 3, 6, 10],
  stationBaseRent: 25,
  /** Selling back to the bank returns this fraction of what you paid. */
  sellBackRate: 0.5,
  /** Other players may skip someone who hasn't acted for this long. */
  idleMs: 120_000,
  roundOptions: [10, 20, 30],
  minPlayers: 2,
  maxPlayers: 4,
} as const;

export const TOKEN_COLORS = ["#f2c94c", "#eb5757", "#56ccf2", "#6fcf97"];

export function isOwnable(sq: Square): sq is OwnableSquare {
  return sq.kind === "PROPERTY" || sq.kind === "STATION";
}

export function upgradeCost(sq: Extract<Square, { kind: "PROPERTY" }>): number {
  return sq.price / 2;
}

export function baseRent(sq: Extract<Square, { kind: "PROPERTY" }>): number {
  return Math.round(sq.price / 10);
}

export function districtSquares(district: DistrictId): number[] {
  return BOARD.flatMap((s, i) => (s.kind === "PROPERTY" && s.district === district ? [i] : []));
}

export const STATION_INDEXES = BOARD.flatMap((s, i) => (s.kind === "STATION" ? [i] : []));

/** Grid position (1-based row/col) of a square on the 7x7 board, Start bottom-right. */
export function gridPosition(index: number): { row: number; col: number } {
  if (index <= 6) return { row: 7, col: 7 - index };
  if (index <= 12) return { row: 7 - (index - 6), col: 1 };
  if (index <= 18) return { row: 1, col: 1 + (index - 12) };
  return { row: 1 + (index - 18), col: 7 };
}
