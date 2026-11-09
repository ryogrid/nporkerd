# nporkerd

Online multiplayer Texas Hold'em (no-limit, play-money chips) that runs entirely in the browser.
Open a table, share the link, and play live with friends.

**Live:** https://merry-butterfly-152.convex.site

The whole backend is [Convex](https://www.convex.dev/): database, server functions, realtime sync,
scheduled timers, and hosting for the single-page app. There is no other server.

## Features

- **No-limit hold'em, 2–9 seats.** Blinds, side pots, all-in runouts, a turn clock, and an automatic next hand.
- **Lobby and private tables.** Public tables are listed in the lobby. Private tables need a passphrase.
  Opening a public table link makes you a spectator, and you click an empty chair to sit.
- **Host controls.** The host can start the game, end it, or close the table. Ending mid-hand finishes the current hand first.
  A table that stopped because too few players were left starts again by itself once two players are seated.
- **Table chat**, live, in every room.
- **Play-money bankroll.** Every account starts with 10,000 chips. Buy-in and top-up come from the bankroll,
  and a daily faucet helps players who are broke.
- **Passwordless accounts.** Your account is an Ed25519 keypair made in the browser. The private key never leaves it,
  and login is a signed challenge. There is no email and no password.
- **Casino-style UI.** Cards, chips, and the felt are drawn in CSS. Your seat is always at the bottom, and the layout works on phones.
- **Synthesized sound.** WebAudio cues for dealing, bets, your turn, the last seconds of the clock, and wins,
  with a mute switch and a volume slider. There are no audio files.
- **Keyboard shortcuts.** `F` fold, `C` check or call, `R` raise, `Shift+A` all-in.
- **Beginner guidance.** Every screen has a "What to do now" banner, and the control to press pulses. Your current best hand shows under your cards.
- **Help page** (`/help`) with screenshots, opened from the top bar in a new tab.
- **English and Japanese.** Switch with the EN / 日本語 toggle in the top bar. English is the default.

## Fair play and security

- The deck is shuffled with a cryptographic RNG on the server.
- Hole cards and the deck live in a server-only table. No query ever returns it. Each viewer gets their own
  projection of the table, which shows hidden cards only once they are revealed at showdown.
  A test sweep (`convex/security.test.ts`) checks this.
- Only a SHA-256 hash of each session token is stored.

## Tech stack

| Layer | Technology |
| --- | --- |
| Client | React 19, Vite, TypeScript, plain CSS |
| Backend | Convex queries, mutations, scheduler, and crons |
| Hosting | [`@convex-dev/static-hosting`](https://www.npmjs.com/package/@convex-dev/static-hosting) |
| Crypto | `@noble/ed25519`, `@noble/hashes` |
| Tests | Vitest and `convex-test` |

## Getting started

Requirements: Node.js 20+ and a Convex account.

```bash
npm install
npm run dev:convex   # runs `npx convex dev`: links or creates a dev deployment, pushes functions, writes .env.local
npm run dev          # Vite on http://localhost:5173 (in a second terminal)
```

Open http://localhost:5173, create an account, and open a table. To play against yourself, use a second
browser profile or a private window.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 (needs `CONVEX_URL` in `.env.local`) |
| `npm run dev:convex` | `npx convex dev`, which watches `convex/` and pushes to your dev deployment |
| `npm run typecheck` | Type-checks the SPA and the `convex/` functions |
| `npm test` | Runs every test once (the engine, the Convex functions, and the security sweep) |
| `npm run build` | Production build of the SPA into `dist/` |
| `npm run deploy` | Builds the SPA, deploys the Convex functions to production, and uploads `dist/` |

## Deploying to production

```bash
npm run deploy
```

The command builds the SPA against the production Convex URL, runs `convex deploy`, and uploads the build.
The app is then served at `https://<your-prod-deployment>.convex.site`.

`npm run deploy` asks for confirmation, so it fails in a non-interactive shell such as CI.
Run the two steps yourself there:

```bash
npx convex deploy -y
npx @convex-dev/static-hosting deploy --skip-convex
```

## Project layout

```
convex/            backend (Convex functions)
  game/            pure poker engine: cards, hand evaluator, side pots, hand state machine (no Convex imports)
  game.ts          Convex wrapper around the engine: actions, timers, per-viewer table state
  rooms.ts         lobby, seating, host controls, buy-in and top-up
  auth.ts          keypair registration, challenge login, sessions
  users.ts         bankroll, faucet, presence heartbeat
  chat.ts          table chat
  crons.ts         hourly cleanup
  lib/             constants, error codes, session checks, RNG, hashing
src/               React SPA
  pages/           home, register, login, lobby, room
  components/      poker table, action bar, cards, chips, chat, sounds
  lib/             session, router, toasts, synthesized sound, formatting
  i18n/            English/Japanese messages per area, Help page content
public/help-img/   Help page screenshots (en, ja)
design/            design documents (overview, data model, auth, engine, API, operations, TODO)
```

The full design is in [`design/`](design/README.md). Start with [`design/00-overview.md`](design/00-overview.md).

## License

[MIT](LICENSE)
