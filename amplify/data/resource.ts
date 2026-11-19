import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { game } from "../functions/game/resource";

/**
 * Every read and write goes through the game Lambda, which owns a private
 * DynamoDB table and enforces the rules. Clients never write game data directly.
 */
const schema = a.schema({
  LobbyPlayer: a.customType({
    id: a.string().required(),
    name: a.string().required(),
    bot: a.boolean(),
  }),

  GameView: a.customType({
    gameId: a.string().required(),
    name: a.string().required(),
    /** WAITING | PLAYING | FINISHED | CLOSED (deleted: last player left the lobby) */
    status: a.string().required(),
    hostId: a.string().required(),
    maxPlayers: a.integer().required(),
    maxRounds: a.integer().required(),
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
    .authorization((allow) => [allow.authenticated()]),

  getGame: a
    .query()
    .arguments({ gameId: a.string().required() })
    .returns(a.ref("GameView"))
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated()]),

  createGame: a
    .mutation()
    .arguments({
      name: a.string().required(),
      maxPlayers: a.integer().required(),
      maxRounds: a.integer().required(),
    })
    .returns(a.ref("GameView"))
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated()]),

  joinGame: a
    .mutation()
    .arguments({ gameId: a.string().required() })
    .returns(a.ref("GameView"))
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated()]),

  leaveGame: a
    .mutation()
    .arguments({ gameId: a.string().required() })
    .returns(a.ref("GameView"))
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated()]),

  startGame: a
    .mutation()
    .arguments({ gameId: a.string().required() })
    .returns(a.ref("GameView"))
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated()]),

  /** Host only, while waiting: fill an open seat with a computer player. */
  addBot: a
    .mutation()
    .arguments({ gameId: a.string().required() })
    .returns(a.ref("GameView"))
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated()]),

  removeBot: a
    .mutation()
    .arguments({ gameId: a.string().required(), botId: a.string().required() })
    .returns(a.ref("GameView"))
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated()]),

  /**
   * A move in the game. action is JSON, e.g. {"type":"ROLL"}. {"type":"BOT_STEP"}
   * asks the server to make the current bot's next move (any human player may trigger it).
   */
  gameAction: a
    .mutation()
    .arguments({ gameId: a.string().required(), action: a.json().required() })
    .returns(a.ref("GameView"))
    .handler(a.handler.function(game))
    .authorization((allow) => [allow.authenticated()]),

  /**
   * Fires after any of the mutations above. Pass gameId to follow one game;
   * omit it (lobby) to receive every update.
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
      a.ref("gameAction"),
    ])
    .arguments({ gameId: a.string() })
    .handler(a.handler.custom({ entry: "./onGameUpdated.js" }))
    .authorization((allow) => [allow.authenticated()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
