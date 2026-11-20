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
  players: { id: string; name: string; bot?: boolean | null; guest?: boolean | null }[];
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

/**
 * Signed-in players call the API with their user-pool tokens; guests with the browser's
 * anonymous identity-pool credentials ("identityPool"). Set once at startup.
 */
let mode: { authMode: "userPool" | "identityPool" } = { authMode: "userPool" };
let guestName: string | undefined;

export function setGuestMode(name: string | null) {
  mode = { authMode: name ? "identityPool" : "userPool" };
  guestName = name ?? undefined;
}

export const api = {
  async listLobby(): Promise<Game[]> {
    const data = await unwrap(client.queries.listLobby(mode));
    return (data ?? []).map(toGame);
  },
  getGame: (gameId: string) => one(client.queries.getGame({ gameId }, mode)),
  createGame: (name: string, maxPlayers: number, maxRounds: number) =>
    one(client.mutations.createGame({ name, maxPlayers, maxRounds, playerName: guestName }, mode)),
  joinGame: (gameId: string) => one(client.mutations.joinGame({ gameId, playerName: guestName }, mode)),
  leaveGame: (gameId: string) => one(client.mutations.leaveGame({ gameId }, mode)),
  startGame: (gameId: string) => one(client.mutations.startGame({ gameId }, mode)),
  addBot: (gameId: string) => one(client.mutations.addBot({ gameId }, mode)),
  removeBot: (gameId: string, botId: string) => one(client.mutations.removeBot({ gameId, botId }, mode)),
  /** Ask the server to make the current bot's next move. */
  botStep: (gameId: string) =>
    one(client.mutations.gameAction({ gameId, action: JSON.stringify({ type: "BOT_STEP" }) }, mode)),
  act: (gameId: string, action: Action) =>
    one(client.mutations.gameAction({ gameId, action: JSON.stringify(action) }, mode)),

  /** Real-time updates for one game, or for every game when gameId is omitted (lobby). */
  subscribe(gameId: string | undefined, onGame: (g: Game) => void, onError: (e: unknown) => void) {
    const sub = client.subscriptions
      .onGameUpdated(gameId ? { gameId } : {}, mode)
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
