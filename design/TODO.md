# nporkerd — Implementation TODO

Task breakdown for building nporkerd from the design in this directory.
Work top to bottom: phases are ordered so each one leaves the app runnable.
References like `04 §7` point at sections of the design documents.

Conventions: `[ ]` = not done, `[x]` = done. "Acceptance" notes say how to
know a task is finished. Estimated sizes: S ≤ half a day, M ≈ 1–2 days,
L ≈ several days.

---

## Phase 0 — Project setup

- [x] Initialise the Vite + React + TypeScript app (`npm create vite@latest`, react-ts template); add `convex`, `@noble/ed25519`, and dev deps (`vitest`). (S) — scaffolded by hand (same layout as the vite react-ts template); pinned world versions: convex 1.49.0, vite 8.3.6, vitest 5.1.0, react 19.3.1, typescript 5.9.3 (vitest peer caps TS <6), @vitejs/plugin-react 6.2.1, @noble/ed25519 3.2.0 + @noble/hashes 2.4.0, convex-test 0.0.67.
- [x] Owner steps from `09 §2`: Convex account, `npx convex dev` linked, `.env.local` created and gitignored. (S) — account already linked by owner (`CONVEX_DEPLOYMENT` in gitignored `.env.local`); `convex dev` deliberately NOT run here: no-deploy constraint; validated equivalently with `tsc -p convex` + `npm test`.
- [x] Add `convex.json`-era defaults via `npx convex dev`; commit the generated `convex/_generated/` skeleton. (S) — skeleton committed (from initial repo state); N/A note: modern Convex 1.49 uses `convex.config.ts`, and `convex/convex.config.ts` already registers `@convex-dev/static-hosting` at `/` with app httpPrefix `/api`, so no `convex/http.ts` is needed (deviation from `08 §6`, recorded).
- [x] npm scripts: `dev` (Vite), `dev:convex` (`convex dev`), `build`, `test` (Vitest), `deploy` (see Phase 9). (S) — plus `typecheck`; `dev:convex` kept for owner only, never run by the agent.
- [ ] CI (optional): GitHub Actions running `npm test` + `tsc --noEmit` on push. No deploy from CI in v1. (S) — skipped (optional; revisit in Phase 8).
- Acceptance: `npm run dev` + `npx convex dev` run side by side; the default Convex demo query renders in the SPA. → Adapted: no-deploy constraint; verified instead with `npm run typecheck` (frontend + convex projects), `vite build` ✓, vitest runner ✓.

## Phase 1 — Schema and shared backend helpers

- [x] `convex/schema.ts`: all tables/fields/indexes from `02` (users, sessions, loginChallenges, rooms, seats, hands, chatMessages). Note `loginChallenges.userId` is `optional` per `03 §4.3`. (M) — done; world validator surface is `v.id("table")` / `v.optional` / `v.union(v.literal(...))` (no `v.Identity`); `convex/_generated/dataModel.d.ts` hand-written in the demo project's schema-aware codegen format so `convex dev` regenerates identically.
- [x] `convex/lib/constants.ts` with every constant from `02 §8`. (S) — done (+ a few clearly-marked extras used by helpers).
- [x] `convex/lib/hash.ts`: `sha256Hex` via WebCrypto. Unit test with known vectors. (S) — done; SHA-256 vectors for "", "abc", pangram verified.
- [x] `convex/lib/rng.ts`: `randomInt(maxExclusive)` using `crypto.getRandomValues` with rejection sampling; `shuffleInPlace`. Statistical smoke test (uniformity over 6 buckets). (S) — done; `shuffleInPlace(items, random?)` takes an injectable source; tests cover arg validation, range, totality of rejection sampling, permutation, known-source permutations.
- [x] `convex/lib/session.ts`: `requireSession(ctx, token)` per `03 §5`; error code constants in `convex/lib/errors.ts` covering the full list in `08 §9`. (S) — done; all 25 codes in `errors.ts` with `fail(code, data?)` throwing `ConvexError({code,data})`; session test via convex-test (`convex/session.test.ts`) asserts UNAUTHENTICATED payload code, expiry rejection, and that no stored session doc contains the raw token.
- [x] Wire `@noble/ed25519` sync SHA-512 (`ed.etc.sha512Sync`) in one shared module used by both client and server code. (S) — done, world-API deviation: `@noble/ed25519@3.2.0` wires via `ed.hashes.sha512 = sha512` (from `@noble/hashes/sha2.js`), not `ed.etc.sha512Sync`; `convex/lib/ed5519.ts` performs the wiring at import time and exposes key/sign/verify helpers; round-trip + tamper tests green.
- Acceptance: schema deploys to dev (`npx convex dev` shows no validation errors); helper tests pass. → Adapted (no-deploy constraint): `npm run typecheck` green for both TS projects (typechecks `convex/` against the schema-aware data model) and `npm test` 31/31 passing across 5 test files.

