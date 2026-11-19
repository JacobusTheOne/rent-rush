"use client";

import { useMemo, useState } from "react";
import { ALL_ART } from "@/game/art";
import { FORTUNE_CARDS, newGame, type GameState } from "@/game/engine";
import { useAvailableArt } from "@/lib/useArt";
import { Board } from "@/components/Board";
import { PlayerCards } from "@/components/PlayerCards";

/**
 * Art preview: the board with a sample mid-game state, plus a checklist of every
 * image file. No sign-in needed and no backend calls. Open /art-preview while
 * replacing the JPGs in public/board/ (see BOARD-ART.md).
 */
function sampleState(dice: [number, number]): GameState {
  const s = newGame(
    [
      { id: "p1", name: "Player 1" },
      { id: "p2", name: "Player 2" },
      { id: "p3", name: "Player 3" },
      { id: "p4", name: "Player 4" },
    ],
    20,
    { rng: (max) => max - 1, now: 0 },
  );
  s.players.forEach((p, i) => (p.token = i));
  s.players[0].position = 0;
  s.players[1].position = 7;
  s.players[2].position = 7;
  s.players[3].position = 15;
  s.holdings = {
    "1": { owner: "p1", level: 0 },
    "2": { owner: "p1", level: 2 },
    "7": { owner: "p2", level: 0 },
    "15": { owner: "p3", level: 0 },
    "23": { owner: "p4", level: 3 },
    "19": { owner: "p4", level: 1 },
  };
  s.players[0].freeCards = 1;
  s.phase = "END";
  s.dice = dice;
  s.jackpot = 225;
  s.round = 7;
  s.lastCard = FORTUNE_CARDS[0];
  return s;
}

export default function ArtPreview() {
  const [dice, setDice] = useState<[number, number]>([3, 5]);
  const state = useMemo(() => sampleState(dice), [dice]);
  const srcs = useMemo(() => ALL_ART.map((a) => a.src), []);
  const found = useAvailableArt(srcs);

  return (
    <div className="app">
      <header className="site-header">
        <h1>Board art preview</h1>
        <div className="account">
          <button
            type="button"
            className="secondary"
            onClick={() => setDice([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)] as [number, number])}
          >
            Roll preview dice
          </button>
          <a className="link" href="/">
            Back to the game
          </a>
        </div>
      </header>
      <p className="muted">
        Replace files in <code>public/board/</code> with your own JPGs (same name and size), then hard-refresh
        (Ctrl+Shift+R). Missing files fall back to the built-in look. Found {found.size} of {ALL_ART.length}.
      </p>
      <div className="game">
        <div className="game-board">
          <Board state={state} />
        </div>
        <aside className="sidebar">
          <PlayerCards state={state} me="p1" busy={false} myTurn onAction={() => {}} />
        <div className="panel art-list">
          <h3>Image files</h3>
          <ul>
            {ALL_ART.map((a) => (
              <li key={a.src} className={found.has(a.src) ? "ok" : "missing"}>
                <span aria-hidden>{found.has(a.src) ? "✓" : "✗"}</span>
                <span>
                  <code>{a.src.replace("/board/", "")}</code>
                  <span className="muted small">
                    {" "}
                    {a.width}×{a.height} · {a.label}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        </aside>
      </div>
    </div>
  );
}
