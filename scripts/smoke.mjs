#!/usr/bin/env node
/**
 * End-to-end smoke test against the deployed backend (amplify_outputs.json):
 * two players sign in, create/join/start a game, play turns, and verify that
 * real-time subscription events arrive. Usage:
 *   SMOKE_A_EMAIL=.. SMOKE_B_EMAIL=.. SMOKE_PASSWORD=.. node scripts/smoke.mjs
 */
import { readFileSync } from "node:fs";
import { Amplify } from "aws-amplify";
import { fetchAuthSession, signIn, signOut } from "aws-amplify/auth";

// SMOKE_OUTPUTS=amplify_outputs.production.json targets production instead of the sandbox.
const outputs = JSON.parse(
  readFileSync(new URL(`../${process.env.SMOKE_OUTPUTS ?? "amplify_outputs.json"}`, import.meta.url), "utf8"),
);
Amplify.configure(outputs);
const endpoint = outputs.data.url;
const host = new URL(endpoint).host;

// isPrivate must be selected: the lobby feed only delivers events whose payload says isPrivate: false.
const FIELDS = "gameId name status hostId isPrivate maxPlayers maxRounds players { id name } version updatedAt state";

async function tokenFor(email) {
  await signOut().catch(() => {});
  const res = await signIn({ username: email, password: process.env.SMOKE_PASSWORD });
  if (!res.isSignedIn) throw new Error(`Sign-in incomplete for ${email}: ${res.nextStep.signInStep}`);
  const { tokens } = await fetchAuthSession();
  return { token: tokens.accessToken.toString(), sub: tokens.accessToken.payload.sub };
}

async function gql(user, query, variables = {}) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: user.token },
    body: JSON.stringify({ query, variables }),
  });
  const body = await r.json();
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join("; "));
  const value = Object.values(body.data)[0];
  if (!value || !value.state) return value;
  // AWSJSON may arrive double-encoded; same normalisation as lib/api.ts.
  let state = value.state;
  for (let i = 0; i < 2 && typeof state === "string"; i++) state = JSON.parse(state);
  return { ...value, state };
}

function subscribe(user, gameId, onEvent) {
  const url = endpoint.replace("https://", "wss://").replace("appsync-api", "appsync-realtime-api");
  const auth = { host, Authorization: user.token };
  const header = Buffer.from(JSON.stringify(auth)).toString("base64");
  const ws = new WebSocket(`${url}?header=${header}&payload=e30=`, ["graphql-ws"]);
  return new Promise((resolve, reject) => {
    ws.onopen = () => ws.send(JSON.stringify({ type: "connection_init" }));
    ws.onerror = (e) => reject(e);
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.type === "connection_ack") {
        const query = `subscription S($gameId: String) { onGameUpdated(gameId: $gameId) { ${FIELDS} } }`;
        ws.send(
          JSON.stringify({
            id: "1",
            type: "start",
            payload: {
              data: JSON.stringify({ query, variables: gameId ? { gameId } : {} }),
              extensions: { authorization: auth },
            },
          }),
        );
      } else if (msg.type === "start_ack") resolve(ws);
      else if (msg.type === "data") onEvent(msg.payload.data.onGameUpdated);
      else if (msg.type === "error") reject(new Error(JSON.stringify(msg.payload)));
    };
  });
}

