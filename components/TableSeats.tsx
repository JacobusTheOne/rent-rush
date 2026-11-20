"use client";

import { DEED_ART, TOKEN_ART } from "@/game/art";
import { type Action, type GameState, type PlayerState, netWorth, ownedBy } from "@/game/engine";
import { useAvailableArt } from "@/lib/useArt";
import { CardFan, type FanItem } from "./CardFan";
import { CashAmount } from "./MoneyAnimation";
import { Token } from "./Token";

const ART_SRCS = [...TOKEN_ART, ...Object.values(DEED_ART)].map((a) => a.src);
const deedSrc = (art: Set<string>, square: number) => (DEED_ART[square] && art.has(DEED_ART[square].src) ? DEED_ART[square].src : null);

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
      <Token index={player.token} icon={player.icon} art={art} />
      <div className="nameplate-text">
        <span className="pname">
          {player.name}
          {player.id === me && <span className="badge you">you</span>}
          {player.bot && <span className="badge">🤖</span>}
          {player.guest && <span className="badge">guest</span>}
          {player.inCell && <span className="badge">in cell</span>}
        </span>
        <span className="muted small">
          {player.bankrupt ? "out of the game" : `worth $${netWorth(state, player.id)}`}
        </span>
      </div>
      {!player.bankrupt && <CashAmount player={player} />}
      {isTurn && <span className="turn-tag">turn</span>}
    </div>
  );
}

/** An opponent's seat: nameplate plus their cards face up, overlapping (click one to read it). */
export function OpponentSeat({
  state,
  player,
  position,
  me,
  column = false,
}: {
  state: GameState;
  player: PlayerState;
  position: SeatPosition;
  me: string;
  /** Side seats on the one-screen layout: cards stacked down the side of the board. */
  column?: boolean;
}) {
  const art = useAvailableArt(ART_SRCS);
  const owned = ownedBy(state, player.id);
  const items: FanItem[] = [
    ...owned.map((i) => ({ key: `sq-${i}`, square: i, card: deedSrc(art, i) })),
    ...Array.from({ length: player.freeCards }, (_, k) => ({ key: `free-${k}`, square: null, card: null })),
  ];

  return (
    <section className={`table-seat seat-${position}`} aria-label={`${player.name}'s seat`}>
      <Nameplate state={state} player={player} me={me} />
      {items.length === 0 ? (
        <p className="muted small seat-empty">No cards yet</p>
      ) : (
        <CardFan
          state={state}
          owner={player.id}
          ownerName={player.name}
          items={items}
          variant={column ? "column" : "row"}
          className={`side-${position}`}
          canManage={false}
          canBuild={false}
          busy
          onAction={() => {}}
        />
      )}
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
  const items: FanItem[] = [
    ...owned.map((i) => ({ key: `sq-${i}`, square: i, card: deedSrc(art, i) })),
    ...Array.from({ length: player.freeCards }, (_, k) => ({ key: `free-${k}`, square: null, card: null })),
  ];
  return (
    <div className="my-hand">
      {/* Same small cards as everyone else's hand; hover enlarges, click opens the full card. */}
      <CardFan
        state={state}
        owner={player.id}
        items={items}
        variant="row"
        className="side-bottom"
        canManage={canManage}
        canBuild={canBuild}
        busy={busy}
        onAction={onAction}
      />
    </div>
  );
}
