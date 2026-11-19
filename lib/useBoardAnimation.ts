"use client";

import { useEffect, useRef, useState } from "react";
import { BOARD_SIZE } from "@/game/board";
import type { GameState, Move } from "@/game/engine";

/** What the board should show right now (may lag the real state while animating). */
export interface BoardView {
  positions: Record<string, number>;
  dice: [number, number] | null;
  rolling: boolean;
  /** Player whose piece is currently hopping, if any. */
  moving: string | null;
  animating: boolean;
}

const TUMBLE_MS = 700;
const TUMBLE_FRAME_MS = 80;
const STEP_MS = 200;
/** Faster steps when updates pile up (e.g. a bot's quick doubles). */
const CATCH_UP_STEP_MS = 80;
const JUMP_MS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const positionsOf = (s: GameState) => Object.fromEntries(s.players.map((p) => [p.id, p.position]));

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Rough time a state's animation takes; bots wait this long before their next move. */
export function animationMs(s: GameState): number {
  const moves = s.lastMoves ?? [];
  if (!moves.length) return 0;
  return TUMBLE_MS + moves.reduce((ms, m) => ms + (m.steps ? Math.abs(m.steps) * STEP_MS : JUMP_MS), 0);
}

/**
 * Plays dice tumbles and square-by-square piece moves when a new state arrives.
 * The server state is already final; this only delays what the board shows.
 * Animations queue up, and the view always ends in sync with the latest state.
 */
export function useBoardAnimation(state: GameState): BoardView {
  const [view, setView] = useState<BoardView>(() => ({
    positions: positionsOf(state),
    dice: state.dice,
    rolling: false,
    moving: null,
    animating: false,
  }));
  const seen = useRef({ roll: state.rollSeq ?? 0, move: state.moveSeq ?? 0 });
  const latest = useRef(state);
  const pending = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    latest.current = state;
    const newRoll = (state.rollSeq ?? 0) > seen.current.roll;
    const newMove = (state.moveSeq ?? 0) > seen.current.move;
    seen.current = { roll: state.rollSeq ?? 0, move: state.moveSeq ?? 0 };

    const syncToLatest = () =>
      setView({
        positions: positionsOf(latest.current),
        dice: latest.current.dice,
        rolling: false,
        moving: null,
        animating: pending.current > 0,
      });

    if ((!newRoll && !newMove) || prefersReducedMotion()) {
      if (pending.current === 0) syncToLatest(); // otherwise the running queue syncs at its end
      return;
    }

    const dice = state.dice;
    const moves: Move[] = newMove ? (state.lastMoves ?? []) : [];
    pending.current += 1;
    setView((v) => ({ ...v, animating: true }));

    chain.current = chain.current.then(async () => {
      const update = (patch: Partial<BoardView>) => alive.current && setView((v) => ({ ...v, ...patch }));
      const stepMs = () => (pending.current > 1 ? CATCH_UP_STEP_MS : STEP_MS);

      if (newRoll && dice && pending.current === 1) {
        for (let t = 0; t < TUMBLE_MS; t += TUMBLE_FRAME_MS) {
          update({
            rolling: true,
            dice: [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)],
          });
          await sleep(TUMBLE_FRAME_MS);
        }
      }
      update({ rolling: false, dice });

      for (const m of moves) {
        if (m.steps === 0) {
          if (alive.current) {
            setView((v) => ({ ...v, moving: m.player, positions: { ...v.positions, [m.player]: m.to } }));
          }
          await sleep(JUMP_MS);
          continue;
        }
        const dir = Math.sign(m.steps);
        for (let k = 1; k <= Math.abs(m.steps); k++) {
          const pos = (m.from + dir * k + BOARD_SIZE) % BOARD_SIZE;
          if (alive.current) {
            setView((v) => ({ ...v, moving: m.player, positions: { ...v.positions, [m.player]: pos } }));
          }
          await sleep(stepMs());
        }
      }

      pending.current -= 1;
      if (alive.current && pending.current === 0) syncToLatest();
    });
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return view;
}
