import { describe, expect, it } from "vitest";
import { RULES } from "./board";
import { type Ctx, type GameState, RuleError, applyAction, chooseBotAction, newGame, netWorth, rentFor } from "./engine";

/** rng that returns scripted values (dice values are value-1), then 0s. */
function scripted(values: number[], now = 1_000): Ctx {
  const queue = [...values];
  return { rng: () => queue.shift() ?? 0, now };
}

const A = { id: "a", name: "Ann" };
const B = { id: "b", name: "Bob" };

/** Two-player game with Ann first (shuffle rng 0 swaps [a,b] -> [b,a], so feed 1 to keep order). */
function twoPlayer(maxRounds = 20): GameState {
  return newGame([A, B], maxRounds, scripted([1]));
}

const roll = (s: GameState, id: string, d1: number, d2: number, extra: number[] = []) =>
  applyAction(s, id, { type: "ROLL" }, scripted([d1 - 1, d2 - 1, ...extra]));
const act = (s: GameState, id: string, type: string, square?: number, now = 1_000) =>
  applyAction(s, id, { type, square } as never, scripted([], now));

describe("Rent Rush engine", () => {
  it("starts everyone on Start with starting cash", () => {
    const s = twoPlayer();
    expect(s.players.map((p) => p.id)).toEqual(["a", "b"]);
    expect(s.players.every((p) => p.cash === RULES.startingCash && p.position === 0)).toBe(true);
    expect(s.phase).toBe("ROLL");
  });

  it("rejects moves out of turn", () => {
    expect(() => roll(twoPlayer(), "b", 1, 2)).toThrow(RuleError);
  });

  it("offers an unowned property and lets you buy it", () => {
    let s = roll(twoPlayer(), "a", 1, 1 + 0); // 1+1 doubles -> square 2 (Canal Walk)
    expect(s.players[0].position).toBe(2);
    expect(s.phase).toBe("BUY");
    s = act(s, "a", "BUY");
    expect(s.holdings["2"]).toEqual({ owner: "a", level: 0 });
    expect(s.players[0].cash).toBe(1500 - 80);
    expect(s.phase).toBe("ROLL"); // doubles -> roll again
  });

  it("charges rent, doubled for a full district", () => {
    let s = twoPlayer();
    s.holdings["1"] = { owner: "a", level: 0 };
    expect(rentFor(s, 1)).toBe(6);
    s.holdings["2"] = { owner: "a", level: 0 };
    expect(rentFor(s, 1)).toBe(12);
    s.current = 1;
    s = roll(s, "b", 1, 0 + 1); // 1+1 -> square 2, rent 16
    expect(s.players[1].cash).toBe(1500 - 16);
    expect(s.players[0].cash).toBe(1500 + 16);
  });

  it("pays a Home Turf bonus on your own street", () => {
    let s = twoPlayer();
    s.holdings["7"] = { owner: "a", level: 0 };
    s = roll(s, "a", 3, 4); // square 7
    expect(s.players[0].cash).toBe(1500 + RULES.homeTurfBonus);
  });

  it("pays $400 for landing exactly on Start and $200 for passing", () => {
    let s = twoPlayer();
    s.players[0].position = 19;
    s = roll(s, "a", 2, 3); // 24 -> Start
    expect(s.players[0].position).toBe(0);
    expect(s.players[0].cash).toBe(1500 + 400);

    s = twoPlayer();
    s.players[0].position = 20;
    s = roll(s, "a", 2, 3); // 25 -> square 1
    expect(s.players[0].cash).toBe(1500 + 200);
  });

  it("puts taxes in the Jackpot, paid out at Rest Stop", () => {
    let s = roll(twoPlayer(), "a", 2, 3); // square 5: Parking Fine 75
    expect(s.jackpot).toBe(75);
    s = act(s, "a", "END_TURN");
    s.players[1].position = 7;
    s = roll(s, "b", 2, 3); // square 12: Rest Stop
    expect(s.players[1].cash).toBe(1500 + 75);
    expect(s.jackpot).toBe(0);
  });

  it("only allows upgrades on a full district", () => {
    const s = twoPlayer();
    s.phase = "END";
    s.holdings["23"] = { owner: "a", level: 0 };
    expect(() => act(s, "a", "UPGRADE", 23)).toThrow(/whole district/);
    s.holdings["19"] = { owner: "a", level: 0 };
    const up = act(s, "a", "UPGRADE", 23);
    expect(up.holdings["23"].level).toBe(1);
    expect(up.players[0].cash).toBe(1500 - 160);
    expect(rentFor(up, 23)).toBe(32 * 3);
  });

  it("enters DEBT when you can't pay, and bankruptcy hands cash to the creditor", () => {
    let s = twoPlayer();
    s.players[0].cash = 40; // Parking Fine is 75
    s = roll(s, "a", 2, 3);
    expect(s.phase).toBe("DEBT");
    expect(() => act(s, "a", "PAY_DEBT")).toThrow(/Not enough/);
    s = act(s, "a", "BANKRUPT");
    expect(s.players[0].bankrupt).toBe(true);
    expect(s.jackpot).toBe(40);
    expect(s.phase).toBe("OVER");
    expect(s.winner).toBe("b");
  });

  it("lets you sell a property to clear a debt", () => {
    let s = twoPlayer();
    s.holdings["4"] = { owner: "a", level: 0 }; // North Station, sells for 100
    s.players[0].cash = 40;
    s = roll(s, "a", 2, 3);
    s = act(s, "a", "SELL_PROPERTY", 4);
    expect(s.players[0].cash).toBe(140);
    s = act(s, "a", "PAY_DEBT");
    expect(s.players[0].cash).toBe(65);
    expect(s.phase).toBe("END");
  });

  it("sends you to the Holding Cell on three doubles", () => {
    let s = twoPlayer();
    s = roll(s, "a", 1, 1); // -> 2 (buy offer)
    s = act(s, "a", "DECLINE");
    s = roll(s, "a", 2, 2); // -> 6 (cell, visiting)
    s = roll(s, "a", 3, 3);
    expect(s.players[0].inCell).toBe(true);
    expect(s.players[0].position).toBe(6);
    expect(s.phase).toBe("END");
  });

  it("ends the game after the round limit with the richest player winning", () => {
    let s = twoPlayer(1);
    s.players[1].cash = 5000;
    s.phase = "END";
    s = act(s, "a", "END_TURN");
    s.phase = "END";
    s = act(s, "b", "END_TURN");
    expect(s.phase).toBe("OVER");
    expect(s.winner).toBe("b");
    expect(netWorth(s, "b")).toBe(5000);
  });

  it("lets other players skip an idle turn only after the timeout", () => {
    const s = twoPlayer();
    expect(() => act(s, "b", "SKIP_IDLE", undefined, 1_000 + 10_000)).toThrow(/longer/);
    const skipped = act(s, "b", "SKIP_IDLE", undefined, 1_000 + RULES.idleMs);
    expect(skipped.current).toBe(1);
  });

  it("forfeit by a non-current player in a 3-player game keeps the turn order", () => {
    let s = newGame([A, B, { id: "c", name: "Cy" }], 20, scripted([2, 1]));
    const order = s.players.map((p) => p.id);
    s = act(s, order[2], "FORFEIT");
    expect(s.players[2].bankrupt).toBe(true);
    expect(s.current).toBe(0);
    expect(s.phase).toBe("ROLL");
  });
});

