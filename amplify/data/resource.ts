import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { game } from "../functions/game/resource";

/**
 * Every read and write goes through the game Lambda, which owns a private
 * DynamoDB table and enforces the rules. Clients never write game data directly.
 * Players can sign in (Cognito user pool) or play as guests (anonymous identity-pool
 * identities, IAM auth): every operation allows both.
 */
const schema = a.schema({
  LobbyPlayer: a.customType({
    id: a.string().required(),
    name: a.string().required(),
    bot: a.boolean(),
    /** Playing without an account. */
    guest: a.boolean(),
    /** Chosen animal (index into TOKEN_ICONS in game/board.ts). */
    icon: a.integer(),
  }),

  GameView: a.customType({
    gameId: a.string().required(),
    name: a.string().required(),
    /** WAITING | PLAYING | FINISHED | CLOSED (deleted: the last human left, or forfeited leaving only bots) */
    status: a.string().required(),
    hostId: a.string().required(),
    maxPlayers: a.integer().required(),
    maxRounds: a.integer().required(),
    /** Private tables aren't listed in the lobby; players join with the invite link. */
    isPrivate: a.boolean().required(),
    players: a.ref("LobbyPlayer").required().array().required(),
    version: a.integer().required(),
    updatedAt: a.string().required(),
    /** Full GameState (see game/engine.ts) once the game has started. */
    state: a.json(),
  }),

  listLobby: a
    .query()
    .returns(a.ref("GameView").required().array())
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated(), allow.guest()]),

  getGame: a
    .query()
    .arguments({ gameId: a.string().required() })
    .returns(a.ref("GameView"))
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated(), allow.guest()]),

  createGame: a
    .mutation()
    .arguments({
      name: a.string().required(),
      maxPlayers: a.integer().required(),
      maxRounds: a.integer().required(),
      /** Guests only: the display name to use (signed-in players use their account name). */
      playerName: a.string(),
      /** true: not listed in the lobby; share the invite link instead. */
      isPrivate: a.boolean(),
    })
    .returns(a.ref("GameView"))
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated(), allow.guest()]),

  joinGame: a
    .mutation()
    .arguments({ gameId: a.string().required(), playerName: a.string() })
    .returns(a.ref("GameView"))
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated(), allow.guest()]),

  leaveGame: a
    .mutation()
    .arguments({ gameId: a.string().required() })
    .returns(a.ref("GameView"))
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated(), allow.guest()]),

  startGame: a
    .mutation()
    .arguments({ gameId: a.string().required() })
    .returns(a.ref("GameView"))
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated(), allow.guest()]),

  /** Host only, while waiting: fill an open seat with a computer player. */
  addBot: a
    .mutation()
    .arguments({ gameId: a.string().required() })
    .returns(a.ref("GameView"))
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated(), allow.guest()]),

  removeBot: a
    .mutation()
    .arguments({ gameId: a.string().required(), botId: a.string().required() })
    .returns(a.ref("GameView"))
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated(), allow.guest()]),

  /** While the table is waiting: pick your animal (each can only be taken once). */
  chooseIcon: a
    .mutation()
    .arguments({ gameId: a.string().required(), icon: a.integer().required() })
    .returns(a.ref("GameView"))
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated(), allow.guest()]),

  /**
   * A move in the game. action is JSON, e.g. {"type":"ROLL"}. {"type":"BOT_STEP"}
   * asks the server to make the current bot's next move (any human player may trigger it).
   */
  gameAction: a
    .mutation()
    .arguments({ gameId: a.string().required(), action: a.json().required() })
    .returns(a.ref("GameView"))
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated(), allow.guest()]),

  /**
   * Fires after any of the mutations above. Pass gameId to follow one game;
   * omit it (lobby) to receive updates for every public game.
   */
  onGameUpdated: a
    .subscription()
    .for([
      a.ref("createGame"),
      a.ref("joinGame"),
      a.ref("leaveGame"),
      a.ref("startGame"),
      a.ref("addBot"),
      a.ref("removeBot"),
      a.ref("chooseIcon"),
      a.ref("gameAction"),
    ])
    .arguments({ gameId: a.string() })
    .handler(a.handler.custom({ entry: "./onGameUpdated.js" }))
    // Guests can't use identity-pool auth on a custom-handler subscription, so they listen with the
    // public API key. Read-only, and the filter in onGameUpdated.js limits the lobby to public games.
    .authorization((allow) => [allow.authenticated(), allow.publicApiKey()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
    // Only used by guests' live updates. Keys last at most 365 days: redeploy (npm run deploy) within a year.
    apiKeyAuthorizationMode: { expiresInDays: 365 },
  },
});