## Phase 2 — Authentication (`03`, `08 §1–2`)

- [x] `auth.register`: username format validation, public-key length check, uniqueness via `by_usernameLower`, insert with `STARTING_BALANCE`. (S) — done; errors `INVALID_USERNAME` / `INVALID_PUBLIC_KEY` / `USERNAME_TAKEN` per 08 §1.
- [x] `auth.requestLoginChallenge`: mint/replace challenge, 5-min TTL, anti-enumeration behaviour (`03 §4.3`), 5-second re-issue rule. (S) — done; unknown usernames get a "phantom" challenge bound to no user (indistinguishable shape); re-issue <5 s returns the SAME challenge; a fresh request past the window deletes the unconsumed predecessor.
- [x] `auth.login`: verify signature over `nporkerd-login:<challengeId>:<nonce>`, attempts counter (invalidate at 5), single-use delete, create session storing only `SHA-256(token)`. (M) — done. Platform-semantics deviation (recorded): a Convex mutation that THROWS rolls back its DB effects, but `03 §4.3` requires the attempt-counter bump to persist — so `login` RETURNS a tagged result `{ ok, code?, sessionToken?, user? }` on rejection instead of throwing; the shared client helper `convex/lib/auth.ts loginWithKeypair` turns the tag back into a thrown `ConvexError({code})`, so clients still observe `INVALID_CREDENTIALS` / `CHALLENGE_EXPIRED` exactly as 08 §1/§9 specify. Also this world's convextest harness does not make `api.*` references directly callable, so tests pass an invoker closure `(args) => t.mutation(api.auth.login, args)` into the helper (SPA will wrap its client call the same way).
- [x] `auth.logout`, `auth.me`. (S) — done; `me` returns `publicKeyFingerprint` = first 10 hex of SHA-256(publicKey) (03 §6).
- [x] `users.heartbeat`, `users.claimFaucet` (rule from `02 §8`, errors `FAUCET_NOT_ELIGIBLE` / `FAUCET_COOLDOWN`). (S) — done; heartbeat updates `users.lastSeenAt` and, when `roomId` given, the caller's seat presence, returns `{ ok: true }` (08 §2). claimFaucet checks the COOLDOWN first so the common "just claimed" case gets the retry hint `data.nextClaimAt = lastFaucetAt + FAUCET_COOLDOWN_MS`; `FAUCET_NOT_ELIGIBLE` covers permanently-rich users; returns `{ balance }`.
- [x] Backend tests (convex-test or handler-level): duplicate username rejected; login with wrong key fails generically; expired challenge fails; session token hash at rest (assert the raw token string appears in no stored document). (M) — done in `convex/auth.test.ts`: 13 tests, incl. 5-attempt invalidation persisting between attempts, phantom behaviour identical, `nextClaimAt` payload asserted exactly, raw token absent from stored session (only `tokenHash`), rollback semantics of rejected claims verified.
- Acceptance: register → challenge → login round-trip works from a test script against the dev deployment; a signature over a tampered message is rejected. → Adapted (no-deploy constraint): full register → challenge → login → `me` → logout round-trip passes in-process against the real schema via convex-test (`npm test` 44/44); wrong-key/tampered signatures rejected generically.

## Phase 3 — Rooms and lobby (`05`, `08 §3`)