describe("bots", () => {
  /** Seeded PRNG so a failure is reproducible. */
  function seeded(seed: number) {
    let x = seed;
    return (max: number) => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return x % max;
    };
  }

  it("bot-only games always make legal moves and finish", { timeout: 30_000 }, () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = seeded(seed);
      const ctx = { rng, now: 0 };
      const bots = [1, 2, 3, 4].map((n) => ({ id: `bot-${n}`, name: `Bot ${n}`, bot: true }));
      let s = newGame(bots, 30, ctx);
      let steps = 0;
      while (s.phase !== "OVER") {
        const actor = s.players[s.current].id;
        s = applyAction(s, actor, chooseBotAction(s), ctx); // throws on an illegal move
        if (++steps > 20_000) throw new Error(`seed ${seed} did not finish`);
      }
      expect(s.winner).toBeTruthy();
    }
  });

  it("buys an affordable property and declines when it would drop below its reserve", () => {
    const s = newGame([A, { id: "bot", name: "Bot", bot: true }], 20, scripted([1]));
    s.current = 1;
    s.phase = "BUY";
    s.pendingBuy = 23; // Golden Mile, $320
    expect(chooseBotAction(s).type).toBe("BUY");
    s.players[1].cash = 400;
    expect(chooseBotAction(s).type).toBe("DECLINE");
  });

  it("ends the game when the last human forfeits", () => {
    let s = newGame([A, { id: "b1", name: "Bot 1", bot: true }, { id: "b2", name: "Bot 2", bot: true }], 20, scripted([2, 1]));
    s = act(s, "a", "FORFEIT");
    expect(s.phase).toBe("OVER");
    expect(s.log.at(-1)!.text).toMatch(/No human players are left/);
  });
});

