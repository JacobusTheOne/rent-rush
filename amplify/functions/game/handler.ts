import { randomInt, randomUUID } from "node:crypto";
import type { AppSyncIdentityCognito, AppSyncIdentityIAM, AppSyncResolverEvent } from "aws-lambda";
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { RULES } from "../../../game/board";
import {
  ACTION_TYPES,
  type Action,
  type Ctx,
  type GameState,
  RuleError,
  applyAction,
  chooseBotAction,
  newGame,
} from "../../../game/engine";

const GAMES_TABLE = requireEnv("GAMES_TABLE");
const USER_POOL_ID = requireEnv("USER_POOL_ID");

const DAY = 24 * 60 * 60;
/** DynamoDB TTL per status: abandoned lobbies vanish fast, finished games linger briefly. */
const TTL_SECONDS: Record<Status, number> = { WAITING: 1 * DAY, PLAYING: 7 * DAY, FINISHED: 2 * DAY };

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});

type Status = "WAITING" | "PLAYING" | "FINISHED";

interface LobbyPlayer {
  id: string;
  name: string;
  bot?: boolean;
  guest?: boolean;
}

/** Who is calling: a signed-in player (user pool) or a guest (anonymous identity-pool identity). */
type Caller =
  | { id: string; guest: false; user: AppSyncIdentityCognito }
  | { id: string; guest: true; user: null };

const GUEST_PREFIX = "guest:";

function callerOf(event: GameEvent): Caller {
  const identity = event.identity as (AppSyncIdentityCognito & Partial<AppSyncIdentityIAM>) | null;
  if (identity?.sub) return { id: identity.sub, guest: false, user: identity };
  // Guests come in through IAM with an unauthenticated Cognito identity; its id stays the same in that browser.
  if (identity?.cognitoIdentityId && identity.cognitoIdentityAuthType === "unauthenticated") {
    return { id: `${GUEST_PREFIX}${identity.cognitoIdentityId}`, guest: true, user: null };
  }
  throw new Error("Unauthorized");
}

const BOT_NAMES = ["Bot Penny", "Bot Rex", "Bot Ivy", "Bot Max", "Bot Lulu", "Bot Otto"];

type IncomingAction = Action | { type: "BOT_STEP" };

interface GameItem {
  gameId: string;
  name: string;
  status: Status;
  hostId: string;
  maxPlayers: number;
  maxRounds: number;
  players: LobbyPlayer[];
  state: GameState | null;
  version: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

type Args = Record<string, unknown>;
// Amplify puts fieldName at the top level; plain AppSync puts it under `info`.
type GameEvent = AppSyncResolverEvent<Args> & { fieldName?: string };

export const handler = async (event: GameEvent) => {
  const caller = callerOf(event);
  const me = caller.id;
  const args = event.arguments ?? {};
  const fieldName = event.fieldName ?? event.info?.fieldName;

  try {
    switch (fieldName) {
      case "listLobby":
        return await listLobby(me);
      case "getGame":
        return view(await load(str(args.gameId, "gameId")));
      case "createGame":
        return await createGame(caller, args);
      case "joinGame":
        return await joinGame(caller, str(args.gameId, "gameId"), args.playerName);
      case "leaveGame":
        return await leaveGame(me, str(args.gameId, "gameId"));
      case "startGame":
        return await startGame(me, str(args.gameId, "gameId"));
      case "addBot":
        return await addBot(me, str(args.gameId, "gameId"));
      case "removeBot":
        return await removeBot(me, str(args.gameId, "gameId"), str(args.botId, "botId"));
      case "gameAction":
        return await gameAction(me, str(args.gameId, "gameId"), parseAction(args.action));
      default:
        throw new Error(`Unknown field ${fieldName}`);
    }
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      throw new Error("The game changed at the same moment. Please try again.");
    }
    throw err;
  }
};

// ---------------------------------------------------------------- operations

async function listLobby(me: string) {
  const [waiting, playing, finished] = await Promise.all(
    (["WAITING", "PLAYING", "FINISHED"] as const).map((status) => byStatus(status)),
  );
  const mine = (g: GameItem) => g.players.some((p) => p.id === me);
  // Open lobbies for everyone; in-progress/finished games only for their players.
  return [...waiting, ...playing.filter(mine), ...finished.filter(mine)].map((g) => view(g));
}

