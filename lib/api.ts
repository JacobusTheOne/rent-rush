"use client";

import { client } from "./amplify";
import type { Action, GameState } from "@/game/engine";

export type GameStatus = "WAITING" | "PLAYING" | "FINISHED" | "CLOSED";

export interface Game {
  gameId: string;
  name: string;
  status: GameStatus;
  hostId: string;
  maxPlayers: number;
  maxRounds: number;
  players: { id: string; name: string; bot?: boolean | null }[];
  version: number;
  updatedAt: string;
  state: GameState | null;
}

/** AWSJSON arrives as a string (possibly double-encoded); normalise to an object. */
function parseState(raw: unknown): GameState | null {
  let value = raw;
  for (let i = 0; i < 2 && typeof value === "string"; i++) value = JSON.parse(value);
  return (value as GameState) ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toGame(raw: any): Game {
  return { ...raw, players: raw.players ?? [], state: parseState(raw.state) } as Game;
}

async function unwrap<T>(call: Promise<{ data: T; errors?: { message: string }[] }>): Promise<T> {
  const { data, errors } = await call;
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return data;
}

async function one(call: Promise<{ data: unknown; errors?: { message: string }[] }>): Promise<Game> {
  const data = await unwrap(call);
  if (!data) throw new Error("Game not found");
  return toGame(data);
}

export const api = {
  async listLobby(): Promise<Game[]> {
    const data = await unwrap(client.queries.listLobby());
    return (data ?? []).map(toGame);
  },
  getGame: (gameId: string) => one(client.queries.getGame({ gameId })),
  createGame: (name: string, maxPlayers: number, maxRounds: number) =>
    one(client.mutations.createGame({ name, maxPlayers, maxRounds })),
  joinGame: (gameId: string) => one(client.mutations.joinGame({ gameId })),
  leaveGame: (gameId: string) => one(client.mutations.leaveGame({ gameId })),
  startGame: (gameId: string) => one(client.mutations.startGame({ gameId })),
  addBot: (gameId: string) => one(client.mutations.addBot({ gameId })),
  removeBot: (gameId: string, botId: string) => one(client.mutations.removeBot({ gameId, botId })),
  /** Ask the server to make the current bot's next move. */
  botStep: (gameId: string) =>
    one(client.mutations.gameAction({ gameId, action: JSON.stringify({ type: "BOT_STEP" }) })),
  act: (gameId: string, action: Action) =>
    one(client.mutations.gameAction({ gameId, action: JSON.stringify(action) })),

  /** Real-time updates for one game, or for every game when gameId is omitted (lobby). */
  subscribe(gameId: string | undefined, onGame: (g: Game) => void, onError: (e: unknown) => void) {
    const sub = client.subscriptions
      .onGameUpdated(gameId ? { gameId } : {})
      .subscribe({ next: (data) => data && onGame(toGame(data)), error: onError });
    return () => sub.unsubscribe();
  },
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errors = (err as any)?.errors;
  if (Array.isArray(errors) && errors[0]?.message) return errors[0].message;
  return "Something went wrong";
}
