/**
 * Rent Rush rules engine. Pure functions: (state, actor, action) -> new state.
 * Runs authoritatively in the game Lambda; the browser only renders the result.
 */
import {
  BOARD,
  BOARD_SIZE,
  CELL_INDEX,
  RULES,
  STATION_INDEXES,
  baseRent,
  districtSquares,
  isOwnable,
  upgradeCost,
  type OwnableSquare,
  type Square,
} from "./board";

export type Phase = "ROLL" | "BUY" | "DEBT" | "END" | "OVER";

export interface PlayerState {
  id: string;
  name: string;
  token: number;
  cash: number;
  position: number;
  inCell: boolean;
  cellAttempts: number;
  freeCards: number;
  bankrupt: boolean;
  /** Computer-controlled player; its moves come from chooseBotAction(). */
  bot?: boolean;
}

export interface Holding {
  owner: string;
  level: number;
}

export interface Debt {
  amount: number;
  /** Player id, or null when owed to the Jackpot. */
  to: string | null;
  reason: string;
}

export interface LogEntry {
  n: number;
  text: string;
}

export interface GameState {
  players: PlayerState[];
  current: number;
  phase: Phase;
  dice: [number, number] | null;
  doublesStreak: number;
  extraRoll: boolean;
  pendingBuy: number | null;
  debt: Debt | null;
  /** Keyed by square index (string because the state is stored as JSON). */
  holdings: Record<string, Holding>;
  jackpot: number;
  round: number;
  maxRounds: number;
  turnStartedAt: number;
  lastCard: string | null;
  log: LogEntry[];
  logSeq: number;
  winner: string | null;
  /** Increments on every dice roll (lets the UI animate the dice). Absent in older saved games. */
  rollSeq?: number;
  /** Increments on every action that moved a piece. */
  moveSeq?: number;
  /** The piece movements caused by the most recent action, in order (for animation). */
  lastMoves?: Move[];
}

/** One piece movement. steps > 0 walks forward, < 0 walks back, 0 = direct jump. */
export interface Move {
  player: string;
  from: number;
  to: number;
  steps: number;
}

export type Action =
  | { type: "ROLL" }
  | { type: "BUY" }
  | { type: "DECLINE" }
  | { type: "PAY_BAIL" }
  | { type: "USE_CARD" }
  | { type: "UPGRADE"; square: number }
  | { type: "SELL_UPGRADE"; square: number }
  | { type: "SELL_PROPERTY"; square: number }
  | { type: "PAY_DEBT" }
  | { type: "BANKRUPT" }
  | { type: "END_TURN" }
  | { type: "FORFEIT" }
  | { type: "SKIP_IDLE" };

export const ACTION_TYPES: ReadonlySet<string> = new Set([
  "ROLL", "BUY", "DECLINE", "PAY_BAIL", "USE_CARD", "UPGRADE", "SELL_UPGRADE",
  "SELL_PROPERTY", "PAY_DEBT", "BANKRUPT", "END_TURN", "FORFEIT", "SKIP_IDLE",
]);

export interface Ctx {
  /** Uniform random integer in [0, max). */
  rng: (max: number) => number;
  now: number;
}

export class RuleError extends Error {}

const MAX_LOG = 40;

// ---------------------------------------------------------------- setup