describe("move tracking (for animation)", () => {
  it("records a dice walk and counts the roll", () => {
    const s = roll(twoPlayer(), "a", 2, 3); // 0 -> 5
    expect(s.rollSeq).toBe(1);
    expect(s.moveSeq).toBe(1);
    expect(s.lastMoves).toEqual([{ player: "a", from: 0, to: 5, steps: 5 }]);
  });

  it("records the walk and then a jump when landing on Go to Cell", () => {
    const start = twoPlayer();
    start.players[0].position = 13;
    const s = roll(start, "a", 2, 3); // 13 -> 18 (Go to Cell) -> 6
    expect(s.lastMoves).toEqual([
      { player: "a", from: 13, to: 18, steps: 5 },
      { player: "a", from: 18, to: 6, steps: 0 },
    ]);
  });

  it("clears moves on actions that don't move anyone", () => {
    let s = roll(twoPlayer(), "a", 2, 3);
    s = act(s, "a", "END_TURN");
    expect(s.lastMoves).toEqual([]);
    expect(s.moveSeq).toBe(1);
  });

  it("works on games saved before move tracking existed", () => {
    const old = twoPlayer() as Partial<GameState>;
    delete old.rollSeq;
    delete old.moveSeq;
    delete old.lastMoves;
    const s = roll(old as GameState, "a", 2, 3);
    expect(s.rollSeq).toBe(1);
    expect(s.lastMoves).toHaveLength(1);
  });
});

