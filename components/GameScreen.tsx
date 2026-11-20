"use client";

import { useEffect, useState } from "react";
import { BOARD, RULES } from "@/game/board";
import { type Action, type GameState, netWorth } from "@/game/engine";
import type { Game } from "@/lib/api";
import { useBoardAnimation } from "@/lib/useBoardAnimation";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { isMuted, onMutedChange, setMuted } from "@/lib/sound";
import { Board } from "./Board";
import { MyHand, Nameplate, OpponentSeat, seatOrder } from "./TableSeats";

interface Props {
  game: Game;
  me: string;
  busy: boolean;
  error: string | null;
  onAction: (a: Action) => void;
  onLeave: () => void;
  onExit: () => void;
}

export function GameScreen({ game, me, busy: requestBusy, error, onAction, onLeave, onExit }: Props) {
  const state = game.state!;
  const view = useBoardAnimation(state);
  // Hold the turn buttons until the dice and pieces have finished moving.
  const busy = requestBusy || view.animating;
  const current = state.players[state.current];
  const mePlayer = state.players.find((p) => p.id === me);
  const myTurn = current.id === me && state.phase !== "OVER";

  const { bottom, others } = seatOrder(state, me);
  const lastEvent = state.log.at(-1)?.text;
  // Wide screens: turn controls sit in the board's centre so the board can be big.
  const wide = useMediaQuery("(min-width: 1001px)");

  const turnPanel = (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {state.phase === "OVER" ? (
          <GameOver state={state} onExit={onExit} />
        ) : myTurn ? (
          <MyTurn state={state} busy={busy} onAction={onAction} />
        ) : (
          <Waiting state={state} canSkip={!!mePlayer && !mePlayer.bankrupt} busy={busy} onAction={onAction} />
        )}
        {lastEvent && state.phase !== "OVER" && <p className="last-event muted small">{lastEvent}</p>}
      </div>
    </>
  );

  return (
    <div className="table-view">
      <div className={`table seats-${others.length}`}>
        <div className="table-bar">
          <h2 className="game-name">{game.name}</h2>
          <div className="row">
            <button type="button" className="secondary" onClick={onExit}>
              Lobby
            </button>
            <SoundToggle />
            {mePlayer && !mePlayer.bankrupt && state.phase !== "OVER" && (
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (confirm("Leave the game? You'll forfeit and your properties go back to the bank.")) onLeave();
                }}
              >
                Forfeit
              </button>
            )}
          </div>
        </div>
        {others.map(({ player, position }) => (
          <OpponentSeat key={player.id} state={state} player={player} position={position} me={me} />
        ))}
        <div className="table-board">
          <Board state={state} view={view}>
            {wide ? turnPanel : null}
          </Board>
        </div>
        <section className="table-me" aria-label="Your seat">
          <div className="me-panel">
            <Nameplate state={state} player={bottom} me={me} />
            {!wide && <div className="panel">{turnPanel}</div>}
          </div>
          <MyHand state={state} player={bottom} me={me} busy={busy} myTurn={myTurn} onAction={onAction} />
        </section>
      </div>

      <Log state={state} />
    </div>
  );
}

