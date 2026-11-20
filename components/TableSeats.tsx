"use client";

import { useRef, useState } from "react";
import { BOARD, DISTRICTS } from "@/game/board";
import { SQUARE_ART, TOKEN_ART } from "@/game/art";
import { type Action, type GameState, type PlayerState, netWorth, ownedBy, rentFor } from "@/game/engine";
import { useAvailableArt } from "@/lib/useArt";
import { Deed } from "./PlayerCards";
import { Token } from "./Token";

const ART_SRCS = [...SQUARE_ART, ...TOKEN_ART].map((a) => a.src);

export type SeatPosition = "top" | "left" | "right";

/**
 * Who sits where around the table: you at the bottom, then everyone else in turn
 * order going clockwise (left, top, right). Spectators see it from the first player's seat.
 */
export function seatOrder(state: GameState, me: string): { bottom: PlayerState; others: { player: PlayerState; position: SeatPosition }[] } {
  const start = Math.max(0, state.players.findIndex((p) => p.id === me));
  const rotated = state.players.map((_, k) => state.players[(start + k) % state.players.length]);
  const [bottom, ...rest] = rotated;
  const positions: SeatPosition[] = rest.length === 1 ? ["top"] : rest.length === 2 ? ["left", "right"] : ["left", "top", "right"];
  return { bottom, others: rest.map((player, k) => ({ player, position: positions[k] })) };
}

/** Name, token, cash and status for one seat. */
export function Nameplate({ state, player, me }: { state: GameState; player: PlayerState; me: string }) {
  const art = useAvailableArt(ART_SRCS);
  const isTurn = state.players[state.current].id === player.id && state.phase !== "OVER";
  return (
    <div className={`nameplate ${isTurn ? "turn" : ""} ${player.bankrupt ? "out" : ""}`}>
      <Token index={player.token} art={art} />
      <div className="nameplate-text">
        <span className="pname">
          {player.name}
          {player.id === me && <span className="badge you">you</span>}
          {player.bot && <span className="badge">🤖</span>}
          {player.inCell && <span className="badge">in cell</span>}
        </span>
        <span className="muted small">
          {player.bankrupt ? "out of the game" : `worth $${netWorth(state, player.id)}`}
        </span>
      </div>
      {!player.bankrupt && <span className="cash">${player.cash}</span>}
      {isTurn && <span className="turn-tag">turn</span>}
    </div>
  );
}

/** An opponent's seat: nameplate plus their cards face up (small; click one for the full deed). */
export function OpponentSeat({
  state,
  player,
  position,
  me,
}: {
  state: GameState;
  player: PlayerState;
  position: SeatPosition;
  me: string;
}) {
  const art = useAvailableArt(ART_SRCS);
  const dialog = useRef<HTMLDialogElement>(null);
  const [shown, setShown] = useState<number | null>(null);
  const owned = ownedBy(state, player.id);

  return (
    <section className={`table-seat seat-${position}`} aria-label={`${player.name}'s seat`}>
      <Nameplate state={state} player={player} me={me} />
      {owned.length === 0 && player.freeCards === 0 ? (
        <p className="muted small seat-empty">No cards yet</p>
      ) : (
        <ul className="mini-cards">
          {owned.map((i) => {
            const sq = BOARD[i];
            const level = state.holdings[i].level;
            const color = sq.kind === "PROPERTY" ? DISTRICTS[sq.district].color : "#56606a";
            return (
              <li key={i}>
                <button
                  type="button"
                  className="mini-card"
                  title={`${sq.name}: rent $${rentFor(state, i)}. Click for the full card.`}
                  onClick={() => {
                    setShown(i);
                    dialog.current?.showModal();
                  }}
                >
                  <span className="mini-band" style={{ background: color }}>
                    {level > 0 && <span className="pips">{"▲".repeat(level)}</span>}
                  </span>
                  <span className="mini-name">{sq.name}</span>
                  <span className="mini-rent">rent ${rentFor(state, i)}</span>
                </button>
              </li>
            );
          })}
          {Array.from({ length: player.freeCards }, (_, k) => (
            <li key={`free-${k}`}>
              <span className="mini-card walk-free" title="Walk Free card: leave the Holding Cell for free">
                <span className="mini-band" style={{ background: "#c9a227" }} />
                <span className="mini-name">Walk Free</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <dialog ref={dialog} className="deed-dialog" onClose={() => setShown(null)} onClick={(e) => e.target === dialog.current && dialog.current.close()}>
        {shown !== null && state.holdings[shown] && (
          <ul className="deeds single">
            <Deed
              state={state}
              square={shown}
              owner={player.id}
              image={art.has(SQUARE_ART[shown].src) ? SQUARE_ART[shown].src : null}
              canManage={false}
              canBuild={false}
              busy
              onAction={() => {}}
            />
          </ul>
        )}
        <button type="button" className="secondary" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </dialog>
    </section>
  );
}

/** Your hand along the bottom edge: full cards with Upgrade / Sell buttons. */
export function MyHand({
  state,
  player,
  me,
  busy,
  myTurn,
  onAction,
}: {
  state: GameState;
  player: PlayerState;
  me: string;
  busy: boolean;
  myTurn: boolean;
  onAction: (a: Action) => void;
}) {
  const art = useAvailableArt(ART_SRCS);
  const owned = ownedBy(state, player.id);
  const mine = player.id === me;
  const canManage = mine && myTurn && state.phase !== "BUY" && !player.bankrupt;
  const canBuild = mine && myTurn && (state.phase === "ROLL" || state.phase === "END");

  if (owned.length === 0 && player.freeCards === 0) {
    return (
      <div className="my-hand empty">
        <p className="muted small">
          {mine ? "Your cards appear here. Land on an unowned street or station to buy it." : "No cards yet."}
        </p>
      </div>
    );
  }
  return (
    <div className="my-hand">
      <ul className="deeds">
        {owned.map((i) => (
          <Deed
            key={i}
            state={state}
            square={i}
            owner={player.id}
            image={art.has(SQUARE_ART[i].src) ? SQUARE_ART[i].src : null}
            canManage={canManage}
            canBuild={canBuild}
            busy={busy}
            onAction={onAction}
          />
        ))}
        {Array.from({ length: player.freeCards }, (_, k) => (
          <li key={`free-${k}`} className="deed walk-free">
            <div className="deed-head" style={{ background: "#c9a227" }}>
              <span>Fortune card</span>
            </div>
            <div className="deed-body">
              <strong>Walk Free</strong>
              <p className="small">Leave the Holding Cell for free.{mine ? " Use it from your turn panel." : ""}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