- [x] `rooms.createRoom` with the full validation table (`05 §2`); store `SHA-256(passphrase)` only. (S) — done; every rejection carries `data: { setting }` on `INVALID_ROOM_SETTINGS` so the SPA dialog can point at the offending input. New constants: `PASSPHRASE_MIN/MAX` (4–64), `BUY_IN_MIN_BIG_BLINDS` (10), `PRESENCE_ONLINE_MS` (45 s). Host auto-joined as member (`seatIndex = -1`).
- [x] `rooms.listPublicRooms` (public + non-closed only, seat/member counts). (S) — done; two `by_status_visibility` queries (waiting/playing × public), sorted `lastActivityAt` desc, capped at 50 (08 §3). Chained `q.eq("status",…).eq("visibility",…)` on the 2-key index works in this world.
- [x] `rooms.getRoom` three-tier projection (`05 §7`). (M) — done: `{ exists: false }` for gone rooms, `{ exists, closed: true }` redaction for closed rooms, `{ exists, requiresPassphrase: true }` stub for private rooms viewed by non-members (not even the name leaks), full projection otherwise with `seats[]` (username, stack, state, `online` presence flag from `users.lastSeenAt`), `isHost`, `yourSeatIndex`.
- [x] `rooms.joinRoom` (passphrase check, `JOIN_DENIED` uniformity, membership document with `seatIndex = -1`). (S) — done; missing room / closed room / wrong-or-missing passphrase all yield the identical `JOIN_DENIED` (no existence oracle, `05 §3`); re-join idempotent.
- [x] `rooms.sitDown` / `standUp` / `leaveRoom` / `toggleSitOut` / `topUp` with atomic balance↔stack movement; mid-hand hooks stubbed. (M) — done; sitDown checks ALREADY_SEATED before the chair-occupancy probe (`by_room_seat`), private rooms reject seating without prior membership (`JOIN_DENIED`), chair index bounds fold into `SEAT_TAKEN`. Chip moves are single-transaction `balance -= buyIn` / `stack = buyIn` pairs (and the reverse on standUp), asserted by chip-conservation tests. Mid-hand deviation (Phase 5 will relax): a live hand (`currentHandId` stage ≠ finished) makes `standUp`/`leaveRoom`/`endGame`/`closeRoom` throw `GAME_IN_PROGRESS` and `topUp` throw `BETWEEN_HANDS_ONLY` (`topUp` adds `min(buyIn − stack, balance)` between hands only, per `05 §4`).
- [x] Host migration and auto-close on empty (`05 §5`); `rooms.endGame`, `rooms.closeRoom`. (S) — done; leaving host → earliest-joined SEATED member, else earliest member overall (deterministic `joinedAt` tie behaviour asserted in tests); last member leaving sets `status = closed`, `closedAt = now`; `hostId` keeps its (departed) value since the schema field is non-optional. `closeRoom` cashes out every seated player atomically.
- [x] Tests: private room invisible in lobby; wrong passphrase and closed room give identical errors; chip conservation across sit/stand cycles. (M) — done in `convex/rooms.test.ts` (10 tests): validation table ×8 settings, lobby visibility/ordering/closed-gone, uniform `JOIN_DENIED` for wrong passphrase ≡ closed ≡ deleted room, three-tier `getRoom` incl. presence flag, sit/stand chip conservation, `by_room_seat` occupancy, `BETWEEN_HANDS_ONLY`, planted `hands` docs (stage `turn` → all guards fire; patched to `finished` → boundary ops succeed), host migration chain + auto-close, `toggleSitOut` keeps seat+stack. Note: `it()` blocks in one `describe` SHARE the same `convexTest` DB, so lobby assertions are name/roomId-scoped, not global counts.
- Acceptance: two scripted users can create/join/sit/stand in dev; lobby data matches expectations in the dashboard. → Adapted (no-deploy constraint): full create → join → sit → stand → leave → migrate → close flow plus the guard paths pass in-process against the real schema via convex-test (`npm test` 54/54 across 7 files); `npm run typecheck` green.

## Phase 4 — Poker engine, pure TypeScript (`04`)

- [x] `convex/game/cards.ts`: encoding helpers (`rankOf`, `suitOf`, `toString`), `createDeck()`. (S)
- [x] `convex/game/evaluator.ts`: 5-card evaluation + best-of-7 via subset maximum; labels. Test vectors: wheel straight, steel wheel, quads vs full house ordering, two-pair kicker, board-plays tie, flush tiebreak, full-house-over-full-house. (M)
- [x] `convex/game/pots.ts`: side-pot construction from `betTotal`s; distribution incl. split pots and odd-chip rule (`04 §7`). Tests: three-way all-in at different stacks, uncalled-bet return, split with odd chip. (M)
- [x] `convex/game/engine.ts`: state constructors (`startHand` incl. blinds and heads-up rules from `04 §3`), `legalActions(state, userId)`, `applyAction` (fold/check/call/raiseTo/allIn, full-raise vs short-all-in reopening rules from `04 §5`), street completion and advancement, showdown, win-by-fold. (L)
- [x] Engine property tests: chip conservation over randomised action sequences with a seeded RNG; every terminal state distributes exactly the pot. (M)
- [x] Edge-case tests from the table in `04 §9` that are engine-level (blinds all-in for less, BB wins by fold, short all-in does not reopen). (M)
- Acceptance: the whole `convex/game/` suite passes without importing any Convex API (grep the imports to prove it). ✓ — 33 tests green; `game/` files import only each other (+ vitest in `*.test.ts`).

Deviations & decisions (Phase 4):
- Pure-TS engine takes a `randomInt: RandomInt` callback in `startHand` (injection
  for deterministic tests; the Convex shell passes `convex/lib/rng.randomInt`).
