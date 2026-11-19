"use client";

import { useEffect, useRef } from "react";
import { RULES } from "@/game/board";

export function RulesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="rules" onClose={onClose}>
      <h2>How to play Rent Rush</h2>
      <p>
        Roll two dice, move around the 24-square board, buy streets and stations, and charge rent. The richest
        player when the round limit hits, or the last one standing, wins.
      </p>
      <h3>What&apos;s different from the classic game</h3>
      <ul>
        <li>
          <strong>Smaller, faster board:</strong> 24 squares, six districts of two streets, three stations, and a
          round limit (10, 20 or 30 rounds). When time&apos;s up, highest net worth wins.
        </li>
        <li>
          <strong>Start pays more if you hit it exactly:</strong> ${RULES.landOnStartBonus} for landing on Start, $
          {RULES.passStartBonus} for passing it.
        </li>
        <li>
          <strong>The Jackpot:</strong> every tax, fine and bail goes into the Jackpot. Land on Rest Stop to win it
          all.
        </li>
        <li>
          <strong>Home turf:</strong> landing on your own street pays you ${RULES.homeTurfBonus}.
        </li>
        <li>
          <strong>No auctions:</strong> if you pass on a property, it simply stays unowned.
        </li>
        <li>
          <strong>Sell, don&apos;t mortgage:</strong> sell a property back to the bank for half its price, or an
          upgrade for half its cost.
        </li>
        <li>
          <strong>Upgrades, not houses:</strong> own both streets in a district to double rent and unlock up to{" "}
          {RULES.maxLevel} upgrade levels (rent ×{RULES.levelMultipliers.slice(1).join(" / ×")}).
        </li>
        <li>
          <strong>Holding Cell:</strong> roll doubles to get out, pay ${RULES.bail}, or use a Walk Free card. After{" "}
          {RULES.maxCellAttempts} failed rolls you must pay. Three doubles in a row sends you there.
        </li>
        <li>
          <strong>Stations</strong> charge ${RULES.stationBaseRent} / ${RULES.stationBaseRent * 2} / $
          {RULES.stationBaseRent * 4} for owning 1 / 2 / 3.
        </li>
        <li>
          <strong>Can&apos;t pay?</strong> Sell assets to cover the debt, or declare bankruptcy. Your cash goes to
          the player you owe and your properties return to the bank.
        </li>
        <li>
          <strong>Bots:</strong> the host can fill open seats with bots in the waiting room. If every human is
          out, the game ends and the richest remaining player wins.
        </li>
        <li>
          <strong>Idle players</strong> can be skipped by others after {RULES.idleMs / 60_000} minutes.
        </li>
      </ul>
      <button type="button" onClick={onClose}>
        Got it
      </button>
    </dialog>
  );
}