export function newGame(
  players: { id: string; name: string; bot?: boolean | null }[],
  maxRounds: number,
  ctx: Ctx,
): GameState {
  // Random turn order.
  const order = [...players];
  for (let i = order.length - 1; i > 0; i--) {
    const j = ctx.rng(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const s: GameState = {
    players: order.map((p, i) => ({
      id: p.id,
      name: p.name,
      token: i,
      cash: RULES.startingCash,
      position: 0,
      inCell: false,
      cellAttempts: 0,
      freeCards: 0,
      bankrupt: false,
      ...(p.bot ? { bot: true } : {}),
    })),
    current: 0,
    phase: "ROLL",
    dice: null,
    doublesStreak: 0,
    extraRoll: false,
    pendingBuy: null,
    debt: null,
    holdings: {},
    jackpot: 0,
    round: 1,
    maxRounds,
    turnStartedAt: ctx.now,
    lastCard: null,
    log: [],
    logSeq: 0,
    winner: null,
    rollSeq: 0,
    moveSeq: 0,
    lastMoves: [],
  };
  log(s, `Game on! ${s.players[0].name} goes first. ${maxRounds} rounds.`);
  return s;
}

// ---------------------------------------------------------------- queries

export function ownedBy(s: GameState, playerId: string): number[] {
  return Object.entries(s.holdings)
    .filter(([, h]) => h.owner === playerId)
    .map(([i]) => Number(i))
    .sort((a, b) => a - b);
}

export function ownsDistrict(s: GameState, playerId: string, square: number): boolean {
  const sq = BOARD[square];
  if (sq.kind !== "PROPERTY") return false;
  return districtSquares(sq.district).every((i) => s.holdings[i]?.owner === playerId);
}

export function rentFor(s: GameState, square: number): number {
  const sq = BOARD[square];
  const h = s.holdings[square];
  if (!h) return 0;
  if (sq.kind === "STATION") {
    const count = STATION_INDEXES.filter((i) => s.holdings[i]?.owner === h.owner).length;
    return RULES.stationBaseRent * 2 ** (count - 1);
  }
  if (sq.kind !== "PROPERTY") return 0;
  const base = baseRent(sq);
  if (h.level > 0) return base * RULES.levelMultipliers[h.level];
  return ownsDistrict(s, h.owner, square) ? base * 2 : base;
}

export function netWorth(s: GameState, playerId: string): number {
  const p = s.players.find((x) => x.id === playerId);
  if (!p || p.bankrupt) return 0;
  return ownedBy(s, playerId).reduce((sum, i) => {
    const sq = BOARD[i];
    if (sq.kind === "PROPERTY") return sum + sq.price + s.holdings[i].level * upgradeCost(sq);
    if (sq.kind === "STATION") return sum + sq.price;
    return sum;
  }, p.cash);
}

export function canUpgrade(s: GameState, playerId: string, square: number): string | null {
  const sq = BOARD[square];
  const h = s.holdings[square];
  if (!sq || sq.kind !== "PROPERTY") return "Only streets can be upgraded";
  if (!h || h.owner !== playerId) return "You don't own that street";
  if (!ownsDistrict(s, playerId, square)) return "Own the whole district first";
  if (h.level >= RULES.maxLevel) return "Already at max level";
  const p = s.players.find((x) => x.id === playerId)!;
  if (p.cash < upgradeCost(sq)) return "Not enough cash";
  return null;
}

export function canSellProperty(s: GameState, playerId: string, square: number): string | null {
  const sq = BOARD[square];
  const h = s.holdings[square];
  if (!sq || !isOwnable(sq)) return "Not a property";
  if (!h || h.owner !== playerId) return "You don't own that";
  if (sq.kind === "PROPERTY" && districtSquares(sq.district).some((i) => (s.holdings[i]?.level ?? 0) > 0)) {
    return "Sell the district's upgrades first";
  }
  return null;
}

// ---------------------------------------------------------------- actions

export function applyAction(state: GameState, actorId: string, action: Action, ctx: Ctx): GameState {
  const s = structuredClone(state);
  s.lastMoves = [];
  if (s.phase === "OVER") throw new RuleError("The game is over");

  const actor = s.players.find((p) => p.id === actorId);
  if (!actor) throw new RuleError("You are not in this game");
  if (actor.bankrupt) throw new RuleError("You are out of the game");

  // Actions anyone in the game may take, regardless of turn.
  if (action.type === "FORFEIT") {
    goBankrupt(s, actor, null, `${actor.name} left the game.`, ctx);
    return s;
  }
  if (action.type === "SKIP_IDLE") {
    skipIdle(s, actor, ctx);
    return s;
  }

  const p = s.players[s.current];
  if (p.id !== actorId) throw new RuleError("It's not your turn");

  switch (action.type) {
    case "ROLL":
      requirePhase(s, "ROLL");
      roll(s, p, ctx);
      break;
    case "BUY": {
      requirePhase(s, "BUY");
      const sq = BOARD[s.pendingBuy!];
      if (!isOwnable(sq)) throw new RuleError("Nothing to buy");
      if (p.cash < sq.price) throw new RuleError("Not enough cash");
      p.cash -= sq.price;
      s.holdings[s.pendingBuy!] = { owner: p.id, level: 0 };
      log(s, `${p.name} bought ${sq.name} for $${sq.price}.`);
      s.pendingBuy = null;
      resume(s);
      break;
    }
    case "DECLINE": {
      requirePhase(s, "BUY");
      log(s, `${p.name} passed on ${BOARD[s.pendingBuy!].name}.`);
      s.pendingBuy = null;
      resume(s);
      break;
    }
    case "PAY_BAIL":
      requirePhase(s, "ROLL");
      if (!p.inCell) throw new RuleError("You're not in the Holding Cell");
      if (p.cash < RULES.bail) throw new RuleError("Not enough cash for bail");
      p.cash -= RULES.bail;
      s.jackpot += RULES.bail;
      p.inCell = false;
      p.cellAttempts = 0;
      log(s, `${p.name} paid $${RULES.bail} bail.`);
      break;
    case "USE_CARD":
      requirePhase(s, "ROLL");
      if (!p.inCell) throw new RuleError("You're not in the Holding Cell");
      if (p.freeCards < 1) throw new RuleError("You have no Walk Free card");
      p.freeCards -= 1;
      p.inCell = false;
      p.cellAttempts = 0;
      log(s, `${p.name} used a Walk Free card.`);
      break;
    case "UPGRADE": {
      if (s.phase !== "ROLL" && s.phase !== "END") throw new RuleError("You can't upgrade right now");
      const why = canUpgrade(s, p.id, action.square);
      if (why) throw new RuleError(why);
      const sq = BOARD[action.square] as Extract<Square, { kind: "PROPERTY" }>;
      p.cash -= upgradeCost(sq);
      s.holdings[action.square].level += 1;
      log(s, `${p.name} upgraded ${sq.name} to level ${s.holdings[action.square].level}.`);
      break;
    }
    case "SELL_UPGRADE": {
      if (s.phase === "BUY") throw new RuleError("Decide on the purchase first");
      const sq = BOARD[action.square];
      const h = s.holdings[action.square];
      if (sq?.kind !== "PROPERTY" || h?.owner !== p.id || h.level < 1) throw new RuleError("No upgrade to sell");
      h.level -= 1;
      const refund = upgradeCost(sq) * RULES.sellBackRate;
      p.cash += refund;
      log(s, `${p.name} sold an upgrade on ${sq.name} for $${refund}.`);
      break;
    }
    case "SELL_PROPERTY": {
      if (s.phase === "BUY") throw new RuleError("Decide on the purchase first");
      const why = canSellProperty(s, p.id, action.square);
      if (why) throw new RuleError(why);
      const sq = BOARD[action.square] as Extract<Square, { kind: "PROPERTY" | "STATION" }>;
      delete s.holdings[action.square];
      const refund = sq.price * RULES.sellBackRate;
      p.cash += refund;
      log(s, `${p.name} sold ${sq.name} back to the bank for $${refund}.`);
      break;
    }
    case "PAY_DEBT": {
      requirePhase(s, "DEBT");
      const debt = s.debt!;
      if (p.cash < debt.amount) throw new RuleError("Not enough cash yet: sell something first");
      transfer(s, p, debt.to, debt.amount);
      log(s, `${p.name} paid $${debt.amount} (${debt.reason}).`);
      s.debt = null;
      resume(s);
      break;
    }
    case "BANKRUPT":
      requirePhase(s, "DEBT");
      goBankrupt(s, p, s.debt!.to, `${p.name} went bankrupt!`, ctx);
      break;
    case "END_TURN":
      requirePhase(s, "END");
      advanceTurn(s, ctx);
      break;
    default:
      throw new RuleError("Unknown action");
  }
  if (s.lastMoves?.length) s.moveSeq = (s.moveSeq ?? 0) + 1;
  return s;
}

function recordMove(s: GameState, p: PlayerState, to: number, steps: number) {
  (s.lastMoves ??= []).push({ player: p.id, from: p.position, to, steps });
}

// ---------------------------------------------------------------- internals

function log(s: GameState, text: string) {
  s.logSeq += 1;
  s.log.push({ n: s.logSeq, text });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

function requirePhase(s: GameState, phase: Phase) {
  if (s.phase !== phase) throw new RuleError(`You can't do that now (phase: ${s.phase})`);
}

/** Back to the normal flow after a pending decision is resolved. */
function resume(s: GameState) {
  s.phase = s.extraRoll ? "ROLL" : "END";
}

function transfer(s: GameState, from: PlayerState, to: string | null, amount: number) {
  from.cash -= amount;
  if (to === null) s.jackpot += amount;
  else s.players.find((x) => x.id === to)!.cash += amount;
}

/** Pay now if possible, otherwise enter DEBT phase (sell assets, then pay or go bankrupt). */
function charge(s: GameState, p: PlayerState, amount: number, to: string | null, reason: string) {
  if (amount <= 0) return;
  if (p.cash >= amount) {
    transfer(s, p, to, amount);
    log(s, `${p.name} paid $${amount} (${reason}).`);
    return;
  }
  s.debt = { amount, to, reason };
  s.phase = "DEBT";
  log(s, `${p.name} owes $${amount} (${reason}) but has only $${p.cash}.`);
}

function roll(s: GameState, p: PlayerState, ctx: Ctx) {
  const d1 = ctx.rng(6) + 1;
  const d2 = ctx.rng(6) + 1;
  const doubles = d1 === d2;
  s.dice = [d1, d2];
  s.rollSeq = (s.rollSeq ?? 0) + 1;
  s.lastCard = null;
  log(s, `${p.name} rolled ${d1} + ${d2}${doubles ? " (doubles!)" : ""}.`);

  if (p.inCell) {
    s.extraRoll = false;
    s.phase = "END";
    if (doubles) {
      p.inCell = false;
      p.cellAttempts = 0;
      log(s, `${p.name} rolled out of the Holding Cell.`);
      moveBy(s, p, d1 + d2, ctx);
      return;
    }
    p.cellAttempts += 1;
    if (p.cellAttempts < RULES.maxCellAttempts) return;
    // Third failed attempt: bail is forced.
    p.inCell = false;
    p.cellAttempts = 0;
    if (p.cash >= RULES.bail) {
      transfer(s, p, null, RULES.bail);
      log(s, `${p.name} paid the forced $${RULES.bail} bail and moves on.`);
      moveBy(s, p, d1 + d2, ctx);
    } else {
      charge(s, p, RULES.bail, null, "forced bail");
    }
    return;
  }

  if (doubles) {
    s.doublesStreak += 1;
    if (s.doublesStreak >= 3) {
      log(s, `Three doubles in a row: ${p.name} is sent to the Holding Cell!`);
      sendToCell(s, p);
      return;
    }
  }
  s.extraRoll = doubles;
  s.phase = doubles ? "ROLL" : "END";
  moveBy(s, p, d1 + d2, ctx);
}

function moveBy(s: GameState, p: PlayerState, steps: number, ctx: Ctx) {
  const target = (p.position + steps) % BOARD_SIZE;
  if (target === 0) {
    p.cash += RULES.landOnStartBonus;
    log(s, `${p.name} landed right on Start: +$${RULES.landOnStartBonus}!`);
  } else if (p.position + steps >= BOARD_SIZE) {
    p.cash += RULES.passStartBonus;
    log(s, `${p.name} passed Start: +$${RULES.passStartBonus}.`);
  }
  recordMove(s, p, target, steps);
  p.position = target;
  landOn(s, p, ctx);
}

function sendToCell(s: GameState, p: PlayerState) {
  if (p.position !== CELL_INDEX) recordMove(s, p, CELL_INDEX, 0);
  p.position = CELL_INDEX;
  p.inCell = true;
  p.cellAttempts = 0;
  s.extraRoll = false;
  s.doublesStreak = 0;
  s.phase = "END";
}

function landOn(s: GameState, p: PlayerState, ctx: Ctx) {
  const sq = BOARD[p.position];
  switch (sq.kind) {
    case "START":
    case "CELL":
      return;
    case "REST":
      if (s.jackpot > 0) {
        log(s, `${p.name} hit the Jackpot at Rest Stop: +$${s.jackpot}!`);
        p.cash += s.jackpot;
        s.jackpot = 0;
      }
      return;
    case "GO_TO_CELL":
      log(s, `${p.name} is sent to the Holding Cell.`);
      sendToCell(s, p);
      return;
    case "TAX":
      charge(s, p, sq.amount, null, `${sq.name}, into the Jackpot`);
      return;
    case "FORTUNE":
      drawFortune(s, p, ctx);
      return;
    case "PROPERTY":
    case "STATION": {
      const h = s.holdings[p.position];
      if (!h) {
        if (p.cash >= sq.price) {
          s.pendingBuy = p.position;
          s.phase = "BUY";
        } else {
          log(s, `${p.name} can't afford ${sq.name} ($${sq.price}).`);
        }
        return;
      }
      if (h.owner === p.id) {
        if (sq.kind === "PROPERTY") {
          p.cash += RULES.homeTurfBonus;
          log(s, `Home turf! ${p.name} collects $${RULES.homeTurfBonus}.`);
        }
        return;
      }
      const owner = s.players.find((x) => x.id === h.owner)!;
      charge(s, p, rentFor(s, p.position), owner.id, `rent on ${sq.name} to ${owner.name}`);
      return;
    }
  }
}

// ---------------------------------------------------------------- Fortune cards

export const FORTUNE_CARDS = [
  "Street festival! Collect $100.",
  "Tax refund. Collect $50.",
  "Car repairs. Pay $75 into the Jackpot.",
  "Property upkeep. Pay $25 per upgrade level you own into the Jackpot.",
  "It's your birthday! Collect $20 from every other player.",
  "Advance to Start.",
  "Caught jaywalking. Go to the Holding Cell.",
  "Take the scenic route. Move back 3 spaces.",
  "Catch a train. Advance to the next station.",
  "Walk Free card. Keep it to leave the Holding Cell for free.",
  "Windfall! Collect half of the Jackpot.",
  "Speeding ticket. Pay $30 into the Jackpot.",
] as const;

function drawFortune(s: GameState, p: PlayerState, ctx: Ctx) {
  const card = ctx.rng(FORTUNE_CARDS.length);
  s.lastCard = FORTUNE_CARDS[card];
  log(s, `Fortune for ${p.name}: ${FORTUNE_CARDS[card]}`);
  switch (card) {
    case 0:
      p.cash += 100;
      return;
    case 1:
      p.cash += 50;
      return;
    case 2:
      charge(s, p, 75, null, "car repairs");
      return;
    case 3: {
      const levels = ownedBy(s, p.id).reduce((n, i) => n + s.holdings[i].level, 0);
      charge(s, p, levels * 25, null, "property upkeep");
      return;
    }
    case 4:
      for (const other of s.players) {
        if (other.id === p.id || other.bankrupt) continue;
        const gift = Math.min(20, Math.max(0, other.cash));
        other.cash -= gift;
        p.cash += gift;
      }
      return;
    case 5:
      moveBy(s, p, (BOARD_SIZE - p.position) % BOARD_SIZE || BOARD_SIZE, ctx);
      return;
    case 6:
      sendToCell(s, p);
      return;
    case 7:
      recordMove(s, p, (p.position - 3 + BOARD_SIZE) % BOARD_SIZE, -3);
      p.position = (p.position - 3 + BOARD_SIZE) % BOARD_SIZE;
      landOn(s, p, ctx);
      return;
    case 8: {
      const next = STATION_INDEXES.find((i) => i > p.position) ?? STATION_INDEXES[0];
      moveBy(s, p, (next - p.position + BOARD_SIZE) % BOARD_SIZE, ctx);
      return;
    }
    case 9:
      p.freeCards += 1;
      return;
    case 10: {
      const half = Math.floor(s.jackpot / 2);
      s.jackpot -= half;
      p.cash += half;
      return;
    }
    case 11:
      charge(s, p, 30, null, "speeding ticket");
      return;
  }
}

// ---------------------------------------------------------------- turns & endings

function goBankrupt(s: GameState, p: PlayerState, creditor: string | null, message: string, ctx: Ctx) {
  const wasCurrent = s.players[s.current].id === p.id;
  log(s, message);
  const leftover = Math.max(0, p.cash);
  if (creditor) {
    s.players.find((x) => x.id === creditor)!.cash += leftover;
  } else {
    s.jackpot += leftover;
  }
  p.cash = 0;
  p.bankrupt = true;
  // If someone owed this player money, that debt now goes to the Jackpot instead.
  if (s.debt?.to === p.id) s.debt.to = null;
  // Properties return to the bank, unimproved.
  for (const i of ownedBy(s, p.id)) delete s.holdings[i];

  const active = s.players.filter((x) => !x.bankrupt);
  if (active.length === 1) {
    finish(s, active[0].id, `${active[0].name} is the last tycoon standing and wins!`);
    return;
  }
  if (!active.some((x) => !x.bot)) {
    finishByWorth(s, "No human players are left");
    return;
  }
  if (wasCurrent) advanceTurn(s, ctx);
}

function skipIdle(s: GameState, actor: PlayerState, ctx: Ctx) {
  const idle = s.players[s.current];
  if (idle.id === actor.id) throw new RuleError("It's your turn; you can't skip yourself");
  if (ctx.now - s.turnStartedAt < RULES.idleMs) throw new RuleError("Give them a little longer");
  if (s.phase === "DEBT") {
    goBankrupt(s, idle, s.debt!.to, `${idle.name} timed out while in debt and went bankrupt.`, ctx);
    return;
  }
  log(s, `${actor.name} skipped ${idle.name}'s idle turn.`);
  advanceTurn(s, ctx);
}

function advanceTurn(s: GameState, ctx: Ctx) {
  s.pendingBuy = null;
  s.debt = null;
  s.extraRoll = false;
  s.doublesStreak = 0;
  let next = s.current;
  do {
    next = (next + 1) % s.players.length;
  } while (s.players[next].bankrupt);

  if (next <= s.current) {
    s.round += 1;
    if (s.round > s.maxRounds) {
      finishByWorth(s, "Time's up");
      return;
    }
    log(s, `Round ${s.round} of ${s.maxRounds}.`);
  }
  s.current = next;
  s.phase = "ROLL";
  s.turnStartedAt = ctx.now;
}

function finishByWorth(s: GameState, reason: string) {
  const ranked = s.players
    .filter((x) => !x.bankrupt)
    .map((x) => ({ x, worth: netWorth(s, x.id) }))
    .sort((a, b) => b.worth - a.worth);
  finish(s, ranked[0].x.id, `${reason}! ${ranked[0].x.name} wins with a net worth of $${ranked[0].worth}.`);
}

function finish(s: GameState, winnerId: string, message: string) {
  s.winner = winnerId;
  s.phase = "OVER";
  s.pendingBuy = null;
  s.debt = null;
  log(s, message);
}

// ---------------------------------------------------------------- bots

/** Cash a bot tries to keep in hand when buying, upgrading or paying bail. */
const BOT_RESERVE = { buy: 150, upgrade: 250, bail: 300 };

/**
 * The bot's next single move for the current player. Always legal in the
 * current phase, so calling it repeatedly always finishes the turn.
 */
export function chooseBotAction(s: GameState): Action {
  const p = s.players[s.current];
  switch (s.phase) {
    case "ROLL":
      if (p.inCell && p.freeCards > 0) return { type: "USE_CARD" };
      if (p.inCell && p.cash >= RULES.bail + BOT_RESERVE.bail) return { type: "PAY_BAIL" };
      return { type: "ROLL" };
    case "BUY": {
      const square = s.pendingBuy!;
      const sq = BOARD[square] as OwnableSquare;
      // Spend down to zero reserve for the street that completes a district.
      const completes =
        sq.kind === "PROPERTY" &&
        districtSquares(sq.district).every((i) => i === square || s.holdings[i]?.owner === p.id);
      return p.cash - sq.price >= (completes ? 0 : BOT_RESERVE.buy) ? { type: "BUY" } : { type: "DECLINE" };
    }
    case "DEBT": {
      if (p.cash >= s.debt!.amount) return { type: "PAY_DEBT" };
      const owned = ownedBy(s, p.id);
      const upgraded = owned.find((i) => s.holdings[i].level > 0);
      if (upgraded !== undefined) return { type: "SELL_UPGRADE", square: upgraded };
      const sellable = owned
        .filter((i) => !canSellProperty(s, p.id, i))
        .sort((a, b) => (BOARD[a] as OwnableSquare).price - (BOARD[b] as OwnableSquare).price);
      if (sellable.length) return { type: "SELL_PROPERTY", square: sellable[0] };
      return { type: "BANKRUPT" };
    }
    case "END": {
      const target = ownedBy(s, p.id)
        .filter((i) => !canUpgrade(s, p.id, i))
        .map((i) => ({ i, cost: upgradeCost(BOARD[i] as Extract<Square, { kind: "PROPERTY" }>) }))
        .filter((u) => p.cash - u.cost >= BOT_RESERVE.upgrade)
        .sort((a, b) => s.holdings[a.i].level - s.holdings[b.i].level || a.cost - b.cost)[0];
      return target ? { type: "UPGRADE", square: target.i } : { type: "END_TURN" };
    }
    default:
      return { type: "END_TURN" };
  }
}