- Action model: `raiseTo` amount = new total bet level; all-in a distinct kind.
  Below-minimum `raiseTo` accepted only at the player's all-in maximum (short
  all-in, 04 §5) and does not reopen betting.
- Chip accounting: per-player `betStreet`/`betTotal` (blinds = live bets per 04 §5:
  preflop `check` legal only when `toCall == 0`; completing the BB is `call`).
- `advanceStreetIfNeeded` auto-runs out remaining streets when no actor remains
  (all-in runout) and finishes when one contender remains (win by fold; uncalled
  bet returned through the pot-band model, 04 §7).
- Terminal states carry `result.shares` (per-user chips) so the Convex shell can
  credit seat stacks with exact conservation; the engine never mutates seats.
- Heads-up: button posts SB and acts first preflop; non-button first postflop.
- Determinism property test re-seeds a fresh RNG per hand (same seed ⇒ same deal).
- Engine throws `{ code, data }` light objects (mirrors ConvexError shape for the
  shell's `ILLEGAL_ACTION` mapping); no `showdown` stage value is ever set — the
  reducer goes `river -> finished` directly, keeping the schema literal for later.

## Phase 5 — Game flow on Convex (`04 §8–9`, `08 §4`)

- [x] `game.getTableState`: per-viewer projection exactly per `08 §4`, incl. server-computed `legal` block and `lastHandResult`.
  - `stage` is `"waiting"` when the room is `waiting` and the current hand is finished; otherwise the hand's stage.
  - `legal` is computed in the shell (the engine's `legalActions` enumerates moves, it does not expose amounts).
- [x] `game.startGame` (host gate, ≥ 2 qualifying seats) + internal `startHandInternal` (deck shuffle via `lib/rng`, hole cards, blinds, first timer).
- [x] `game.act`: session + turn checks, engine reduce, persist, timer management; errors `NOT_YOUR_TURN` / `ILLEGAL_ACTION`.
- [x] Internal `handleTurnTimeout` with `(handId, turnSeq)` guard; timeout action = check-if-free else fold (`lastAction.kind` = `timeout-check` / `timeout-fold`).
- [x] Internal `advanceStreet` (1.2 s per street) and `startNextHand` (5 s, auto-sit-out, room → `waiting` when < 2 qualify).
  - Engine `advanceStreetIfNeeded` now deals **one** street per call and leaves `turnSeat = -1`; the shell re-schedules until showdown. The street that ends with the final all-in is dealt by that same step, so pacing starts with the next street.
- [x] Replace Phase 3 stubs: mid-hand `standUp`/`leaveRoom` fold through the engine first (`foldMidHand` in `game.ts`; `endGame`/`closeRoom` still refuse live hands).
- [x] `crons.ts` + internal cleanup: hourly; expired sessions/challenges deleted; `waiting` rooms idle 6 h closed (members cashed out); offline > 10 min `seated` players stood up in non-playing rooms.
  - `cleanupExpired` is an internal **action** (08 §4) so it delegates to internal query/mutations (`sweepForCleanup`, `purgeEphemeral`, `closeStaleRoom`, `standUpIdleSeats`).
- [x] Concurrency test: a second `act` for the same turn throws `NOT_YOUR_TURN` (Convex serialises the mutations; the re-read state has moved on).
- [x] Security review checklist (release blocker): automated test asserts a mid-hand opponent projection carries no `deck`/`holeCards`/`stackStart`/`betTotal`/`hasActed`/`eligibleUserIds`/`turnSeq`/`startedAt`, that pot entries expose `amount` only, and that the viewer's own seat still shows 2 cards. Grep over `game.ts` confirms no public function returns a `hands` document (only `getTableState`'s projection).
- [x] Acceptance: scripted heads-up hand preflop→showdown through `startGame` + `act` only; separate tests drive the turn clock (`_scheduled_functions` + fake timers), the auto-sit-out rule, next-hand continuation, and the all-in runout pacing (burn accounting: 52 − 12 = 40 cards left).

### Deviations (Phase 5)
- `hands` doc gains `timeoutStats` (the auto-sit-out tally of 04 §9 has no field in 02 §6); `ante` stays 0 because `rooms` has no ante setting (02 §4); `players[].stack` is not stored, derived as `stackStart − betTotal`.
- `lastAction` follows 02 §6 `{ seatIndex, kind, amount?, at }` (no `userId`); the engine's internal `lastAction.userId` is mapped through the participants.
- No room/hand deletion policy implemented (D-07 is an open decision in 10).

## Phase 6 — Chat (`06`, `08 §5`)

- [x] `chat.sendMessage` (member gate, trim, 500-char cap, 800 ms rate limit).
  - `INVALID_MESSAGE` carries `{ max, length }`; `RATE_LIMITED` carries `retryInMs`.
  - the window is the newest message of that user in that room (`by_room_createdAt`,
    `order("desc")` + `userId` filter), compared with the server's `Date.now()`.
  - posting bumps `rooms.lastActivityAt`, so an active table never looks stale (02 §4).
- [x] `chat.listMessages` (latest `CHAT_WINDOW` = 100, oldest-to-newest).
  - `{ id, userId, username, body, createdAt }`; the username is joined from `users`
    in the query, so renames show through and bodies cannot impersonate anyone (06 §3).
  - closed rooms reject with `ROOM_CLOSED` (06 §2 "queries reject closed rooms"); the
    documents stay put — retention/deletion remains the open decision D-07 (10).
- [x] Tests: 7 green convextest cases — non-member blocked on read **and** post
  (member-but-unseated allowed both), `INVALID_MESSAGE` for 501 chars and for a
  whitespace-only body, exact 500-char body stored trimmed, `RATE_LIMITED` proven
  deterministically by pinning the stored `createdAt` (per-user window: the other
  member still posts), re-post allowed once the message is aged, `lastActivityAt`
  bumped, 105 inserted messages windowed to the newest 100 ascending, username
  joined at query time after a rename, closed room unreachable while messages
  persist. Suite is 101 green.
- [ ] Acceptance: messages between two dev users appear reactively in both clients.
  (Client-side half lands in Phase 7 — `listMessages` is a plain Convex query, so the
  SPA subscribes to it and new documents arrive without polling.)

### Deviations (Phase 6)
- Membership ⇒ `seats` document for (room, user) (05 §3), so the chat gate is the
  same lookup as the room gate; there is no separate membership table.
- The rate limit is a soft anti-flood control exactly as 06 §2 says: two
  simultaneously-issued posts by the same user are not arbitrated against each
  other (each transaction re-reads the same newest message).

## Phase 7 — Frontend pages and components (`07`)

- [x] App shell: `ConvexProvider` in `src/main.tsx` (Phase 0), `useSession()` auth
  context in `src/lib/auth.tsx` (token in `sessionStorage`, `auth.me` doubles as the
  profile header and the session-validity gate), state-based router in `src/App.tsx`
  for `/register`, `/login`, `/lobby`, `/room/:roomId`.
  - the current path is one `useState` seeded from `location.pathname`; pages receive
    `navigate: (path: string) => void` so a hand-off never forces a reload, while
    anchors keep real `href`s (`/room/<id>`) so the static host's SPA fallback makes
    a reload work (07 §1 "use real paths").
  - lobby/room render only for a validated session; otherwise the register/login
    chooser is shown. A rejected `me` clears the stale token (07 §1).
  - the stylesheet is one template string (`src/lib/themeCss.ts`) rendered as a
    single `<style>` element — CSS only, no image assets (07 §1).
- [x] `src/lib/keys.ts`: keypair generation (`@noble/ed25519` + sync SHA-512 wiring,
  same as the server's `convex/lib/ed5519.ts`), key-file body (username/key/
  fingerprint/loss warning), key-file parse (`npk_` token extraction), fingerprint
  = first 10 hex of SHA-256 of the base64url public key (03 §2, verified equal to the
  server's `auth.ts` fingerprint).
- [x] `RegisterPage` + `PrivateKeyDisplay`: username validated locally (3–20,
  `[A-Za-z0-9_]`) → local keypair → `auth.register` → key reveal in a read-only
  area with Copy + Download (`nporkerd-key-<username>.txt`), the fingerprint, the
  loss warning, and an acknowledgement checkbox that gates a disabled-until-checked
  Continue → auto-login through the `loginWithKeypair` round-trip → lobby.
  - `loginWithKeypair` lives in `src/lib/auth.tsx` — the client helper the backend
    comment names; `auth.login` *returns* its rejection (`{ ok: false, code }`) so
    the attempt counter survives rollback, and the helper re-raises it as the
    `{ code, data }` payload shape `errorCopy.ts` reads.
  - the private key is component state only: shown once, dropped after login, never
    written to storage (03 §3 final paragraph).
- [x] `LoginPage`: username + key by paste or key-file upload, local fingerprint of
  the pasted key displayed before the server is involved (03 §4.2), and one generic
  sentence for every failure (03 §4.3).
- [x] `LobbyPage`: header (username, `BalanceBadge` bankroll + faucet eligibility,
  faucet button only when the rule allows, logout → `/login`), reactive
  `rooms.listPublicRooms` rows (no polling), `CreateRoomDialog` with every setting of
  05 §2 and its default; the passphrase field only appears for a private room and
  says it can never be shown again.
- [x] `RoomPage`: closed rooms redacted (05 §7), private non-members see only the
  passphrase prompt (05 §2: the link locates, the passphrase lets in), public
  non-members see the summary + join, members get the table + chat + the between-hands
  panel. Join → choose a free seat → sit down are separate explicit steps ("no
  surprise chip movement", 07 §2.4); host controls (start/end/close) render only for
  the host.
- [x] `PokerTable` + `SeatView` + `CardView`: 2–9 seats on an elliptical felt (anchors
  computed by index, index 0 at the top), dealer chip, this street's bet in front of
  the player, turn highlight *and* label, countdown ring driven by the projection's
  `turnDeadline`, board + pots (side pots listed), one-line last-action ticker, hand
  number, `lastHandResult` winners/amounts/hand-rank label.
  - cards are CSS-only glyphs (`♠♥♦♣`, red suits per 04 §2); hidden hands render as
    card backs — the projection never sends hidden numbers (00 §5), so the client
    has nothing to guess.
- [x] `ActionBar`: renders only under the projection's `legal` block (not our turn
  → nothing offered), Fold/Check/Call/Raise-to/All-in as real keyboard-reachable
  `<button>`s, `allIn` visually distinct (single click, no confirm per TODO note),
  raise amount = typed numeric input + "Set amount" + ±1/±10 nudges, mirrored by a
  fill bar; the client duplicates no rules beyond clamping to
  `[minRaiseTo, maxRaiseTo]`, and a rejected action surfaces as transient copy, never
  as if it ran (07 §2.4).
- [x] Showdown presentation: revealed opponents' pairs flip (CSS keyframes +
  `prefers-reduced-motion` off-switch, plus the text label "shown at showdown" —
  colour/motion is never the only signal), winners/amounts from `lastHandResult`,
  between-hands panel (next-hand countdown from the projection, sit-out toggle,
  top-up, stand-up, host controls).
- [x] `ChatPanel`: the reactive `chat.listMessages` window with the **only**
  optimistic update in the SPA (`withOptimisticUpdate` appends the row locally, the
  query confirms it; 07 §3), bodies rendered as text nodes, 500-char counter.
- [x] Responsive pass: breakpoints at 860 px and 360 px (chat collapses below the
  table via `.np-room-grid` → one column); action buttons reachable by keyboard;
  the raise input accepts typed amounts.
- [ ] Acceptance: the full smoke flow of `09 §5.4` in two browser profiles against the
  dev deployment. Deferred with the Phase 8/9 playtests — verifying it needs
  `convex dev`, which is out of scope here (validation stays `npm run typecheck`
  + `npm run test`, and the SPA builds: `npm run build` bundles 113 modules).

### Deviations (Phase 7)
- No `convex/http.ts`: `convex/convex.config.ts` mounts staticHosting at `httpPrefix:
  "/"` and that component registers its own routes ("fastest serving mode"); adding
  08 §6's `registerStaticRoutes` would double-register the catch-all. The client side
  of 08 §6 therefore needs no app-owned HTTP file.
- `getTableState` gained one additive field, `nextHandAt?: number`: 07 §2.4 wants the
  between-hands countdown "from the projection" but 08 §4 had no deadline for it
  (`NEXT_HAND_DELAY_MS` from the hand's `finishedAt`). Still a deadline, so the client
  never measures the delay itself.
- Raise control: a numeric `<input>` + "Set amount" + nudges + a fill bar instead of a
  draggable slider — a dragged range input cannot be read back from inside React, and
  07 §5 only demands that typed amounts are accepted. Bounds are the server's.
- `ChatPanel` renders the newest 16 of the 100-message window, bottom-pinned by CSS,
  as the approximation of 07 §2.4's auto-scroll; the full window is always available
  through the query.
- The optimistic chat row carries a fixed placeholder id (`Id` values cannot be minted
  client-side) and is filtered out before re-appending, so a replay of the update cannot
  duplicate it; the server's document replaces it when queries converge.
- Presence: `PresenceTicker` beats `users.heartbeat` every 30 s (08 §2) with a client
  constant, deliberately not in `convex/lib/constants.ts` (the server never reads it);
  it is the only non-presentational client timer (07 §3 says the rest are).
- Private key handling in `LoginPage`: file upload reads the DOM `input`'s `files` and
  `file.text()` locally, so the key never crosses to the server (03 §4).
- Route ids arrive as strings from the URL: cast `as Id<"rooms">` before calling
  projections/mutations; the server re-checks membership regardless.

## Phase 8 — Hardening and game-feel QA

- [x] Playtest matrix — every row is pinned to the convextest that reproduces it
  against the real schema/functions, plus the SPA call sequence that drives it.
  Opening two browser profiles needs `convex dev`, which stays out of scope, so the
  browser walk-through is recorded here as the exact path the pages take instead of
  being claimed as done.

  | row | server-side truth (test) | client path |
  | --- | --- | --- |
  | heads-up game | `game.test.ts` "scripted heads-up hand runs preflop to showdown through public mutations only", "the game continues 5 s after a hand finishes"; `game/engine.test.ts` "heads-up: the button posts the small blind and acts first preflop" | `LobbyPage` → `CreateRoomDialog` (2 seats) → `RoomPage` join → `sitDown(0/1)` → `startGame` → `ActionBar` → next hand 5 s later |
  | 3 players, all-in side pot | `game/pots.test.ts` "three-way all-in at different stack sizes makes three bands", "the short all-in loser forfeits only its own band", "two winners split each band they both covered", "the whole pot is conserved among the shares"; `game/engine.test.ts` "three players: blinds posted…", "blinds all-in preflop run out the board one street at a time" | `RoomPage` with three members, `allIn` button, `PokerTable` renders `pots[]` as main pot + labelled side pots |
  | player disconnects mid-hand (tab closed, no more writes) | `game.test.ts` "a withheld clock folds a facing bet, tallies the timeout and auto-sits out" — nothing client-side is required: the scheduled `handleTurnTimeout` fires on its own | the tab simply stops sending: the projection's `turnDeadline` countdown expires, `lastHandResult`/`timeoutStats` follow; presence dot flips to "away" past `PRESENCE_ONLINE_MS` (45 s) and the hourly sweep stands idle seats up |
  | full-timeout player auto-sat-out next hand | same test (`autoSitOut` tallies then `startNextHand` skips them) | `RoomPage` shows "sitting out"; `toggleSitOut` lets them come back between hands |
  | host leaves a waiting room (migration) | `rooms.test.ts` "host migration and auto-close on last member" | `leaveRoom` from the host; `RoomProfile.isHost` moves to another viewer, whose host buttons light up |
  | private room joined by link + passphrase | `rooms.test.ts` "joinRoom: wrong passphrase ≡ closed ≡ missing room (no oracle)", "getRoom: closed / private-non-member stub / member full" | `RoomPage` passphrase field → `joinRoom({passphrase})` → seat selection → `sitDown` |
- [x] Error-surface sweep: `src/lib/errorCopy.ts` types `ERROR_COPY` as a
  **homomorphic copy of the server's own list** (`{ [K in keyof typeof errorCodes]:
  string }`, 25 codes), so the typechecker proves both directions: a server code
  without copy is a compile error, and copy for a code the server cannot produce is
  too. Negative control verified while writing it: a table missing a code and a table
  with an invented code each failed `tsc` as expected.
- [x] Security review from Phase 5 re-checked against the final code —
  `convex/security.test.ts` (4 cases, all green):
  - every projection obtainable by the browser (waiting, preflop, mid-hand, finished,
    plus `getRoom`/`listPublicRooms`/`listMessages`) contains no hands-document-only
    key (`deck`, `stackStart`, `betTotal`, `hasActed`, `eligibleUserIds`, `turnSeq`,
    `startedAt`, `minRaise`, `currentBet`), and `pots` stays amounts-only;
  - a three-handed hand in which one player folds on the flop: the server dealt
    **six** hole cards, the viewer is handed **four** (own pair + the contested peer's),
    the folded player's seat carries no `holeCards` key at all, and the visible set is
    5 board + 2 + 2, all distinct and in 0..51 — so unrevealed cards are *tested*
    unreachable, per 10's acceptance line;
  - non-members get `NOT_A_MEMBER` from both the table and the chat, while still seeing
    the room in the public lobby; a closed room gives `ROOM_CLOSED` to both.
  - the only projection change since Phase 5 (`nextHandAt`) was reviewed here: it is a
    server timestamp (`finishedAt + NEXT_HAND_DELAY_MS`), asserted equal to the
    hands-document truth.
- [x] Load sanity, by static count rather than the dashboard (no deployment here). Per
  seat-per-hand: 1 `act` mutation per action (≈ 18–25 for a 6-max street-complete hand)
  + 1 `startHandInternal` + up to 3 `advanceStreet` (all-in runouts only) + 1
  `startNextHand`. Client side per viewer: three reactive queries (`getTableState`,
  `getRoom`, `listMessages`), re-evaluated when a dependency changes, plus one
  `users.heartbeat` per 30 s. Order of magnitude for one 9-seat table in one hand:
  ≈ 25 mutations + ≈ 27 query re-executions per state change ⇒ a few hundred function
  calls per hand, i.e. well inside 09 §7's "handful of simultaneous tables among
  friends"; the crons add 1 `cleanupExpired` action per hour (each running
  `sweepForCleanup` + `purgeEphemeral` + `closeStaleRoom` + `standUpIdleSeats`). The
  dashboard's Usage page remains the place to read the real numbers — 09 §7 puts the
  first remedy on the plan, then the chattiest query (`getTableState`), and the
  projection is already per-viewer, one per client.
- [ ] Acceptance: playtest matrix signed off in two real browser profiles, and
  "no known way for a client to learn unrevealed cards" *observed* in devtools. The
  tested half is green above; the observed half needs the dev deployment (see Phase 9).

### Deviations (Phase 8)
- No browser profile, no dev deployment: the matrix is pinned to tests plus the exact
  SPA call path, and the load figures are static counts rather than dashboard readings.
- The error sweep is a compile-time proof (mapped type over the server's `errorCodes`)
  instead of a runtime test, because `src/` is outside the convex test project; the
  client still keeps `errorCodesHandled()` for the runtime fallback path.

## Phase 9 — Production deployment (`09`)

- [ ] Install `@convex-dev/static-hosting`; register the component (`convex.config.ts`), add `convex/http.ts` routes, confirm upload API exposure per the package README for the installed version. (M)
- [ ] `npm run deploy` script: backend deploy + SPA build/upload, targeting prod, embedding the prod `VITE_CONVEX_URL`. (S)
- [ ] Owner executes `09 §5` end-to-end (backup → backend deploy → SPA upload → smoke checklist), including verifying the test user lands in the **prod** data browser. (S)
- [ ] Tag the release in git; record the prod deployment name + date in the repo changelog. (S)
- Acceptance: nporkerd is playable at `https://<prod>.convex.site` by two fresh accounts.

## Phase 10 — Later / optional (not v1)

- [ ] Hand-history page per user (from retained `hands` documents).
- [ ] Spectator mode for room members (read-only table view already falls out of the projection; add join-as-spectator UX copy).
- [ ] Configurable auto-rebuy.
- [x] Sound effects and card animations (see the notes below).
  - `src/lib/sound.ts`: cues are **synthesized with the WebAudio API** — the bundle
    still ships no media files, so static hosting keeps serving one small SPA (07 §1
    "no image assets", extended to audio). Each cue is 0.05–0.4 s at gain ≤ 0.07, never
    loops, and nothing is created until the first cue is needed.
  - cue table: `deal`/`flop`/`turn`/`river`/`showdown`/`hand-over` (stage transitions),
    `action-check`/`action-call`/`action-raise`/`action-allin`/`action-fold` (only after
    the server accepted the act — a denial plays `deny`, never the chip sound),
    `action-chat` (the softest cue), `deny`.
  - `SoundCue` fires a cue at most once per **token** (stage + hand number from the
    projection), so the flop cue plays once and the many re-renders during the flop play
    nothing — no client-side timers (07 §3).
  - `SoundControl`: a labelled mute button in the lobby and room headers ("sound: on/off"
    in text), so audio state is legible without listening (07 §5).
  - animations are CSS-only: hole cards deal in (`np-deal`/`np-deal-alt` alternated on
    `handNumber`, which restarts a reused element's animation each hand), board cards
    slide in with an 110 ms stagger from the card's index, showdown reveals keep their
    `np-flip` turn, winners pulse twice **and** are labelled "wins this hand".
  - accessibility: `@media (prefers-reduced-motion: reduce)` switches every animation
    off, each one is paired with a text label, and muting is one click plus text copy.

### Notes (Phase 10 — sound and animation)
- The mute preference is stored in `localStorage` (`nporkerd.sound`). D-04's
  `sessionStorage` rule is about the **session token**; a mute switch that reset on every
  reload would be hostile, and a preference carries no credential.
- Deal-in animation restarts by alternating two identical-in-spirit keyframe sets keyed
  on the projection's `handNumber`: a reused DOM element otherwise keeps a finished
  animation, and the client must not track "did I already animate this" (07 §3).
- Winner seats are matched to `lastHandResult.winners` **by username**: registration
  enforces unique names case-insensitively (03 §3/`USERNAME_TAKEN`), so the match is
  exact. Still only cosmetic — the projection never gates on it.
- No audio assets, no autoplay: cues exist only as small tone tables, which also keeps
  the built bundle at ~356 kB instead of adding files to the static-hosting upload.
- [ ] Moderation basics: host kick (remove a member from the room).
- [ ] Move passphrase hashing to iterated SHA-256 (D-09 option B) if probing is observed.
- [ ] Data retention job (D-07 option B) if table growth matters.
