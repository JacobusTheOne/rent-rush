"use client";

import { BOARD, DISTRICTS, TOKEN_COLORS, gridPosition, isOwnable } from "@/game/board";
import { rentFor, type GameState } from "@/game/engine";

const DICE = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const ICON: Partial<Record<string, string>> = {
  START: "➜",
  CELL: "▦",
  REST: "★",
  GO_TO_CELL: "⚠",
  FORTUNE: "?",
  TAX: "$",
  STATION: "🚉",
};

export function Board({ state }: { state: GameState }) {
  const current = state.players[state.current];
  return (
    <div className="board" role="grid" aria-label="Game board">
      {BOARD.map((sq, i) => {
        const { row, col } = gridPosition(i);
        const holding = state.holdings[i];
        const owner = holding ? state.players.find((p) => p.id === holding.owner) : undefined;
        const here = state.players.filter((p) => !p.bankrupt && p.position === i);
        const corner = i % 6 === 0;
        const title = [
          sq.name,
          isOwnable(sq) ? `Price $${sq.price}` : null,
          sq.kind === "TAX" ? `Pay $${sq.amount}` : null,
          owner ? `Owner: ${owner.name}${holding.level ? `, level ${holding.level}` : ""}, rent $${rentFor(state, i)}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <div
            key={i}
            className={`square ${corner ? "corner" : ""} ${current && current.position === i ? "active" : ""}`}
            style={{
              gridRow: row,
              gridColumn: col,
              borderColor: owner ? TOKEN_COLORS[owner.token] : undefined,
            }}
            title={title}
          >
            {sq.kind === "PROPERTY" && <div className="strip" style={{ background: DISTRICTS[sq.district].color }} />}
            <div className="sq-name">
              {ICON[sq.kind] && <span className="sq-icon">{ICON[sq.kind]}</span>}
              {sq.name}
            </div>
            {isOwnable(sq) && !owner && <div className="sq-price">${sq.price}</div>}
            {owner && (
              <div className="sq-owner" style={{ color: TOKEN_COLORS[owner.token] }}>
                ●
                {holding.level > 0 && <span className="pips">{"▲".repeat(holding.level)}</span>}
              </div>
            )}
            {here.length > 0 && (
              <div className="tokens">
                {here.map((p) => (
                  <span
                    key={p.id}
                    className="token"
                    style={{ background: TOKEN_COLORS[p.token] }}
                    title={p.name}
                    aria-label={p.name}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="board-center">
        <div className="board-title">RENT RUSH</div>
        <div className="muted small">
          Round {Math.min(state.round, state.maxRounds)} of {state.maxRounds}
        </div>
        {state.dice && (
          <div className="dice" aria-label={`Dice: ${state.dice[0]} and ${state.dice[1]}`}>
            {DICE[state.dice[0]]} {DICE[state.dice[1]]}
          </div>
        )}
        <div className="jackpot">
          ★ Jackpot <strong>${state.jackpot}</strong>
        </div>
        {state.lastCard && <div className="card">Fortune: {state.lastCard}</div>}
      </div>
    </div>
  );
}
