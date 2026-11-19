"use client";

import { useEffect, useState } from "react";
import { BOARD, DISTRICTS, RULES, TOKEN_COLORS, upgradeCost } from "@/game/board";
import {
  type Action,
  type GameState,
  canSellProperty,
  canUpgrade,
  netWorth,
  ownedBy,
  rentFor,
} from "@/game/engine";
import type { Game } from "@/lib/api";
import { Board } from "./Board";

interface Props {
  game: Game;
  me: string;
  busy: boolean;
  error: string | null;
  onAction: (a: Action) => void;
  onLeave: () => void;
  onExit: () => void;
}

export function GameScreen({ game, me, busy, error, onAction, onLeave, onExit }: Props) {
  const state = game.state!;
  const current = state.players[state.current];
  const mePlayer = state.players.find((p) => p.id === me);
  const myTurn = current.id === me && state.phase !== "OVER";

  return (
    <div className="game">
      <div className="game-board">
        <Board state={state} />
      </div>
      <aside className="sidebar">
        <h2 className="game-name">{game.name}</h2>
        <Players state={state} me={me} />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="panel actions">
          {state.phase === "OVER" ? (
            <GameOver state={state} onExit={onExit} />
          ) : myTurn ? (
            <MyTurn state={state} busy={busy} onAction={onAction} />
          ) : (
            <Waiting state={state} canSkip={!!mePlayer && !mePlayer.bankrupt} busy={busy} onAction={onAction} />
          )}
        </div>
        {mePlayer && !mePlayer.bankrupt && (
          <MyProperties state={state} me={me} busy={busy} myTurn={myTurn} onAction={onAction} />
        )}
        <Log state={state} />
        <div className="row">
          <button type="button" className="secondary" onClick={onExit}>
            Lobby
          </button>
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
      </aside>
    </div>
  );
}

function Players({ state, me }: { state: GameState; me: string }) {
  return (
    <ul className="players">
      {state.players.map((p, i) => (
        <li
          key={p.id}
          className={`player ${i === state.current && state.phase !== "OVER" ? "turn" : ""} ${p.bankrupt ? "out" : ""}`}
        >
          <span className="token" style={{ background: TOKEN_COLORS[p.token] }} />
          <span className="pname">
            {p.name}
            {p.id === me && <span className="badge you">you</span>}
            {p.bot && <span className="badge">🤖 bot</span>}
            {p.inCell && <span className="badge">in cell</span>}
            {p.freeCards > 0 && <span className="badge">walk free ×{p.freeCards}</span>}
          </span>
          <span className="cash">{p.bankrupt ? "out" : `$${p.cash}`}</span>
          {!p.bankrupt && <span className="worth muted small">worth ${netWorth(state, p.id)}</span>}
        </li>
      ))}
    </ul>
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

function MyProperties({
  state,
  me,
  busy,
  myTurn,
  onAction,
}: {
  state: GameState;
  me: string;
  busy: boolean;
  myTurn: boolean;
  onAction: (a: Action) => void;
}) {
  const owned = ownedBy(state, me);
  const canManage = myTurn && state.phase !== "BUY";
  const canBuild = myTurn && (state.phase === "ROLL" || state.phase === "END");
  return (
    <div className="panel">
      <h3>Your properties</h3>
      {owned.length === 0 ? (
        <p className="muted small">None yet. Land on an unowned street or station to buy it.</p>
      ) : (
        <ul className="props">
          {owned.map((i) => {
            const sq = BOARD[i];
            const level = state.holdings[i].level;
            const color = sq.kind === "PROPERTY" ? DISTRICTS[sq.district].color : "#888";
            return (
              <li key={i}>
                <span className="swatch" style={{ background: color }} />
                <span className="pname">
                  {sq.name}
                  {level > 0 && <span className="pips"> {"▲".repeat(level)}</span>}
                  <span className="muted small"> rent ${rentFor(state, i)}</span>
                </span>
                {canManage && (
                  <span className="prop-actions">
                    {sq.kind === "PROPERTY" && canBuild && !canUpgrade(state, me, i) && (
                      <button type="button" className="tiny" disabled={busy} onClick={() => onAction({ type: "UPGRADE", square: i })}>
                        ▲ ${upgradeCost(sq)}
                      </button>
                    )}
                    {sq.kind === "PROPERTY" && level > 0 && (
                      <button
                        type="button"
                        className="tiny secondary"
                        disabled={busy}
                        onClick={() => onAction({ type: "SELL_UPGRADE", square: i })}
                      >
                        ▼ +${upgradeCost(sq) * RULES.sellBackRate}
                      </button>
                    )}
                    {!canSellProperty(state, me, i) && "price" in sq && (
                      <button
                        type="button"
                        className="tiny secondary"
                        disabled={busy}
                        onClick={() => {
                          if (confirm(`Sell ${sq.name} back to the bank for $${sq.price * RULES.sellBackRate}?`)) {
                            onAction({ type: "SELL_PROPERTY", square: i });
                          }
                        }}
                      >
                        Sell +${sq.price * RULES.sellBackRate}
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canBuild && owned.length > 0 && (
        <p className="muted small">Own both streets of a district to double rent and unlock upgrades (▲).</p>
      )}
    </div>
  );
}

function Log({ state }: { state: GameState }) {
  return (
    <div className="panel log">
      <h3>Game log</h3>
      <ol reversed>
        {[...state.log].reverse().map((e) => (
          <li key={e.n}>{e.text}</li>
        ))}
      </ol>
    </div>
  );
}