const check = (cond, label) => {
  if (!cond) throw new Error(`FAILED: ${label}`);
  console.log(`  ok  ${label}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const A = await tokenFor(process.env.SMOKE_A_EMAIL);
const B = await tokenFor(process.env.SMOKE_B_EMAIL);
console.log("Signed in two players");

const lobbyEvents = [];
const lobbyWs = await subscribe(B, undefined, (g) => lobbyEvents.push(g));

const created = await gql(
  A,
  `mutation M($n: String!, $p: Int!, $r: Int!) { createGame(name: $n, maxPlayers: $p, maxRounds: $r) { ${FIELDS} } }`,
  { n: "Smoke test table", p: 2, r: 10 },
);
check(created.status === "WAITING" && created.players.length === 1, "A created a WAITING game");
const gameId = created.gameId;

const gameEvents = [];
const gameWs = await subscribe(A, gameId, (g) => gameEvents.push(g));
const otherWs = await subscribe(A, "not-this-game", (g) => gameEvents.push({ wrong: g }));

let rejected = false;
try {
  await gql(A, `mutation M($n: String!, $p: Int!, $r: Int!) { createGame(name: $n, maxPlayers: $p, maxRounds: $r) { gameId } }`, {
    n: "Second", p: 5, r: 10,
  });
} catch (e) {
  rejected = /Players must be/.test(e.message);
}
check(rejected, "5-player game is rejected");

const lobby = await gql(B, `query { listLobby { ${FIELDS} } }`);
check(lobby.some((g) => g.gameId === gameId), "B sees the table in the lobby");

let joined = await gql(B, `mutation M($g: String!) { joinGame(gameId: $g) { ${FIELDS} } }`, { g: gameId });
check(joined.players.length === 2, "B joined");

rejected = false;
try {
  await gql(B, `mutation M($g: String!) { startGame(gameId: $g) { gameId } }`, { g: gameId });
} catch (e) {
  rejected = /Only the host/.test(e.message);
}
check(rejected, "non-host can't start");

let game = await gql(A, `mutation M($g: String!) { startGame(gameId: $g) { ${FIELDS} } }`, { g: gameId });
check(game.status === "PLAYING" && game.state.phase === "ROLL", "host started the game");

const users = { [A.sub]: A, [B.sub]: B };
const act = (user, action) =>
  gql(user, `mutation M($g: String!, $a: AWSJSON!) { gameAction(gameId: $g, action: $a) { ${FIELDS} } }`, {
    g: gameId,
    a: JSON.stringify(action),
  });

const notCurrent = game.state.players[1 - game.state.current].id;
rejected = false;
try {
  await act(users[notCurrent], { type: "ROLL" });
} catch (e) {
  rejected = /not your turn/.test(e.message);
}
check(rejected, "out-of-turn roll is rejected");

let steps = 0;
while (game.status === "PLAYING" && steps < 40) {
  const s = game.state;
  const p = s.players[s.current];
  const me = users[p.id];
  const action =
    s.phase === "ROLL" ? { type: "ROLL" }
    : s.phase === "BUY" ? { type: "BUY" }
    : s.phase === "DEBT" ? { type: p.cash >= s.debt.amount ? "PAY_DEBT" : "BANKRUPT" }
    : { type: "END_TURN" };
  game = await act(me, action);
  steps++;
}
console.log(`  ..  played ${steps} actions, round ${game.state.round}; last log: ${game.state.log.at(-1).text}`);
check(steps > 5, "turns play through the API");
check(Object.keys(game.state.holdings).length > 0 || steps >= 40, "someone bought property");

// ---- trading between the two players (cash only if someone has no cards yet)
if (game.status === "PLAYING" && !game.state.paused) {
  const owned = (id) =>
    Object.entries(game.state.holdings)
      .filter(([sq, h]) => h.owner === id && !Object.values(game.state.holdings).some((x) => x.level > 0))
      .map(([sq]) => Number(sq));
  const aCards = owned(A.sub);
  const bCards = owned(B.sub);
  const give = { squares: aCards.slice(0, 1), cash: aCards.length ? 0 : 10 };
  const get = { squares: bCards.slice(0, 1), cash: bCards.length ? 0 : 10 };
  const aCash = game.state.players.find((p) => p.id === A.sub).cash;
  if (aCash >= give.cash) {
    game = await act(A, { type: "PROPOSE_TRADE", to: B.sub, give, get });
    const trade = game.state.trades?.find((t) => t.from === A.sub && t.to === B.sub);
    check(!!trade, `A offered B a trade (${JSON.stringify(give)} for ${JSON.stringify(get)})`);
    rejected = false;
    try { await act(A, { type: "ACCEPT_TRADE", id: trade.id }); } catch (e) { rejected = /isn't for you/.test(e.message); }
    check(rejected, "you can't accept your own offer");
    game = await act(B, { type: "ACCEPT_TRADE", id: trade.id });
    const ok =
      give.squares.every((sq) => game.state.holdings[sq].owner === B.sub) &&
      get.squares.every((sq) => game.state.holdings[sq].owner === A.sub) &&
      !(game.state.trades ?? []).length;
    check(ok, "B accepted (out of turn) and the cards/cash changed hands");
  }
}

const left = await gql(A, `mutation M($g: String!) { leaveGame(gameId: $g) { ${FIELDS} } }`, { g: gameId });
check(left.status === "FINISHED" && left.state.winner === B.sub, "A forfeits, B wins, game FINISHED");

await sleep(2000);
check(gameEvents.filter((e) => !e.wrong).length >= steps, `game subscription got ${gameEvents.length} events`);
check(gameEvents.every((e) => !e.wrong && e.gameId === gameId), "gameId filter delivers only this game");
check(lobbyEvents.some((e) => e.gameId === gameId && e.status === "WAITING"), `lobby subscription got ${lobbyEvents.length} events`);

// ---- bots
console.log("Bots");
const FIELDS_B = FIELDS.replace("players { id name }", "players { id name bot }");
const botGame = await gql(
  A,
  `mutation M($n: String!, $p: Int!, $r: Int!) { createGame(name: $n, maxPlayers: $p, maxRounds: $r) { ${FIELDS_B} } }`,
  { n: "Bot table", p: 3, r: 10 },
);
const bg = botGame.gameId;
const addBot = (u) => gql(u, `mutation M($g: String!) { addBot(gameId: $g) { ${FIELDS_B} } }`, { g: bg });
let withBots = await addBot(A);
withBots = await addBot(A);
check(withBots.players.filter((p) => p.bot).length === 2, `host added 2 bots (${withBots.players.map((p) => p.name).join(", ")})`);
rejected = false;
try { await addBot(A); } catch (e) { rejected = /full/.test(e.message); }
check(rejected, "can't add a bot to a full table");
rejected = false;
try { await addBot(B); } catch (e) { rejected = /Only the host/.test(e.message); }
check(rejected, "non-host can't add bots");
const botId = withBots.players.find((p) => p.bot).id;
withBots = await gql(A, `mutation M($g: String!, $b: String!) { removeBot(gameId: $g, botId: $b) { ${FIELDS_B} } }`, { g: bg, b: botId });
check(withBots.players.length === 2, "host removed a bot");

game = await gql(A, `mutation M($g: String!) { startGame(gameId: $g) { ${FIELDS} } }`, { g: bg });
check(game.status === "PLAYING", "game with a bot started");
const actIn = (user, action) =>
  gql(user, `mutation M($g: String!, $a: AWSJSON!) { gameAction(gameId: $g, action: $a) { ${FIELDS} } }`, {
    g: bg,
    a: JSON.stringify(action),
  });
let botSteps = 0;
steps = 0;
while (game.status === "PLAYING" && steps < 80) {
  const s = game.state;
  const p = s.players[s.current];
  if (p.bot) {
    game = await actIn(A, { type: "BOT_STEP" });
    botSteps++;
  } else {
    const action =
      s.phase === "ROLL" ? { type: "ROLL" }
      : s.phase === "BUY" ? { type: "DECLINE" }
      : s.phase === "DEBT" ? { type: p.cash >= s.debt.amount ? "PAY_DEBT" : "BANKRUPT" }
      : { type: "END_TURN" };
    game = await actIn(A, action);
  }
  steps++;
}
const botName = game.state.players.find((p) => p.bot).name;
console.log(`  ..  ${steps} actions (${botSteps} bot steps), round ${game.state.round}`);
check(botSteps > 3 && game.state.log.some((l) => l.text.startsWith(botName)), `${botName} played moves`);
rejected = false;
if (game.status === "PLAYING" && !game.state.players[game.state.current].bot) {
  try { await actIn(A, { type: "BOT_STEP" }); } catch (e) { rejected = /not a bot's turn/.test(e.message); }
  check(rejected, "BOT_STEP rejected on a human's turn");
}
if (game.status === "PLAYING") {
  const end = await gql(A, `mutation M($g: String!) { leaveGame(gameId: $g) { ${FIELDS} } }`, { g: bg });
  check(end.status === "CLOSED", "last human forfeiting closes a bots-only table");
}

// A game in progress whose only human forfeits is closed and deleted, not left FINISHED.
const solo = await gql(
  A,
  `mutation M($n: String!, $p: Int!, $r: Int!) { createGame(name: $n, maxPlayers: $p, maxRounds: $r) { gameId } }`,
  { n: "Solo vs bot", p: 2, r: 10 },
);
await gql(A, `mutation M($g: String!) { addBot(gameId: $g) { gameId } }`, { g: solo.gameId });
await gql(A, `mutation M($g: String!) { startGame(gameId: $g) { gameId } }`, { g: solo.gameId });
const forfeited = await gql(A, `mutation M($g: String!) { leaveGame(gameId: $g) { ${FIELDS} } }`, { g: solo.gameId });
check(forfeited.status === "CLOSED", "forfeiting against only bots closes the table");
rejected = false;
try { await gql(A, `query Q($g: String!) { getGame(gameId: $g) { gameId } }`, { g: solo.gameId }); } catch (e) { rejected = /not found/.test(e.message); }
check(rejected, "closed table is deleted");
const lobbyAfter = await gql(A, `query { listLobby { gameId } }`);
check(!lobbyAfter.some((g) => g.gameId === solo.gameId), "closed table is gone from the lobby");

// ---- no round limit, pause/resume, and leaving a finished game
console.log("Pause, no round limit, leaving");
const open = await gql(
  A,
  `mutation M($n: String!, $p: Int!, $r: Int!) { createGame(name: $n, maxPlayers: $p, maxRounds: $r) { ${FIELDS} } }`,
  { n: "Endless table", p: 2, r: 0 },
);
check(open.maxRounds === 0, "a table with no round limit can be created");
await gql(B, `mutation M($g: String!) { joinGame(gameId: $g) { gameId } }`, { g: open.gameId });
let pg = await gql(A, `mutation M($g: String!) { startGame(gameId: $g) { ${FIELDS} } }`, { g: open.gameId });
const actOn = (user, action) =>
  gql(user, `mutation M($g: String!, $a: AWSJSON!) { gameAction(gameId: $g, action: $a) { ${FIELDS} } }`, {
    g: open.gameId,
    a: JSON.stringify(action),
  });
const whoseTurn = users[pg.state.players[pg.state.current].id];
const other = whoseTurn === A ? B : A;
pg = await actOn(other, { type: "PAUSE" });
check(pg.state.paused?.by === other.sub, "any player can pause, even when it's not their turn");
rejected = false;
try { await actOn(whoseTurn, { type: "ROLL" }); } catch (e) { rejected = /paused/.test(e.message); }
check(rejected, "no moves while paused");
pg = await actOn(whoseTurn, { type: "RESUME" });
check(!pg.state.paused, "another player resumed it");
pg = await actOn(whoseTurn, { type: "ROLL" });
check(pg.state.rollSeq === 1, "play continues after resuming");

const left1 = await gql(A, `mutation M($g: String!) { leaveGame(gameId: $g) { ${FIELDS} } }`, { g: open.gameId });
check(left1.status === "FINISHED" && !left1.players.some((p) => p.id === A.sub), "leaving mid-game forfeits and takes you off the table");
const lobbyA = await gql(A, `query { listLobby { gameId } }`);
check(!lobbyA.some((g) => g.gameId === open.gameId), "the game is gone from the leaver's lobby");
const left2 = await gql(B, `mutation M($g: String!) { leaveGame(gameId: $g) { ${FIELDS} } }`, { g: open.gameId });
check(left2.status === "CLOSED", "the last player leaving a finished game closes the table");
rejected = false;
try { await gql(B, `query Q($g: String!) { getGame(gameId: $g) { gameId } }`, { g: open.gameId }); } catch (e) { rejected = /not found/.test(e.message); }
check(rejected, "closed finished table is deleted");

for (const ws of [lobbyWs, gameWs, otherWs]) ws.close();
await signOut();
console.log("\nSMOKE TEST PASSED");
process.exit(0);
