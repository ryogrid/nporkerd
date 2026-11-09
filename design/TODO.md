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
- [ ] Concurrency test: fire two `act` mutations for the same turn concurrently; exactly one applies. (S)
- [ ] Security review checklist (release blocker): no public function returns a `hands` document; `getTableState` output for a non-showdown opponent contains no `holeCards`; the string `deck` appears in no return value — add an automated test asserting the projection shape for a mid-hand opponent view. (M)
- [ ] Acceptance: a scripted two-player hand runs preflop→showdown driven only through public mutations, with timers firing when actions are withheld.

### Deviations (Phase 5)
- `hands` doc gains `timeoutStats` (the auto-sit-out tally of 04 §9 has no field in 02 §6); `ante` stays 0 because `rooms` has no ante setting (02 §4); `players[].stack` is not stored, derived as `stackStart − betTotal`.
- `lastAction` follows 02 §6 `{ seatIndex, kind, amount?, at }` (no `userId`); the engine's internal `lastAction.userId` is mapped through the participants.
- No room/hand deletion policy implemented (D-07 is an open decision in 10).

## Phase 6 — Chat (`06`, `08 §5`)

- [ ] `chat.sendMessage` (member gate, trim, 500-char cap, 800 ms rate limit). (S)
- [ ] `chat.listMessages` (latest 100 ascending, username joined at query time). (S)
- [ ] Tests: non-member cannot read or post; rate limit triggers; 501-char message rejected. (S)
- Acceptance: messages between two dev users appear reactively in both clients.

## Phase 7 — Frontend pages and components (`07`)

- [ ] App shell: `ConvexProvider`, auth context (`sessionStorage` token, `me` query gate), route switching for `/register`, `/login`, `/lobby`, `/room/:roomId`. (M)
- [ ] `lib/keys.ts`: keypair generation, key-file download format, key-file parse, fingerprint computation. (S)
- [ ] RegisterPage + PrivateKeyDisplay: mandatory-download/copy UI, acknowledgement checkbox gating Continue, auto-login after registration. (M)
- [ ] LoginPage: paste + file upload, local fingerprint display, generic error text. (S)
- [ ] LobbyPage: balance/faucet/logout header, reactive public room list, CreateRoomDialog with all settings from `05 §2`. (M)
- [ ] RoomPage: passphrase gate for private rooms; join → seat selection → sit-down confirm. (M)
- [ ] PokerTable + SeatView + CardView: seat layout for 2–9 seats, dealer button, street bets, turn highlight + countdown from `turnDeadline`, board and pots display, last-action ticker. (L)
- [ ] ActionBar: renders only from the projection's `legal` block; raise slider + numeric input clamped to `[minRaiseTo, maxRaiseTo]`; all-in confirm not required (single click) but button is visually distinct. (M)
- [ ] Showdown presentation: revealed cards flip, winners and amounts from `lastHandResult`; between-hands panel (countdown, sit-out toggle, top-up, stand-up; host controls for the host). (M)
- [ ] ChatPanel with optimistic send; auto-scroll behaviour per `07 §2.4`; 500-char counter. (S)
- [ ] Responsive pass (360 px) and keyboard access to actions. (S)
- Acceptance: the full smoke flow of `09 §5.4` passes manually in two browser profiles against the **dev** deployment.

## Phase 8 — Hardening and game-feel QA

- [ ] Playtest matrix: heads-up game, 3-player with an all-in side pot, a player disconnecting mid-hand (close the tab; verify timeout flow), a full-timeout player being auto-sat-out next hand, host leaving a waiting room (migration), private room join by link + passphrase. (M)
- [ ] Error-surface sweep: every error code in `08 §9` has user-facing copy in the client. (S)
- [ ] Re-check the security review items from Phase 5 against the final code (projection shape test still green after refactors). (S)
- [ ] Load sanity: one table, 9 clients, a full hand — no visible lag; note function-call volume from the dashboard for the `09 §7` quota picture. (S)
- Acceptance: playtest matrix signed off; no known way for a client to learn unrevealed cards (tested, not assumed).

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
- [ ] Sound effects and card animations.
- [ ] Moderation basics: host kick (remove a member from the room).
- [ ] Move passphrase hashing to iterated SHA-256 (D-09 option B) if probing is observed.
- [ ] Data retention job (D-07 option B) if table growth matters.
