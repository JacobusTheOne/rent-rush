// Writes every ownable property card (streets and stations) to cards/property-cards.json,
// computed from the real rules in game/board.ts so the numbers always match the game.
// Usage: npm run cards:export
import { mkdirSync, writeFileSync } from "node:fs";
import {
  BOARD,
  DISTRICTS,
  RULES,
  STATION_INDEXES,
  baseRent,
  districtSquares,
  upgradeCost,
} from "../game/board";
import { SQUARE_ART } from "../game/art";

const streets = BOARD.flatMap((sq, index) => {
  if (sq.kind !== "PROPERTY") return [];
  const base = baseRent(sq);
  const upgrade = upgradeCost(sq);
  const partner = districtSquares(sq.district).find((i) => i !== index)!;
  return [
    {
      type: "street",
      boardIndex: index,
      name: sq.name,
      district: { id: sq.district, name: DISTRICTS[sq.district].name, color: DISTRICTS[sq.district].color },
      partnerStreet: BOARD[partner].name,
      price: sq.price,
      rent: {
        bare: base,
        wholeDistrict: base * 2,
        level1: base * RULES.levelMultipliers[1],
        level2: base * RULES.levelMultipliers[2],
        level3: base * RULES.levelMultipliers[3],
      },
      upgradeCost: upgrade,
      maxLevel: RULES.maxLevel,
      sellBack: { property: sq.price * RULES.sellBackRate, perUpgrade: upgrade * RULES.sellBackRate },
      homeTurfBonus: RULES.homeTurfBonus,
      image: SQUARE_ART[index].src,
    },
  ];
});

const stations = STATION_INDEXES.map((index) => {
  const sq = BOARD[index] as Extract<(typeof BOARD)[number], { kind: "STATION" }>;
  return {
    type: "station",
    boardIndex: index,
    name: sq.name,
    price: sq.price,
    rent: Object.fromEntries(
      STATION_INDEXES.map((_, i) => [`own${i + 1}`, RULES.stationBaseRent * 2 ** i]),
    ) as Record<string, number>,
    sellBack: { property: sq.price * RULES.sellBackRate },
    image: SQUARE_ART[index].src,
  };
});

const out = {
  description:
    "Rent Rush property cards, generated from game/board.ts by `npm run cards:export`. Do not edit by hand.",
  notes: {
    rent: "Bare rent is 10% of the price; owning both streets of a district doubles it. Upgrades need the whole district and multiply bare rent by 3 / 6 / 10.",
    stations: "Station rent depends on how many stations the owner holds.",
    sellBack: `Selling to the bank returns ${RULES.sellBackRate * 100}% of what was paid; a district's upgrades must be sold before its streets.`,
    homeTurf: `Landing on your own street pays you $${RULES.homeTurfBonus}.`,
  },
  districts: Object.entries(DISTRICTS).map(([id, d]) => ({
    id,
    ...d,
    streets: districtSquares(id as keyof typeof DISTRICTS).map((i) => BOARD[i].name),
  })),
  cards: [...streets, ...stations].sort((a, b) => a.boardIndex - b.boardIndex),
};

mkdirSync(new URL("../cards/", import.meta.url), { recursive: true });
const file = new URL("../cards/property-cards.json", import.meta.url);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${out.cards.length} cards (${streets.length} streets, ${stations.length} stations) to cards/property-cards.json`);
