#!/usr/bin/env node
/**
 * End-to-end test of guest play and private tables against the deployed backend
 * (amplify_outputs.json, or SMOKE_OUTPUTS=...). A guest (anonymous identity, no
 * account) plays with a signed-in player. Usage:
 *   SMOKE_B_EMAIL=.. SMOKE_PASSWORD=.. node scripts/guest-smoke.mjs
 */
import { readFileSync } from "node:fs";
import { Amplify } from "aws-amplify";
import { fetchAuthSession, signIn, signOut } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/data";

const outputs = JSON.parse(
  readFileSync(new URL(`../${process.env.SMOKE_OUTPUTS ?? "amplify_outputs.json"}`, import.meta.url), "utf8"),
);
Amplify.configure(outputs);
const client = generateClient();
const endpoint = outputs.data.url;
const host = new URL(endpoint).host;

const FIELDS = "gameId name status hostId isPrivate maxPlayers maxRounds players { id name bot guest } version updatedAt state";

const check = (cond, label) => {
  if (!cond) throw new Error(`FAILED: ${label}`);
  console.log(`  ok  ${label}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const parse = (v) => {
  if (!v?.state) return v;
  let state = v.state;
  for (let i = 0; i < 2 && typeof state === "string"; i++) state = JSON.parse(state);
  return { ...v, state };
};

// ---- the guest: Amplify client with identity-pool (IAM) auth, no sign-in
async function asGuest(query, variables = {}) {
  const res = await client.graphql({ query, variables, authMode: "identityPool" });
  return parse(Object.values(res.data)[0]);
}
function guestListen(gameId, onEvent) {
  const query = `subscription S($gameId: String) { onGameUpdated(gameId: $gameId) { ${FIELDS} } }`;
  const sub = client.graphql({ query, variables: gameId ? { gameId } : {}, authMode: "apiKey" }).subscribe({
    next: ({ data }) => onEvent(parse(data.onGameUpdated)),
    error: (e) => console.log("  !!  guest subscription error", JSON.stringify(e).slice(0, 300)),
  });
  return () => sub.unsubscribe();
}

// ---- the signed-in player: plain HTTPS + WebSocket with a user-pool token
let B;
async function asUser(query, variables = {}) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: B.token },
    body: JSON.stringify({ query, variables }),
  });
  const body = await r.json();
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join("; "));
  return parse(Object.values(body.data)[0]);
}
function userListen(gameId, onEvent) {
  const url = endpoint.replace("https://", "wss://").replace("appsync-api", "appsync-realtime-api");
  const auth = { host, Authorization: B.token };
  const header = Buffer.from(JSON.stringify(auth)).toString("base64");
  const ws = new WebSocket(`${url}?header=${header}&payload=e30=`, ["graphql-ws"]);
  return new Promise((resolve, reject) => {
    ws.onopen = () => ws.send(JSON.stringify({ type: "connection_init" }));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.type === "connection_ack") {
        const query = `subscription S($gameId: String) { onGameUpdated(gameId: $gameId) { ${FIELDS} } }`;
        ws.send(JSON.stringify({ id: "1", type: "start", payload: { data: JSON.stringify({ query, variables: gameId ? { gameId } : {} }), extensions: { authorization: auth } } }));
      } else if (msg.type === "start_ack") resolve(ws);
      else if (msg.type === "data") onEvent(parse(msg.payload.data.onGameUpdated));
      else if (msg.type === "error") reject(new Error(JSON.stringify(msg.payload)));
    };
  });
}

// Sign B in, keep the token, then sign out so the Amplify client is a guest again.
await signOut().catch(() => {});
await signIn({ username: process.env.SMOKE_B_EMAIL, password: process.env.SMOKE_PASSWORD });
{
  const { tokens } = await fetchAuthSession();
  B = { token: tokens.accessToken.toString(), sub: tokens.accessToken.payload.sub };
}
await signOut();
const guestSession = await fetchAuthSession();
check(!!guestSession.identityId && !guestSession.tokens, "guest has an anonymous identity and no account");
const guestId = `guest:${guestSession.identityId}`;

console.log("Guest play");
const userLobby = [];
const userLobbyWs = await userListen(undefined, (g) => userLobby.push(g));
const guestLobby = [];
const stopGuestLobby = guestListen(undefined, (g) => guestLobby.push(g));
await sleep(1500);

const priv = await asGuest(
  `mutation M($n: String!, $p: Int!, $r: Int!, $pn: String, $pv: Boolean) { createGame(name: $n, maxPlayers: $p, maxRounds: $r, playerName: $pn, isPrivate: $pv) { ${FIELDS} } }`,
  { n: "Guest private table", p: 3, r: 10, pn: "  Tess \u0007 the   Tester  ", pv: true },
);
check(priv.isPrivate === true && priv.hostId === guestId, "guest created a private table and is its host");
check(priv.players[0].guest === true && priv.players[0].name === "Tess the Tester", `guest name cleaned up ("${priv.players[0].name}")`);

const lobbyForB = await asUser(`query { listLobby { gameId } }`);
check(!lobbyForB.some((g) => g.gameId === priv.gameId), "private table is not in other players' lobby");
const lobbyForGuest = await asGuest(`query { listLobby { gameId isPrivate } }`);
check(lobbyForGuest.some((g) => g.gameId === priv.gameId), "private table is in its own player's lobby");

const guestGame = [];
const stopGuestGame = guestListen(priv.gameId, (g) => guestGame.push(g));
await sleep(1500);

// B opens the invite link: knowing the id is enough to see and join the table.
const seen = await asUser(`query Q($g: String!) { getGame(gameId: $g) { ${FIELDS} } }`, { g: priv.gameId });
check(seen.gameId === priv.gameId && seen.status === "WAITING", "invite link: signed-in player can open the private table");
const joined = await asUser(`mutation M($g: String!) { joinGame(gameId: $g) { ${FIELDS} } }`, { g: priv.gameId });
check(joined.players.length === 2 && joined.players[1].id === B.sub && !joined.players[1].guest, "signed-in player joined with the link");

let rejected = false;
try {
  await asUser(`mutation M($g: String!) { addBot(gameId: $g) { gameId } }`, { g: priv.gameId });
} catch (e) {
  rejected = /Only the host/.test(e.message);
}
check(rejected, "non-host can't add bots to a guest's table");
const withBot = await asGuest(`mutation M($g: String!) { addBot(gameId: $g) { ${FIELDS} } }`, { g: priv.gameId });
check(withBot.players.length === 3 && withBot.players[2].bot, "guest host added a bot");

let game = await asGuest(`mutation M($g: String!) { startGame(gameId: $g) { ${FIELDS} } }`, { g: priv.gameId });
check(game.status === "PLAYING", "guest host started the game");

const actors = { [guestId]: "guest", [B.sub]: "user" };
let steps = 0;
let guestMoves = 0;
while (game.status === "PLAYING" && steps < 30) {
  const s = game.state;
  const p = s.players[s.current];
  const action = p.bot
    ? { type: "BOT_STEP" }
    : s.phase === "ROLL" ? { type: "ROLL" }
    : s.phase === "BUY" ? { type: "DECLINE" }
    : s.phase === "DEBT" ? { type: p.cash >= s.debt.amount ? "PAY_DEBT" : "BANKRUPT" }
    : { type: "END_TURN" };
  const who = p.bot ? "guest" : actors[p.id];
  const q = `mutation M($g: String!, $a: AWSJSON!) { gameAction(gameId: $g, action: $a) { ${FIELDS} } }`;
  const vars = { g: priv.gameId, a: JSON.stringify(action) };
  game = who === "guest" ? await asGuest(q, vars) : await asUser(q, vars);
  if (who === "guest" && !p.bot) guestMoves++;
  steps++;
}
check(guestMoves > 2, `guest played turns (${guestMoves} guest moves, ${steps} actions)`);

await sleep(2000);
check(guestGame.length >= steps, `guest's live updates for the table arrived (${guestGame.length} events)`);
check(!userLobby.some((g) => g.gameId === priv.gameId), "lobby live updates never revealed the private table");

// A public table: everyone's lobby feed sees it, including guests'.
const pub = await asUser(
  `mutation M($n: String!, $p: Int!, $r: Int!) { createGame(name: $n, maxPlayers: $p, maxRounds: $r) { ${FIELDS} } }`,
  { n: "Public smoke table", p: 2, r: 10 },
);
check(pub.isPrivate === false, "tables are public by default");
await sleep(2000);
check(userLobby.some((g) => g.gameId === pub.gameId), "public table appears in the lobby feed");
check(guestLobby.some((g) => g.gameId === pub.gameId), "guest's lobby feed (API key) sees the public table");
check(!guestLobby.some((g) => g.gameId === priv.gameId), "guest's lobby feed never shows private tables");

const guestJoin = await asGuest(`mutation M($g: String!, $pn: String) { joinGame(gameId: $g, playerName: $pn) { ${FIELDS} } }`, {
  g: pub.gameId,
  pn: "Bot Sneaky",
});
check(guestJoin.players[1].name === "Guest", `a guest can't pose as a bot ("Bot Sneaky" became "${guestJoin.players[1].name}")`);

// Clean up: leave both tables (closes them).
if (game.status === "PLAYING") await asGuest(`mutation M($g: String!) { leaveGame(gameId: $g) { gameId } }`, { g: priv.gameId });
await asUser(`mutation M($g: String!) { leaveGame(gameId: $g) { gameId } }`, { g: pub.gameId });
await asGuest(`mutation M($g: String!) { leaveGame(gameId: $g) { gameId } }`, { g: pub.gameId });

stopGuestLobby();
stopGuestGame();
userLobbyWs.close();
console.log("\nGUEST SMOKE TEST PASSED");
console.log(`(guest id ${guestId}; tables ${priv.gameId}, ${pub.gameId})`);
process.exit(0);
