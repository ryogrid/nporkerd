# 01 — Architecture

## 1. System shape

nporkerd has exactly two deployable parts, both inside one Convex project:

```
┌──────────────────────────── Browser ────────────────────────────┐
│  SPA (React + TypeScript, built by Vite)                        │
│  - pages: register / login / lobby / room                       │
│  - Convex React client: useQuery / useMutation                  │
│  - Ed25519 signing (login challenge) via @noble/ed25519         │
└──────────────┬───────────────────────────────┬──────────────────┘
               │ HTTPS (assets)                │ WSS (reactive sync)
               ▼                               ▼
   https://<deployment>.convex.site   https://<deployment>.convex.cloud
   ┌──────────────────────── Convex deployment ────────────────────┐
   │  Static hosting component (@convex-dev/static-hosting)        │
   │    serves the built SPA from Convex file storage              │
   │  Functions (TypeScript, convex/ directory)                    │
   │    queries     – read-only, reactive, per-viewer projections  │
   │    mutations   – all writes; auth, rooms, game, chat          │
   │    actions     – none required for v1 gameplay (reserved)     │
   │    internal fns– turn timeouts, street advancement, cleanup   │
   │    scheduled   – ctx.scheduler.runAfter for game timers       │
   │    crons       – hourly/daily housekeeping                    │
   │  Database (document store)                                    │
   │    users / sessions / loginChallenges / rooms / seats /       │
   │    hands / chatMessages                                       │
   └───────────────────────────────────────────────────────────────┘
```

There is no other server, database, cache, or queue. Realtime behaviour comes
from Convex's reactive queries: when a mutation changes a document, every
client subscribed to a query that read it receives the new result over the
existing WebSocket. Poker turns, chat, and lobby updates therefore need **no**
hand-written socket code, polling, or pub/sub.

## 2. How each concern maps to Convex

| Concern | Convex mechanism | Notes |
| --- | --- | --- |
| Data storage | Document database + `convex/schema.ts` | Schema in [02-data-model.md](02-data-model.md) |
| Reads | Queries | Must be pure; results are cached and re-run automatically on data change |
| Writes / game actions | Mutations | Transactional, serialised per document set; OCC retries are automatic — mutations must be written so a retry is safe (see §5) |
| Timers (turn clock, street pacing, next-hand delay) | `ctx.scheduler.runAfter(...)` from inside mutations | Always guarded by `(handId, seq)`; see [04-game-engine.md](04-game-engine.md) §9 |
| Periodic cleanup | `convex/crons.ts` | Expired sessions/challenges, stale rooms |
| SPA delivery | `@convex-dev/static-hosting` component | Serves `dist/` from Convex file storage at `https://<deployment>.convex.site`, with SPA fallback to `index.html`; the component's CLI sets `VITE_CONVEX_URL` at build time |
| SPA ↔ API wiring | `VITE_CONVEX_URL` build-time constant | Value is the deployment's public `*.convex.cloud` URL — it is **not** a secret (see [03-auth.md](03-auth.md) §7) |
| Secrets | Convex environment variables + deploy keys | Only used for owner-side operations; the game itself needs no third-party secrets. See [09-deployment-and-operations.md](09-deployment-and-operations.md) |

Why the official static-hosting component rather than hand-written HTTP
actions: it provides content-hashed asset caching, SPA fallback, atomic
versioned uploads, and garbage collection of old deployments out of the box,
and its upload path is authenticated through the Convex CLI session (there is
no public upload endpoint to secure). Hand-rolled `httpAction` file serving
remains a documented fallback in [10-open-decisions.md](10-open-decisions.md)
(D-08).

## 3. Repository layout

