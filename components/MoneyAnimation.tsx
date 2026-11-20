"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { GameState, PlayerState } from "@/game/engine";
import { type Cash, coinCount, transfersFor } from "@/lib/money";

/**
 * Money on screen: when cash changes hands, coins fly from the payer's money to the receiver's
 * (or to/from the bank: the Jackpot sign or the board), and the amounts count down and up.
 * The cash shown on the name tags lags the real cash until its coins have landed.
 */

const FLIGHT_MS = 950;
const STAGGER_MS = 90;
const COUNT_MS = 900;
const BETWEEN_MS = 160;

/** Cash to show per player while money is moving; null = show the real cash. */
export const CashContext = createContext<Cash | null>(null);

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const cashOf = (s: GameState): Cash => Object.fromEntries(s.players.map((p) => [p.id, p.cash]));
const same = (a: Cash, b: Cash) => Object.keys(b).every((k) => a[k] === b[k]) && Object.keys(a).length === Object.keys(b).length;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Where coins start or land: a player's money, or the bank (Jackpot sign, else the board). */
function anchor(id: string | null): DOMRect | null {
  const el = id
    ? document.querySelector(`[data-cash-for="${CSS.escape(id)}"]`)
    : (document.querySelector(".jackpot") ?? document.querySelector(".board-viewport, .board"));
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 && r.bottom > 0 && r.top < window.innerHeight ? r : null;
}

/** Throws coins from a to b in an arc. Resolves when the first one lands, and when the last does. */
function flyCoins(a: DOMRect, b: DOMRect, count: number): { first: Promise<void>; all: Promise<void> } {
  const x0 = a.left + a.width / 2;
  const y0 = a.top + a.height / 2;
  const dx = b.left + b.width / 2 - x0;
  const dy = b.top + b.height / 2 - y0;
  const lift = Math.min(140, 40 + Math.hypot(dx, dy) * 0.3);
  const landings = Array.from(
    { length: count },
    (_, i) =>
      new Promise<void>((resolve) => {
        const coin = document.createElement("span");
        coin.className = "coin-fly";
        coin.textContent = "$";
        coin.style.left = `${x0}px`;
        coin.style.top = `${y0}px`;
        document.body.appendChild(coin);
        const spread = (i % 2 ? 1 : -1) * (6 + i * 4);
        const at = (x: number, y: number, scale: number) => `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${scale})`;
        const anim = coin.animate(
          [
            { transform: at(0, 0, 0.5), opacity: 0 },
            { transform: at(0, -8, 1), opacity: 1, offset: 0.12 },
            { transform: at(dx / 2 + spread, dy / 2 - lift, 1.15), opacity: 1, offset: 0.5 },
            { transform: at(dx, dy, 0.85), opacity: 1, offset: 0.9 },
            { transform: at(dx, dy, 0.3), opacity: 0 },
          ],
          { duration: FLIGHT_MS, delay: i * STAGGER_MS, easing: "cubic-bezier(0.35, 0.6, 0.45, 1)", fill: "both" },
        );
        const done = () => {
          coin.remove();
          resolve();
        };
        anim.onfinish = done;
        anim.oncancel = done;
      }),
  );
  return { first: landings[0].then(() => sleep(0)), all: Promise.all(landings).then(() => undefined) };
}

/**
 * Plays each change in cash as coin flights, one update at a time, after the dice and pieces have
 * finished moving (`holdBack`). Returns the cash to show right now.
 */
export function useMoneyAnimation(state: GameState, holdBack: boolean): Cash {
  const [shown, setShown] = useState<Cash>(() => cashOf(state));
  const caughtUp = useRef<Cash>(cashOf(state));
  const queue = useRef<Cash[]>([]);
  const running = useRef(false);
  const hold = useRef(holdBack);
  hold.current = holdBack;

  const pump = useRef<() => void>(() => {});
  pump.current = () => {
    if (running.current || hold.current || queue.current.length === 0) return;
    running.current = true;
    void (async () => {
      while (queue.current.length > 0 && !hold.current) {
        // Far behind (e.g. the tab was in the background): jump to the latest instead of replaying it all.
        const lagging = queue.current.length > 2;
        const next = lagging ? queue.current.at(-1)! : queue.current[0];
        queue.current = lagging ? [] : queue.current.slice(1);
        const before = caughtUp.current;
        const transfers = transfersFor(before, next);
        if (!lagging && !reducedMotion() && transfers.length > 0) {
          await Promise.all(
            transfers.map(async (t, k) => {
              await sleep(k * BETWEEN_MS);
              const from = anchor(t.from);
              const to = anchor(t.to);
              // The payer's money counts down as the coins leave...
              if (t.from) setShown((s) => ({ ...s, [t.from!]: (s[t.from!] ?? 0) - t.amount }));
              const coins = from && to ? flyCoins(from, to, coinCount(t.amount)) : null;
              if (coins) await coins.first;
              // ...and the receiver's counts up as they land.
              if (t.to) setShown((s) => ({ ...s, [t.to!]: (s[t.to!] ?? 0) + t.amount }));
              if (coins) await coins.all;
            }),
          );
        }
        caughtUp.current = next;
        setShown(next);
      }
      running.current = false;
      // Something may have arrived while we finished up.
      if (queue.current.length > 0 && !hold.current) pump.current();
    })();
  };

  // Queue every change in cash.
  useEffect(() => {
    const next = cashOf(state);
    const last = queue.current.at(-1) ?? caughtUp.current;
    if (same(next, last)) return;
    queue.current.push(next);
    pump.current();
  }, [state]);

  // Dice and pieces done: play the money.
  useEffect(() => {
    if (!holdBack) pump.current();
  }, [holdBack]);

  return shown;
}

/** Counts smoothly from the last value to the new one. */
function useCountUp(target: number): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (reducedMotion() || current.current === target) {
      current.current = target;
      setValue(target);
      return;
    }
    const from = current.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / COUNT_MS);
      const eased = 1 - (1 - k) ** 3;
      current.current = Math.round(from + (target - from) * eased);
      setValue(current.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return value;
}

/** A player's cash on their name tag: counts up and down, with a "+$50" / "−$50" that floats away. */
export function CashAmount({ player }: { player: PlayerState }) {
  const shown = useContext(CashContext)?.[player.id] ?? player.cash;
  const value = useCountUp(shown);
  const previous = useRef(shown);
  const [delta, setDelta] = useState<{ key: number; amount: number } | null>(null);

  useEffect(() => {
    const amount = shown - previous.current;
    previous.current = shown;
    if (amount === 0 || reducedMotion()) return;
    const key = performance.now();
    setDelta({ key, amount });
    const t = setTimeout(() => setDelta((d) => (d?.key === key ? null : d)), 1500);
    return () => clearTimeout(t);
  }, [shown]);

  const counting = value !== shown;
  return (
    <span className={`cash ${counting ? (value < shown ? "counting up" : "counting down") : ""}`} data-cash-for={player.id}>
      ${value}
      {delta && (
        <span key={delta.key} className={`cash-delta ${delta.amount > 0 ? "up" : "down"}`} aria-hidden>
          {delta.amount > 0 ? "+" : "−"}${Math.abs(delta.amount)}
        </span>
      )}
    </span>
  );
}