async function createGame(caller: Caller, args: Args) {
  const name = str(args.name, "name").trim().slice(0, 40);
  if (!name) throw new Error("Give the game a name");
  const maxPlayers = Number(args.maxPlayers);
  const maxRounds = Number(args.maxRounds);
  if (!Number.isInteger(maxPlayers) || maxPlayers < RULES.minPlayers || maxPlayers > RULES.maxPlayers) {
    throw new Error(`Players must be ${RULES.minPlayers}-${RULES.maxPlayers}`);
  }
  if (!(RULES.roundOptions as readonly number[]).includes(maxRounds)) {
    throw new Error(`Rounds must be one of ${RULES.roundOptions.join(", ")}`);
  }
  const waiting = await byStatus("WAITING");
  if (waiting.some((g) => g.hostId === caller.id)) {
    throw new Error("You are already hosting an open game");
  }

  const now = Date.now();
  const item: GameItem = {
    gameId: randomUUID(),
    name,
    status: "WAITING",
    hostId: caller.id,
    maxPlayers,
    maxRounds,
    players: [await seat(caller, args.playerName, [])],
    state: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    expiresAt: ttl("WAITING", now),
  };
  await ddb.send(
    new PutCommand({ TableName: GAMES_TABLE, Item: item, ConditionExpression: "attribute_not_exists(gameId)" }),
  );
  return view(item);
}

async function joinGame(caller: Caller, gameId: string, guestName: unknown) {
  const game = await load(gameId);
  if (game.players.some((p) => p.id === caller.id)) return view(game);
  if (game.status !== "WAITING") throw new Error("That game has already started");
  if (game.players.length >= game.maxPlayers) throw new Error("That game is full");
  const next = { ...game, players: [...game.players, await seat(caller, guestName, game.players)] };
  return view(await save(game, next));
}

async function leaveGame(me: string, gameId: string) {
  const game = await load(gameId);
  if (!game.players.some((p) => p.id === me)) throw new Error("You are not in that game");

  if (game.status === "PLAYING") return gameAction(me, gameId, { type: "FORFEIT" });
  if (game.status === "FINISHED") return view(game);

  const players = game.players.filter((p) => p.id !== me);
  const humans = players.filter((p) => !p.bot);
  // A table of only bots is pointless: close it when the last human leaves.
  if (humans.length === 0) return closeGame(game);
  const hostId = game.hostId === me ? humans[0].id : game.hostId;
  return view(await save(game, { ...game, players, hostId }));
}

async function addBot(me: string, gameId: string) {
  const game = await load(gameId);
  if (game.hostId !== me) throw new Error("Only the host can add bots");
  if (game.status !== "WAITING") throw new Error("The game has already started");
  if (game.players.length >= game.maxPlayers) throw new Error("The table is full");
  const taken = new Set(game.players.map((p) => p.name));
  const name = BOT_NAMES.find((n) => !taken.has(n)) ?? `Bot ${game.players.length + 1}`;
  const bot: LobbyPlayer = { id: `bot-${randomUUID()}`, name, bot: true };
  return view(await save(game, { ...game, players: [...game.players, bot] }));
}

async function removeBot(me: string, gameId: string, botId: string) {
  const game = await load(gameId);
  if (game.hostId !== me) throw new Error("Only the host can remove bots");
  if (game.status !== "WAITING") throw new Error("The game has already started");
  if (!game.players.some((p) => p.id === botId && p.bot)) throw new Error("No such bot");
  return view(await save(game, { ...game, players: game.players.filter((p) => p.id !== botId) }));
}

async function startGame(me: string, gameId: string) {
  const game = await load(gameId);
  if (game.hostId !== me) throw new Error("Only the host can start the game");
  if (game.status !== "WAITING") throw new Error("The game has already started");
  if (game.players.length < RULES.minPlayers) throw new Error(`Need at least ${RULES.minPlayers} players`);
  const state = newGame(game.players, game.maxRounds, ctx());
  return view(await save(game, { ...game, status: "PLAYING", state }));
}

async function gameAction(me: string, gameId: string, action: IncomingAction) {
  const game = await load(gameId);
  if (game.status !== "PLAYING" || !game.state) throw new Error("This game isn't in progress");
  if (!game.players.some((p) => p.id === me && !p.bot)) throw new Error("You are not in this game");
  let state: GameState;
  try {
    if (action.type === "BOT_STEP") {
      // The client only says "it's a bot's turn, go"; the server picks the move.
      const current = game.state.players[game.state.current];
      if (!current.bot || game.state.phase === "OVER") throw new RuleError("It's not a bot's turn");
      state = applyAction(game.state, current.id, chooseBotAction(game.state), ctx());
    } else {
      state = applyAction(game.state, me, action, ctx());
    }
  } catch (err) {
    // Rule violations are expected user errors: surface the message as-is.
    if (err instanceof RuleError) throw new Error(err.message);
    throw err;
  }
  // The last human forfeiting leaves a bots-only table: close it rather than keep a finished game around.
  if (action.type === "FORFEIT" && !state.players.some((p) => !p.bot && !p.bankrupt)) {
    return closeGame(game);
  }
  const status: Status = state.phase === "OVER" ? "FINISHED" : "PLAYING";
  return view(await save(game, { ...game, status, state }));
}

