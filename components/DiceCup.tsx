"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { GameState } from "@/game/engine";
import { markRevealed, registerCup } from "@/lib/diceEvents";
import { createDiceScene, type DiceScene } from "@/lib/diceScene";
import { initSound } from "@/lib/sound";

export interface DiceCupHandle {
  /** Shake briefly by itself and roll (the Roll button / keyboard). */
  autoRoll(): void;
}

interface Props {
  state: GameState;
  /** It's your turn to roll and nothing else is going on. */
  canRoll: boolean;
  /** Send the ROLL action to the server. */
  onRoll: () => void;
  /** 3D isn't available (no WebGL): the screen falls back to the flat dice. */
  onUnavailable: () => void;
}

const AUTO_SHAKE_MS = 550;
/** If the server hasn't answered by then, put the cup back. */
const ROLL_TIMEOUT_MS = 8000;

/**
 * Hold the mouse button (or a finger) on the cup to shake it; release to slam it
 * upside down in the centre of the table. Everyone sees every roll: other players'
 * rolls play as a short automatic shake.
 */
export const DiceCup = forwardRef<DiceCupHandle, Props>(function DiceCup({ state, canRoll, onRoll, onUnavailable }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<DiceScene | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [shaking, setShaking] = useState(false);
  const seen = useRef(state.rollSeq ?? 0);
  // Your own roll in flight: the cup is already flipping when the server's answer arrives.
  const mine = useRef<{ seq: number; flipped: Promise<void> } | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const canRollRef = useRef(canRoll);
  canRollRef.current = canRoll;
  const onRollRef = useRef(onRoll);
  onRollRef.current = onRoll;

  useEffect(() => {
    let disposed = false;
    let unregister: (() => void) | undefined;
    initSound();
    createDiceScene(canvas.current!, state.dice)
      .then((s) => {
        if (disposed) return s.dispose();
        scene.current = s;
        unregister = registerCup();
        setLoaded(true);
      })
      .catch(() => onUnavailable());
    const ro = new ResizeObserver(() => scene.current?.resize());
    ro.observe(canvas.current!);
    return () => {
      disposed = true;
      ro.disconnect();
      unregister?.();
      scene.current?.dispose();
      scene.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scene.current?.setReady(canRoll && !shaking && !mine.current);
  }, [canRoll, shaking, loaded]);

  // A new roll arrived from the server: show it.
  useEffect(() => {
    const seq = state.rollSeq ?? 0;
    if (seq <= seen.current) return;
    seen.current = seq;
    const dice = state.dice;
    const s = scene.current;
    if (!s || !dice) {
      markRevealed(seq);
      return;
    }
    const own = mine.current && mine.current.seq < seq ? mine.current : null;
    if (own) mine.current = null;
    queue.current = queue.current.then(async () => {
      if (own) await own.flipped;
      else {
        await s.autoShake(AUTO_SHAKE_MS);
        await s.flip();
      }
      await s.reveal(dice);
      markRevealed(seq);
      s.setReady(canRollRef.current);
    });
  }, [state.rollSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  const release = () => {
    const s = scene.current;
    if (!s) return;
    setShaking(false);
    const seq = seen.current;
    const flipped = s.flip();
    mine.current = { seq, flipped };
    onRollRef.current();
    setTimeout(() => {
      if (mine.current?.seq === seq && seen.current === seq) {
        // No new roll came back (error or lost connection): put the cup back.
        mine.current = null;
        void flipped.then(() => s.cancel());
      }
    }, ROLL_TIMEOUT_MS);
  };

  useImperativeHandle(ref, () => ({
    autoRoll() {
      const s = scene.current;
      if (!s || !canRollRef.current || mine.current) return;
      setShaking(true);
      void s.autoShake(AUTO_SHAKE_MS).then(release);
    },
  }));

  const pointerToScene = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: ((e.clientY - r.top) / r.height) * 2 - 1 };
  };

  return (
    <div className={`dice-cup ${canRoll && loaded ? "can-roll" : ""} ${shaking ? "shaking" : ""}`}>
      <canvas
        ref={canvas}
        aria-label={canRoll ? "Dice cup: press and hold to shake, release to roll" : "Dice cup"}
        onPointerDown={(e) => {
          if (!canRoll || !scene.current || mine.current || e.button > 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          setShaking(true);
          scene.current.startShake();
          const p = pointerToScene(e);
          scene.current.moveShake(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!shaking) return;
          const p = pointerToScene(e);
          scene.current?.moveShake(p.x, p.y);
        }}
        onPointerUp={() => shaking && release()}
        onPointerCancel={() => shaking && release()}
        onContextMenu={(e) => e.preventDefault()}
      />
      {canRoll && loaded && !shaking && <div className="cup-hint">Hold the cup to shake · release to roll</div>}
    </div>
  );
});
