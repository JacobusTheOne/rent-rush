"use client";

/**
 * Links the 3D dice cup (components/DiceCup.tsx) to the board animation
 * (lib/useBoardAnimation.ts): while a cup is on screen, pieces wait until the
 * cup has revealed the dice of that roll before they start moving.
 */
let cups = 0;
const revealed = new Set<number>();
const waiters = new Map<number, Array<() => void>>();

/** Called by the cup while it's mounted and working; returns an unregister function. */
export function registerCup(): () => void {
  cups += 1;
  return () => {
    cups -= 1;
  };
}

export function cupIsActive(): boolean {
  return cups > 0;
}

/** The cup has lifted and the dice of roll number `seq` are showing. */
export function markRevealed(seq: number): void {
  revealed.add(seq);
  waiters.get(seq)?.forEach((fn) => fn());
  waiters.delete(seq);
}

/** Resolves when roll `seq` has been revealed, or after `timeoutMs` so the board never gets stuck. */
export function waitForReveal(seq: number, timeoutMs = 5000): Promise<void> {
  if (revealed.has(seq)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const list = waiters.get(seq) ?? [];
    list.push(() => {
      clearTimeout(timer);
      resolve();
    });
    waiters.set(seq, list);
  });
}