describe("pause and resume", () => {
  it("freezes the game while paused and resumes with a fresh turn clock", () => {
    let s = twoPlayer();
    s = act(s, "b", "PAUSE", undefined, 5_000); // any player may pause, even out of turn
    expect(s.paused).toMatchObject({ by: "b", name: "Bob" });
    expect(() => roll(s, "a", 1, 2)).toThrow(/paused by Bob/);
    expect(() => act(s, "b", "SKIP_IDLE", undefined, 999_999)).toThrow(/paused/);
    expect(() => act(s, "a", "PAUSE")).toThrow(/already paused/);
    s = act(s, "a", "RESUME", undefined, 900_000); // anyone may resume
    expect(s.paused).toBeNull();
    expect(s.turnStartedAt).toBe(900_000);
    expect(() => act(s, "a", "RESUME")).toThrow(/isn't paused/);
    s = roll(s, "a", 1, 2);
    expect(s.players[0].position).toBe(3);
  });

  it("still lets a player leave a paused game", () => {
    let s = twoPlayer();
    s = act(s, "a", "PAUSE");
    s = act(s, "a", "FORFEIT");
    expect(s.phase).toBe("OVER");
    expect(s.winner).toBe("b");
    expect(s.paused).toBeNull();
  });

  it("doesn't let bots pause", () => {
    const s = newGame([A, { id: "bot-1", name: "Bot Penny", bot: true }], 20, scripted([1]));
    expect(() => act(s, "bot-1", "PAUSE")).toThrow(/Bots/);
  });
});

describe("round limits", () => {
  /** Plays both players' turns with small, non-double rolls (Ann starts at Start). */
  function playRounds(s: GameState, rounds: number): GameState {
    for (let r = 0; r < rounds && s.phase !== "OVER"; r++) {
      for (const id of ["a", "b"]) {
        if (s.phase === "OVER") break;
        s = roll(s, id, 1, 2);
        while (s.phase !== "ROLL" && s.phase !== "OVER") {
          s = act(s, id, s.phase === "BUY" ? "DECLINE" : s.phase === "DEBT" ? "BANKRUPT" : "END_TURN");
        }
      }
    }
    return s;
  }

  it("ends by net worth when the round limit is reached", () => {
    const s = playRounds(twoPlayer(2), 3);
    expect(s.phase).toBe("OVER");
    expect(s.log.at(-1)!.text).toMatch(/Time's up/);
  });

  it("keeps going with no round limit (0)", () => {
    const s = playRounds(twoPlayer(0), 40);
    expect(s.phase).not.toBe("OVER");
    expect(s.round).toBeGreaterThan(30);
    expect(s.log.some((l) => /^Round \d+\.$/.test(l.text))).toBe(true);
    expect(twoPlayer(0).log[0].text).toMatch(/No round limit/);
  });
});

describe("trading", () => {
  const C = { id: "c", name: "Cat" };
  /** Ann owns Mill Street (1) and Canal Walk (2); Bob owns Pine Court (7). */
  function withCards(): GameState {
    const s = newGame([A, B, C], 20, scripted([2, 1]));
    s.holdings = { "1": { owner: "a", level: 0 }, "2": { owner: "a", level: 0 }, "7": { owner: "b", level: 0 } };
    return s;
  }
  const offer = (s: GameState, from: string, to: string, give: number[], giveCash: number, get: number[], getCash: number) =>
    applyAction(
      s,
      from,
      { type: "PROPOSE_TRADE", to, give: { squares: give, cash: giveCash }, get: { squares: get, cash: getCash } },
      scripted([]),
    );
  const answer = (s: GameState, id: string, type: string, tradeId: number) =>
    applyAction(s, id, { type, id: tradeId } as never, scripted([]));

  it("offers, then swaps cards and cash when accepted (out of turn too)", () => {
    let s = offer(withCards(), "b", "a", [7], 50, [2], 0); // Bob: Pine Court + $50 for Canal Walk
    expect(s.trades).toHaveLength(1);
    const id = s.trades![0].id;
    expect(() => answer(s, "b", "ACCEPT_TRADE", id)).toThrow(/isn't for you/);
    s = answer(s, "a", "ACCEPT_TRADE", id);
    expect(s.holdings["2"].owner).toBe("b");
    expect(s.holdings["7"].owner).toBe("a");
    expect(s.players.find((p) => p.id === "a")!.cash).toBe(RULES.startingCash + 50);
    expect(s.players.find((p) => p.id === "b")!.cash).toBe(RULES.startingCash - 50);
    expect(s.trades).toHaveLength(0);
    expect(s.log.at(-1)!.text).toMatch(/Trade done/);
  });

  it("can be declined or cancelled", () => {
    let s = offer(withCards(), "b", "a", [7], 0, [2], 0);
    const id = s.trades![0].id;
    expect(() => answer(s, "a", "CANCEL_TRADE", id)).toThrow(/Only the player who made/);
    expect(answer(s, "a", "DECLINE_TRADE", id).trades).toHaveLength(0);
    s = answer(s, "b", "CANCEL_TRADE", id);
    expect(s.trades).toHaveLength(0);
    expect(s.holdings["7"].owner).toBe("b");
  });

  it("rejects bad offers", () => {
    const s = withCards();
    expect(() => offer(s, "b", "a", [1], 0, [2], 0)).toThrow(/Bob doesn't own Mill Street/);
    expect(() => offer(s, "b", "a", [], 0, [2], 0)).toThrow(/Both sides/);
    expect(() => offer(s, "b", "a", [7], 5000, [2], 0)).toThrow(/doesn't have \$5000/);
    expect(() => offer(s, "b", "b", [7], 0, [2], 0)).toThrow(/another player/);
    expect(() => offer(s, "b", "a", [7], -5, [2], 0)).toThrow(/whole amount/);
    const built = structuredClone(s);
    built.holdings["1"].level = 1;
    expect(() => offer(built, "b", "a", [7], 0, [2], 0)).toThrow(/upgrades/);
  });

  it("checks again on accept: the cash or cards may be gone", () => {
    let s = offer(withCards(), "b", "a", [7], 1400, [2], 0);
    const id = s.trades![0].id;
    s.players.find((p) => p.id === "b")!.cash = 100; // Bob spent it meanwhile
    expect(() => answer(s, "a", "ACCEPT_TRADE", id)).toThrow(/can't go through.*doesn't have \$1400/);
  });

  it("a completed trade drops other offers that can no longer work", () => {
    let s = offer(withCards(), "b", "a", [7], 0, [2], 0);
    s = offer(s, "c", "a", [], 300, [2], 0); // Cat also wants Canal Walk
    expect(s.trades).toHaveLength(2);
    s = answer(s, "a", "ACCEPT_TRADE", s.trades![0].id);
    expect(s.trades).toHaveLength(0);
  });

  it("no trading while paused", () => {
    const s = act(withCards(), "a", "PAUSE");
    expect(() => offer(s, "b", "a", [7], 0, [2], 0)).toThrow(/paused/);
  });

  it("bots take good deals, refuse bad ones, and never break up a full district", () => {
    const bot = { id: "bot", name: "Bot Rex", bot: true };
    const base = newGame([A, bot], 20, scripted([1]));
    base.holdings = {
      "7": { owner: "bot", level: 0 },
      "1": { owner: "bot", level: 0 },
      "2": { owner: "bot", level: 0 }, // Old Town complete
      "10": { owner: "a", level: 0 },
    };
    // Lantern Square ($140) + $60 for Pine Court ($100): good for the bot.
    let s = offer(base, "a", "bot", [10], 60, [7], 0);
    expect(s.holdings["7"].owner).toBe("a");
    expect(s.holdings["10"].owner).toBe("bot");
    // $50 for Pine Court: bad deal.
    s = offer(base, "a", "bot", [], 50, [7], 0);
    expect(s.holdings["7"].owner).toBe("bot");
    expect(s.log.at(-1)!.text).toMatch(/turned the trade down/);
    // $500 for Mill Street would break up its full Old Town district.
    s = offer(base, "a", "bot", [], 500, [1], 0);
    expect(s.holdings["1"].owner).toBe("bot");
    expect(s.trades ?? []).toHaveLength(0);
  });

  it("bankruptcy and the end of the game clear open offers", () => {
    let s = offer(withCards(), "b", "a", [7], 0, [2], 0);
    s = act(s, "b", "FORFEIT");
    expect(s.trades).toHaveLength(0);
  });
});

describe("chat", () => {
  const say = (s: GameState, id: string, text: string, now = 1_000) => applyAction(s, id, { type: "CHAT", text }, scripted([], now));

  it("adds a cleaned message without touching the game", () => {
    const s0 = roll(twoPlayer(), "a", 1, 2);
    const s = say(s0, "b", "  hi\u0007   there\n ");
    expect(s.chat).toEqual([{ id: 1, from: "b", name: "Bob", text: "hi there", at: 1_000 }]);
    // Out of turn is fine, and the game itself is unchanged (moves stay for the animation).
    expect({ ...s, chat: undefined, chatSeq: undefined }).toEqual({ ...s0, chat: undefined, chatSeq: undefined });
  });

  it("works while paused, after the game, and for players who are out", () => {
    let s = act(twoPlayer(), "a", "PAUSE");
    s = say(s, "b", "brb");
    s = act(s, "b", "RESUME");
    s = act(s, "b", "FORFEIT");
    expect(s.phase).toBe("OVER");
    s = say(s, "b", "gg");
    s = say(s, "a", "gg!");
    expect(s.chat!.map((m) => m.text)).toEqual(["brb", "gg", "gg!"]);
  });

  it("rejects empty messages, strangers and floods, and keeps only the latest", () => {
    const s0 = twoPlayer();
    expect(() => say(s0, "a", "   ")).toThrow(RuleError);
    expect(() => say(s0, "zed", "hi")).toThrow(RuleError);
    expect(say(s0, "a", "x".repeat(500)).chat![0].text).toHaveLength(200);
    let s = s0;
    for (let i = 0; i < 5; i++) s = say(s, "a", `m${i}`, 1_000 + i);
    expect(() => say(s, "a", "too fast", 2_000)).toThrow(/Slow down/);
    s = say(s, "a", "later", 20_000); // the burst window has passed
    for (let i = 0; i < 70; i++) s = say(s, i % 2 ? "a" : "b", `n${i}`, 100_000 + i * 5_000);
    expect(s.chat).toHaveLength(60);
    expect(s.chat!.at(-1)!.text).toBe("n69");
    expect(s.chatSeq).toBe(76);
  });
});
