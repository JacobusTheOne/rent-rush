"use client";

import { useCallback, useEffect, useState } from "react";
import { RULES } from "@/game/board";
import { api, errorMessage, type Game } from "@/lib/api";
import { GameScreen } from "./GameScreen";

/** Pause between bot moves so humans can follow along. */
const BOT_STEP_MS = 900;
/** Backup drivers wait longer, so normally only one browser triggers bot moves. */
const BOT_BACKUP_MS = 6_000;

interface Props {
  gameId: string;
  me: string;
  onExit: () => void;
}

/** Loads one game, keeps it live via subscription, and shows the waiting room or the board. */
export function GameRoom({ gameId, me, onExit }: Props) {
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const accept = useCallback((g: Game) => {
    setGame((prev) => (prev && prev.version >= g.version ? prev : g));
  }, []);

  const refresh = useCallback(async () => {
    try {
      accept(await api.getGame(gameId));
    } catch (err) {
      setLoadFailed(true);
      setError(errorMessage(err));
    }
  }, [accept, gameId]);

  useEffect(() => {
    refresh();
    const unsubscribe = api.subscribe(gameId, accept, () =>
      setError("Live updates disconnected. Refresh the page to reconnect."),
    );
    const timer = setInterval(refresh, 20_000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [accept, gameId, refresh]);

  // Bots: when it's a bot's turn, ask the server for its next move, one step at a time,
  // so everyone sees it play. The first active human drives; others step in if that
  // player's browser goes quiet. Duplicate/conflicting requests are harmless (version check).
  const botTurn = (() => {
    const s = game?.status === "PLAYING" ? game.state : null;
    if (!s || s.phase === "OVER" || !s.players[s.current].bot) return null;
    if (!s.players.some((p) => p.id === me && !p.bot)) return null;
    const driver = s.players.find((p) => !p.bot && !p.bankrupt);
    return { version: game!.version, delay: driver?.id === me ? BOT_STEP_MS : BOT_BACKUP_MS };
  })();

  // Bumped after a failed bot step so the effect retries even if the game didn't change.
  const [botRetry, setBotRetry] = useState(0);

  useEffect(() => {
    if (!botTurn) return;
    const timer = setTimeout(
      () => {
        api.botStep(gameId).then(accept, async () => {
          await refresh();
          setBotRetry((n) => n + 1);
        });
      },
      botRetry ? Math.max(botTurn.delay, 3_000) : botTurn.delay,
    );
    return () => clearTimeout(timer);
  }, [botTurn?.version, botTurn?.delay, botRetry, accept, gameId, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Run a server call; the returned game replaces the local copy immediately. */
  const run = useCallback(
    async (fn: () => Promise<Game>) => {
      setBusy(true);
      setError(null);
      try {
        accept(await fn());
      } catch (err) {
        setError(errorMessage(err));
        refresh();
      } finally {
        setBusy(false);
      }
    },
    [accept, refresh],
  );

  if (!game) {
    return (
      <div className="panel center">
        {loadFailed ? (
          <>
            <p className="error">{error}</p>
            <button type="button" onClick={onExit}>
              Back to lobby
            </button>
          </>
        ) : (
          <p className="muted">Loading game…</p>
        )}
      </div>
    );
  }

  if (game.status === "CLOSED") {
    return (
      <div className="panel center">
        <p>This table was closed.</p>
        <button type="button" onClick={onExit}>
          Back to lobby
        </button>
      </div>
    );
  }

  const isPlayer = game.players.some((p) => p.id === me);

  if (game.status === "WAITING") {
    const isHost = game.hostId === me;
    const canStart = game.players.length >= RULES.minPlayers;
    return (
      <div className="panel waiting">
        <h2>{game.name}</h2>
        <p className="muted">
          {game.maxRounds} rounds · waiting for players ({game.players.length}/{game.maxPlayers})
        </p>
        <ul className="seats">
          {Array.from({ length: game.maxPlayers }, (_, i) => game.players[i]).map((p, i) => (
            <li key={p?.id ?? `empty-${i}`} className={p ? "seat taken" : "seat"}>
              {p ? (
                <>
                  {p.bot && <span aria-hidden>🤖 </span>}
                  {p.name}
                  {p.bot && <span className="badge">bot</span>}
                  {p.id === game.hostId && <span className="badge">host</span>}
                  {p.id === me && <span className="badge you">you</span>}
                  {p.bot && isHost && (
                    <button
                      type="button"
                      className="seat-remove"
                      aria-label={`Remove ${p.name}`}
                      title="Remove bot"
                      disabled={busy}
                      onClick={() => run(() => api.removeBot(game.gameId, p.id))}
                    >
                      ×
                    </button>
                  )}
                </>
              ) : isHost ? (
                <button
                  type="button"
                  className="seat-add"
                  disabled={busy}
                  onClick={() => run(() => api.addBot(game.gameId))}
                >
                  <span className="muted">Open seat</span>
                  <span className="seat-add-label">+ Add bot</span>
                </button>
              ) : (
                <span className="muted">Open seat</span>
              )}
            </li>
          ))}
        </ul>
        {error && <p className="error">{error}</p>}
        <div className="row">
          {!isPlayer && game.players.length < game.maxPlayers && (
            <button type="button" disabled={busy} onClick={() => run(() => api.joinGame(game.gameId))}>
              Join this table
            </button>
          )}
          {isHost && (
            <button type="button" disabled={busy || !canStart} onClick={() => run(() => api.startGame(game.gameId))}>
              {canStart ? "Start game" : `Need ${RULES.minPlayers}+ players`}
            </button>
          )}
          {isPlayer && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={async () => {
                await run(() => api.leaveGame(game.gameId));
                onExit();
              }}
            >
              Leave table
            </button>
          )}
          <button type="button" className="secondary" onClick={onExit}>
            Back to lobby
          </button>
        </div>
        {isHost && game.players.length < game.maxPlayers && (
          <p className="muted small">Click an open seat to fill it with a bot, or wait for people to join.</p>
        )}
        {!isHost && isPlayer && <p className="muted small">The host starts the game once everyone is here.</p>}
        <p className="muted small">Other signed-in players can find this table in the lobby under “Open tables”.</p>
      </div>
    );
  }

  return (
    <GameScreen
      game={game}
      me={me}
      busy={busy}
      error={error}
      onAction={(action) => run(() => api.act(game.gameId, action))}
      onLeave={async () => {
        await run(() => api.leaveGame(game.gameId));
        onExit();
      }}
      onExit={onExit}
    />
  );
}
