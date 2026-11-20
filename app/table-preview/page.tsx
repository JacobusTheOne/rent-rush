"use client";

import { useState } from "react";
import { FORTUNE_CARDS, applyAction, newGame, type Action, type GameState } from "@/game/engine";
import type { Game } from "@/lib/api";
import { GameScreen } from "@/components/GameScreen";

/**
 * Table layout preview: the real game screen with a sample mid-game state, 2-4 players.
 * No sign-in and no backend calls: your actions run through the rules engine in the browser.
 */
const NAMES = ["You", "Bot Penny", "Rex", "Ivy"];

function sampleState(count: number): GameState {
  const players = NAMES.slice(0, count).map((name, i) => ({ id: `p${i + 1}`, name, bot: i === 1 }));
  const s = newGame(players, 20, { rng: (max) => max - 1, now: Date.now() });
  s.players.forEach((p, i) => (p.token = i));
  const holdings: GameState["holdings"] = {
    "1": { owner: "p1", level: 0 },
    "2": { owner: "p1", level: 2 },
    "4": { owner: "p1", level: 0 },
    "7": { owner: "p2", level: 0 },
    "8": { owner: "p2", level: 0 },
    "15": { owner: "p2", level: 0 },
    "10": { owner: "p3", level: 0 },
    "13": { owner: "p3", level: 0 },
    "19": { owner: "p4", level: 1 },
    "23": { owner: "p4", level: 1 },
    "16": { owner: "p4", level: 0 },
  };
  s.holdings = Object.fromEntries(
    Object.entries(holdings).filter(([, h]) => s.players.some((p) => p.id === h.owner)),
  );
  [3, 8, 13, 19].slice(0, count).forEach((pos, i) => (s.players[i].position = pos));
  s.players[0].freeCards = 1;
  s.players[0].cash = 940;
  s.current = 0;
  s.phase = "ROLL";
  s.jackpot = 225;
  s.round = 7;
  s.lastCard = FORTUNE_CARDS[0];
  return s;
}

function toGame(state: GameState): Game {
  return {
    gameId: "preview",
    name: "Preview table",
    status: state.phase === "OVER" ? "FINISHED" : "PLAYING",
    hostId: "p1",
    maxPlayers: state.players.length,
    maxRounds: state.maxRounds,
    players: state.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot })),
    version: 1,
    updatedAt: new Date().toISOString(),
    state,
  };
}

export default function TablePreview() {
  const [count, setCount] = useState(4);
  const [state, setState] = useState(() => sampleState(4));
  const [error, setError] = useState<string | null>(null);

  const act = (action: Action) => {
    try {
      let next = applyAction(state, "p1", action, { rng: (m) => Math.floor(Math.random() * m), now: Date.now() });
      // Skip the other players so it's your turn again (preview only).
      if (next.players[next.current].id !== "p1" && next.phase !== "OVER") {
        next = structuredClone(next);
        next.current = 0;
        next.phase = "ROLL";
      }
      setState(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="app">
      <header className="site-header">
        <h1>Table layout preview</h1>
        <div className="row">
          {[2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              className={n === count ? "" : "secondary"}
              onClick={() => {
                setCount(n);
                setState(sampleState(n));
              }}
            >
              {n} players
            </button>
          ))}
        </div>
      </header>
      <GameScreen
        key={count}
        game={toGame(state)}
        me="p1"
        busy={false}
        error={error}
        onAction={act}
        onLeave={() => setState(sampleState(count))}
        onExit={() => setState(sampleState(count))}
      />
    </div>
  );
}