function SoundToggle() {
  // Starts unmuted on the server render; the saved setting is applied after mount.
  const [muted, setMutedState] = useState(false);
  useEffect(() => {
    setMutedState(isMuted());
    return onMutedChange(setMutedState);
  }, []);
  return (
    <button
      type="button"
      className="secondary"
      aria-pressed={muted}
      title={muted ? "Sound off" : "Sound on"}
      aria-label={muted ? "Turn sound on" : "Turn sound off"}
      onClick={() => setMuted(!muted)}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}

function MyTurn({ state, busy, onAction }: { state: GameState; busy: boolean; onAction: (a: Action) => void }) {
  const p = state.players[state.current];
  switch (state.phase) {
    case "ROLL":
      return (
        <>
          <p>
            <strong>Your turn.</strong>{" "}
            {p.inCell
              ? `You're in the Holding Cell (attempt ${p.cellAttempts + 1} of ${RULES.maxCellAttempts}). Roll doubles to get out, or pay.`
              : state.extraRoll
                ? "Doubles! Roll again."
                : "Roll the dice."}
          </p>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => onAction({ type: "ROLL" })}>
              🎲 Roll dice
            </button>
            {p.inCell && (
              <button
                type="button"
                className="secondary"
                disabled={busy || p.cash < RULES.bail}
                onClick={() => onAction({ type: "PAY_BAIL" })}
              >
                Pay ${RULES.bail} bail
              </button>
            )}
            {p.inCell && p.freeCards > 0 && (
              <button type="button" className="secondary" disabled={busy} onClick={() => onAction({ type: "USE_CARD" })}>
                Use Walk Free card
              </button>
            )}
          </div>
        </>
      );
    case "BUY": {
      const sq = BOARD[state.pendingBuy!];
      const price = "price" in sq ? sq.price : 0;
      return (
        <>
          <p>
            Buy <strong>{sq.name}</strong> for ${price}? You have ${p.cash}.
            <br />
            <span className="muted small">No auctions in Rent Rush: if you pass, it stays unowned.</span>
          </p>
          <div className="row">
            <button type="button" disabled={busy || p.cash < price} onClick={() => onAction({ type: "BUY" })}>
              Buy for ${price}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => onAction({ type: "DECLINE" })}>
              Pass
            </button>
          </div>
        </>
      );
    }
    case "DEBT": {
      const debt = state.debt!;
      return (
        <>
          <p>
            You owe <strong>${debt.amount}</strong> ({debt.reason}) but have ${p.cash}. Sell upgrades or properties
            below to raise cash.
          </p>
          <div className="row">
            <button
              type="button"
              disabled={busy || p.cash < debt.amount}
              onClick={() => onAction({ type: "PAY_DEBT" })}
            >
              Pay ${debt.amount}
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => {
                if (confirm("Declare bankruptcy? You'll be out of the game.")) onAction({ type: "BANKRUPT" });
              }}
            >
              Declare bankruptcy
            </button>
          </div>
        </>
      );
    }
    case "END":
      return (
        <>
          <p>Upgrade or sell properties below if you like, then end your turn.</p>
          <button type="button" disabled={busy} onClick={() => onAction({ type: "END_TURN" })}>
            End turn
          </button>
        </>
      );
    default:
      return null;
  }
}

function Waiting({
  state,
  canSkip,
  busy,
  onAction,
}: {
  state: GameState;
  canSkip: boolean;
  busy: boolean;
  onAction: (a: Action) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);
  const current = state.players[state.current];
  // Small margin for clock differences between this browser and the server.
  const idle = now - state.turnStartedAt > RULES.idleMs + 5_000;
  return (
    <>
      <p>
        {current.bot ? "🤖 " : ""}Waiting for <strong>{current.name}</strong>
        {state.phase === "BUY" ? " to decide on a purchase" : state.phase === "DEBT" ? " to settle a debt" : ""}…
      </p>
      {canSkip && idle && !current.bot && (
        <button type="button" className="secondary" disabled={busy} onClick={() => onAction({ type: "SKIP_IDLE" })}>
          Skip idle player
        </button>
      )}
    </>
  );
}

function GameOver({ state, onExit }: { state: GameState; onExit: () => void }) {
  const ranked = [...state.players].sort((a, b) => netWorth(state, b.id) - netWorth(state, a.id));
  const winner = state.players.find((p) => p.id === state.winner);
  return (
    <>
      <p className="winner">🏆 {winner?.name ?? "Nobody"} wins!</p>
      <ol>
        {ranked.map((p) => (
          <li key={p.id}>
            {p.name}: {p.bankrupt ? "bankrupt" : `$${netWorth(state, p.id)} net worth`}
          </li>
        ))}
      </ol>
      <button type="button" onClick={onExit}>
        Back to lobby
      </button>
    </>
  );
}

function Log({ state }: { state: GameState }) {
  return (
    <details className="panel log">
      <summary>Game log ({state.log.length})</summary>
      <ol reversed>
        {[...state.log].reverse().map((e) => (
          <li key={e.n}>{e.text}</li>
        ))}
      </ol>
    </details>
  );
}