/** Deletes the table (if nobody changed it meanwhile); clients and the lobby see status CLOSED. */
async function closeGame(game: GameItem) {
  await ddb.send(
    new DeleteCommand({
      TableName: GAMES_TABLE,
      Key: { gameId: game.gameId },
      ConditionExpression: "version = :v",
      ExpressionAttributeValues: { ":v": game.version },
    }),
  );
  return view({ ...game, players: [], version: game.version + 1 }, "CLOSED");
}

// ---------------------------------------------------------------- persistence

async function load(gameId: string): Promise<GameItem> {
  const { Item } = await ddb.send(new GetCommand({ TableName: GAMES_TABLE, Key: { gameId } }));
  if (!Item) throw new Error("Game not found");
  return Item as GameItem;
}

/** Optimistic concurrency: the write only succeeds if nobody else changed the game since we read it. */
async function save(prev: GameItem, next: GameItem): Promise<GameItem> {
  const now = Date.now();
  const item: GameItem = {
    ...next,
    version: prev.version + 1,
    updatedAt: now,
    expiresAt: ttl(next.status, now),
  };
  await ddb.send(
    new PutCommand({
      TableName: GAMES_TABLE,
      Item: item,
      ConditionExpression: "version = :v",
      ExpressionAttributeValues: { ":v": prev.version },
    }),
  );
  return item;
}

async function byStatus(status: Status): Promise<GameItem[]> {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: GAMES_TABLE,
      IndexName: "byStatus",
      KeyConditionExpression: "#s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": status },
      ScanIndexForward: false,
      Limit: 100,
    }),
  );
  return (Items ?? []) as GameItem[];
}

// ---------------------------------------------------------------- helpers

function view(g: GameItem, status: string = g.status) {
  return {
    gameId: g.gameId,
    name: g.name,
    status,
    hostId: g.hostId,
    maxPlayers: g.maxPlayers,
    maxRounds: g.maxRounds,
    players: g.players,
    version: g.version,
    updatedAt: new Date(g.updatedAt).toISOString(),
    // AWSJSON: return a JSON string so AppSync passes it through unchanged.
    state: g.state ? JSON.stringify(g.state) : null,
  };
}

function ctx(): Ctx {
  return { rng: (max) => randomInt(max), now: Date.now() };
}

function ttl(status: Status, now: number) {
  return Math.floor(now / 1000) + TTL_SECONDS[status];
}

const nameCache = new Map<string, string>();

/** Public name from Cognito (never the email address). */
/** The lobby entry for the caller: account name for signed-in players, a cleaned-up chosen name for guests. */
async function seat(caller: Caller, guestName: unknown, others: LobbyPlayer[]): Promise<LobbyPlayer> {
  if (!caller.guest) return { id: caller.id, name: await playerName(caller.user) };
  return { id: caller.id, name: uniqueName(cleanGuestName(guestName), others), guest: true };
}

/** Guests pick any name: keep it short and printable, and don't let it pose as a bot. */
function cleanGuestName(raw: unknown): string {
  const name = (typeof raw === "string" ? raw : "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
  if (name.length < 2 || /^bot\b/i.test(name)) return "Guest";
  return name;
}

function uniqueName(name: string, others: LobbyPlayer[]): string {
  const taken = new Set(others.map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
}

async function playerName(identity: AppSyncIdentityCognito): Promise<string> {
  const claimed = identity.claims?.preferred_username;
  if (typeof claimed === "string" && claimed) return claimed.slice(0, 24);
  const cached = nameCache.get(identity.sub);
  if (cached) return cached;
  const user = await cognito.send(
    new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: identity.username }),
  );
  const name =
    user.UserAttributes?.find((a) => a.Name === "preferred_username")?.Value?.slice(0, 24) || "Player";
  nameCache.set(identity.sub, name);
  return name;
}

function parseAction(raw: unknown): IncomingAction {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!value || typeof value !== "object") throw new Error("Invalid action");
  const { type, square } = value as { type?: unknown; square?: unknown };
  if (type === "BOT_STEP") return { type };
  if (typeof type !== "string" || !ACTION_TYPES.has(type)) throw new Error("Invalid action");
  if (square !== undefined && (!Number.isInteger(square) || (square as number) < 0 || (square as number) > 23)) {
    throw new Error("Invalid square");
  }
  return { type, square } as Action;
}

function str(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Missing ${field}`);
  return value;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
