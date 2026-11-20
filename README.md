# Rent Rush

A fast, real-time property-trading board game for 2-4 signed-in players. Inspired by classic
property games, with its own board and a set of rule twists (see below).

## How it works

```
Browser (Next.js static export)
  │  sign-in: Amazon Cognito (email + password, public player name)
  ▼
AWS AppSync (GraphQL, user-pool auth)
  │  queries/mutations: listLobby, getGame, createGame, joinGame, leaveGame, startGame, gameAction
  │  subscription:      onGameUpdated(gameId?)  ← fires after every mutation (real-time lobby + board)
  ▼
Lambda "rent-rush-game"  ── runs game/engine.ts (all rules are enforced server-side)
  ▼
DynamoDB GamesTable (private; GSI byStatus for the lobby; TTL cleans up old games)
```

- `game/board.ts`, `game/engine.ts`: the board and the pure rules engine, shared by Lambda and UI.
- `amplify/`: Amplify Gen2 backend (auth, data schema, the game Lambda, the table).
- `app/`, `components/`, `lib/`: the web app (lobby, waiting room, board).

Writes use optimistic concurrency (a `version` check), so double-clicks or two players acting at
once can't corrupt a game.

## Run it locally

Requires Node 24+ and the `aws-project` AWS CLI profile (`aws login --profile aws-project`).

```bash
npm install
npm run sandbox:once   # deploys your personal backend (us-east-2) and writes amplify_outputs.json
npm run dev            # http://localhost:3000
npm test               # rules engine tests
npm run typecheck
```

To play multiplayer locally, open a second browser (or a private window) and sign up as another player.

## Deploy (production)

Live at **https://rent-rush-715.netlify.app**. Production uses its own backend (Amplify app
`rent-rush`, branch `main`, us-east-2), separate from your sandbox.

```bash
npm run deploy                    # production backend (ampx pipeline-deploy) + build + Netlify
npm run deploy -- --skip-backend  # frontend only
```

Deploys run from your machine (the AWS project blocks GitHub OIDC, and no long-lived AWS keys
are stored in GitHub). The script builds against `amplify_outputs.production.json` and restores
your sandbox `amplify_outputs.json` afterwards. Needs `aws login --profile aws-project` and the
Netlify CLI logged in; the folder is linked to the `rent-rush-715` site. Security headers (CSP
etc.) are in `netlify.toml`.

## Board art

All board graphics (squares, centre, background, tokens, dice, Fortune card) are replaceable JPGs
in `public/board/`. See [BOARD-ART.md](BOARD-ART.md) and preview them at `/art-preview`.

Sound effects are in `public/sound/` (`dice.wav` when dice are rolled, `piece-move.wav` for every
square a piece moves). Replace them with files of the same name; players can mute with 🔊 in the game.

## Guests, private tables and invite links

- **Guests** play without an account: they pick a name on the sign-in screen and use the
  browser's anonymous Cognito identity (identity pool, IAM auth). The server knows them as
  `guest:<identity id>`; their name is cleaned up and can't pose as a bot. Guest identities
  live in that browser. Live updates for guests use the API's public API key (Amplify doesn't
  allow identity-pool auth on the custom subscription); it expires after 365 days, so
  **redeploy (`npm run deploy`) at least once a year**.
- **Private tables** aren't listed in the lobby (nor in its live updates); everyone else is
  unaffected. Every waiting table shows an **invite link** (`/#game=<id>`): opening it lets
  someone sign in or play as a guest and lands them on the table. The id is a random UUID.
- `scripts/guest-smoke.mjs` tests guests, private tables and invite links end to end.

## Bots

In the waiting room, the host can click an **Open seat** to fill it with a bot (and remove it with ×).
A table needs at least one human. The server chooses every bot move (`chooseBotAction` in
`game/engine.ts`): it keeps a cash reserve, buys what it can afford, completes districts, upgrades
when it has spare cash, and sells assets to clear debts. The browsers of human players only
*trigger* bot moves (`gameAction` with `{"type":"BOT_STEP"}`), one step at a time so everyone can
watch: the first active human drives, and the others take over after a few seconds if that
browser goes quiet. If the last human leaves (forfeits), the table is closed and deleted. If the
last human goes bankrupt, the game ends and the richest remaining player wins.

Remove the sandbox backend when you're done: `npm run sandbox:delete`.

## Rules: what's different

| Classic property game | Rent Rush |
| --- | --- |
| 40 squares, play until everyone else is broke | 24 squares, round limit (10/20/30); highest net worth wins, or the last player standing |
| $200 for passing Go | $200 for passing Start, **$400 for landing exactly on it** |
| Taxes go to the bank | Taxes, fines and bail feed a **Jackpot**; land on **Rest Stop** to win it |
| Unbought property is auctioned | No auctions: declined property stays unowned |
| Mortgages | **Sell back** to the bank for 50% (upgrades too) |
| Houses and hotels | Up to 3 **upgrade levels** per street (rent ×3 / ×6 / ×10) once you own the district |
| — | **Home turf**: landing on your own street pays you $20 |
| Jail | **Holding Cell**: roll doubles, pay $50, or use a Walk Free card; forced bail after 3 tries |

Other rules: districts have two streets (owning both doubles bare rent), stations charge
$25/$50/$100 for owning 1/2/3, and three doubles in a row sends you to the Holding Cell. If you
can't pay, you can sell assets or declare bankruptcy (your cash goes to the creditor; your
properties return to the bank). Other players can skip someone who has been idle for 2 minutes.