```
nporkerd/
├─ package.json                 # scripts: dev, build, deploy, test (see 09)
├─ index.html                   # Vite entry
├─ vite.config.ts
├─ tsconfig.json
├─ src/                         # ── SPA ─────────────────────────────
│  ├─ main.tsx                  # ConvexReactClient setup, providers
│  ├─ App.tsx                   # route switching (register/login/lobby/room)
│  ├─ pages/
│  │  ├─ RegisterPage.tsx
│  │  ├─ LoginPage.tsx
│  │  ├─ LobbyPage.tsx
│  │  └─ RoomPage.tsx
│  ├─ components/
│  │  ├─ PokerTable.tsx         # felt, seats, board, pot
│  │  ├─ SeatView.tsx
│  │  ├─ CardView.tsx           # one card (face or back)
│  │  ├─ ActionBar.tsx          # fold/check/call/raise/all-in controls
│  │  ├─ ChatPanel.tsx
│  │  ├─ CreateRoomDialog.tsx
│  │  ├─ PrivateKeyDisplay.tsx  # registration key reveal + download
│  │  └─ BalanceBadge.tsx
│  └─ lib/
│     ├─ auth.tsx               # AuthProvider: session token, me query
│     ├─ keys.ts                # Ed25519 generate/sign wrappers (noble)
│     └─ format.ts              # chip amounts, card labels
├─ convex/                      # ── Backend (deployed by `npx convex dev/deploy`)
│  ├─ schema.ts                 # see 02
│  ├─ auth.ts                   # register / challenge / login / logout / me
│  ├─ users.ts                  # balance, faucet
│  ├─ rooms.ts                  # CRUD, join/leave, seats, host controls
│  ├─ game.ts                   # getTableState, startGame, act, timeouts
│  ├─ chat.ts                   # list / send
│  ├─ http.ts                   # static hosting routes only
│  ├─ crons.ts                  # cleanup jobs
│  ├─ _generated/               # produced by Convex codegen; committed
│  └─ lib/
│     ├─ session.ts             # requireSession(ctx, token) helper
│     ├─ errors.ts              # error codes used across functions
│     ├─ rng.ts                 # crypto RNG helpers (randomInt, shuffle)
│     └─ hash.ts                # SHA-256 helpers (tokens, passphrase)
│  └─ game/
│     ├─ cards.ts               # card encoding, deck construction
│     ├─ evaluator.ts           # 7-card hand evaluation (pure)
│     ├─ pots.ts                # side-pot construction & distribution (pure)
│     └─ engine.ts              # hand state machine / reducer (pure)
└─ design/                      # these documents
```

Unit tests for `convex/game/*` live next to the code as `*.test.ts` and run
with Vitest on the host machine; they must not import Convex runtime APIs
(that is what "pure" enforces).

## 4. Main flows

### 4.1 Registration and login (details in 03)

1. Browser generates an Ed25519 key pair **locally**. The private key never
   leaves the browser.
2. Browser calls `auth.register({ username, publicKey })`. The server stores
   the username and public key and grants the starting balance.
3. The browser shows the private key exactly once, with a mandatory
   download/copy step and a "this can never be shown again" warning.
4. Login: browser asks `auth.requestLoginChallenge({ username })`, signs the
   returned nonce with the pasted private key, and calls
   `auth.login({ username, challengeId, signature })`. The server verifies
   the signature against the stored public key and returns a session token;
   only the token's SHA-256 hash is stored server-side.

### 4.2 Playing a hand (details in 04, 05)

1. Host creates a room; others join (passphrase checked server-side for
   private rooms) and sit down, moving chips from balance to stack.
2. Host calls `game.startGame`. The server creates a `hands` document:
   shuffled deck (server-side, cryptographic RNG), hole cards, blinds posted.
   The deck and all hole cards exist **only** in that document.
3. Every client renders from `game.getTableState({ roomId, sessionToken })`,
   a query that projects the hand per viewer: your cards for you, card backs
   for others, nothing of the deck.
4. The player to act calls `game.act({ ..., action })`. The mutation loads
   the hand, runs the pure engine reducer, writes the new state, and (if
   needed) schedules the next timer — one transaction.
5. All subscribed clients re-render automatically.

### 4.3 Chat (details in 06)

`chat.sendMessage` (mutation) inserts a document; `chat.listMessages`
(query) returns the room's latest messages; reactivity delivers them to every
room member's screen.

## 5. Convex-specific rules the implementer must respect

1. **Mutations may be retried** by Convex's optimistic concurrency control.
   A mutation must therefore be written as a function of current database
   state ("reject if it is not this player's turn") rather than assuming it
   runs exactly once. Game mutations satisfy this naturally because the
   engine validates the action against the loaded state.
2. **Queries must not write** and must be deterministic. All projections in
   `getTableState` are pure functions of the loaded documents plus the
   viewer's identity.
3. **`Date.now()` and `Math.random()`** are available inside Convex
   functions, but dealing randomness must be cryptographic:
   use `crypto.getRandomValues` (available in the default Convex runtime)
   through `convex/lib/rng.ts`. Never shuffle with `Math.random()`.
4. **No field-level security exists.** Any document returned by a public
   function is public to its caller. The only defence is to not return it —
   hence principle 2 in [00-overview.md](00-overview.md) §4 and the
   review checklist in [TODO.md](TODO.md).
5. **Actions do not run in transactions.** v1 gameplay uses no actions at
   all. If a future feature needs an action (e.g. calling an external API),
   it must delegate every read/write to queries/mutations and re-validate
   state afterwards.
6. **Function arguments are public API surface.** Every public function takes
   `sessionToken` explicitly and calls `requireSession` first (except
   `auth.register`, `auth.requestLoginChallenge`, `auth.login`). There is no
   ambient identity because nporkerd does not use Convex Auth (see
   [03-auth.md](03-auth.md) §1 for why).
