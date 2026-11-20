"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RULES } from "@/game/board";
import { api, errorMessage, type Game } from "@/lib/api";

interface Props {
  me: string;
  myName: string;
  onOpen: (gameId: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  WAITING: "Waiting for players",
  PLAYING: "In progress",
  FINISHED: "Finished",
};

export function Lobby({ me, myName, onOpen }: Props) {
  const [games, setGames] = useState<Map<string, Game>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [maxRounds, setMaxRounds] = useState<number>(20);
  const [isPrivate, setIsPrivate] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listLobby();
      setGames(new Map(list.map((g) => [g.gameId, g])));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Live updates for every game; keep only what this player should see.
    const unsubscribe = api.subscribe(
      undefined,
      (g) =>
        setGames((prev) => {
          const current = prev.get(g.gameId);
          if (current && current.version >= g.version) return prev;
          const next = new Map(prev);
          const mine = g.players.some((p) => p.id === me);
          if (g.status === "CLOSED" || (g.status !== "WAITING" && !mine)) next.delete(g.gameId);
          else next.set(g.gameId, g);
          return next;
        }),
      () => setError("Live updates disconnected. Refresh the page to reconnect."),
    );
    // Fallback in case a subscription message is missed.
    const timer = setInterval(refresh, 30_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [me, refresh]);

  const { mine, open } = useMemo(() => {
    const all = [...games.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      mine: all.filter((g) => g.players.some((p) => p.id === me)),
      open: all.filter((g) => g.status === "WAITING" && !g.players.some((p) => p.id === me)),
    };
  }, [games, me]);

  async function run(fn: () => Promise<Game>) {
    setBusy(true);
    setError(null);
    try {
      const g = await fn();
      onOpen(g.gameId);
    } catch (err) {
      setError(errorMessage(err));
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lobby">
      <section className="panel create">
        <h2>Create a game</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api.createGame(name.trim() || `${myName || "My"}'s table`, maxPlayers, maxRounds, isPrivate));
          }}
        >
          <label>
            Table name
            <input
              value={name}
              maxLength={40}
              placeholder={`${myName || "My"}'s table`}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="row">
            <label>
              Players
              <select value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))}>
                {[2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} players
                  </option>
                ))}
              </select>
            </label>
            <label>
              Length
              <select value={maxRounds} onChange={(e) => setMaxRounds(Number(e.target.value))}>
                {RULES.roundOptions.map((n) => (
                  <option key={n} value={n}>
                    {n} rounds
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="visibility">
            <legend>Who can join</legend>
            <label className="choice">
              <input type="radio" name="visibility" checked={!isPrivate} onChange={() => setIsPrivate(false)} />
              <span>
                <strong>Public</strong>
                <span className="muted small"> · listed under Open tables</span>
              </span>
            </label>
            <label className="choice">
              <input type="radio" name="visibility" checked={isPrivate} onChange={() => setIsPrivate(true)} />
              <span>
                <strong>Private</strong>
                <span className="muted small"> · only people with your invite link</span>
              </span>
            </label>
          </fieldset>
          <button type="submit" disabled={busy}>
            Create table
          </button>
        </form>
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="panel">
        <h2>Your games</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : mine.length === 0 ? (
          <p className="muted">You aren&apos;t in any games yet. Create one or join an open table.</p>
        ) : (
          <ul className="game-list">
            {mine.map((g) => (
              <GameRow key={g.gameId} game={g} me={me}>
                <button type="button" onClick={() => onOpen(g.gameId)}>
                  {g.status === "PLAYING" ? "Resume" : "Open"}
                </button>
              </GameRow>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Open tables</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : open.length === 0 ? (
          <p className="muted">No open tables right now. Create one and share its invite link with friends.</p>
        ) : (
          <ul className="game-list">
            {open.map((g) => (
              <GameRow key={g.gameId} game={g} me={me}>
                <button
                  type="button"
                  disabled={busy || g.players.length >= g.maxPlayers}
                  onClick={() => run(() => api.joinGame(g.gameId))}
                >
                  {g.players.length >= g.maxPlayers ? "Full" : "Join"}
                </button>
              </GameRow>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function GameRow({ game, me, children }: { game: Game; me: string; children: React.ReactNode }) {
  const turn = game.state && game.status === "PLAYING" ? game.state.players[game.state.current] : null;
  return (
    <li className="game-row">
      <div>
        <strong>{game.name}</strong>
        {game.isPrivate && <span className="badge">private</span>}
        <div className="muted small">
          {STATUS_LABEL[game.status] ?? game.status} · {game.players.length}/{game.maxPlayers} players ·{" "}
          {game.maxRounds} rounds
          {turn && (turn.id === me ? " · Your turn!" : ` · ${turn.name}'s turn`)}
        </div>
        <div className="small">{game.players.map((p) => p.name).join(", ")}</div>
      </div>
      {children}
    </li>
  );
}
