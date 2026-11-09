# 10 — Open Decisions

The requirements fixed the architecture and the headline behaviours. The
following points were **not** specified; each entry lists options, trade-offs,
and the **recommended default already written into the other documents**.
Changing a decision means editing the listed documents and the matching
TODO items — none of them requires redesign.

| ID | Topic | Decided in |
| --- | --- | --- |
| D-01 | Default table size | 02, 05 |
| D-02 | Turn timer default and timeout behaviour | 02, 04 |
| D-03 | Starting balance / faucet generosity | 02 |
| D-04 | Session persistence on the client | 03, 07 |
| D-05 | Hand evaluator: implement vs library | 04 |
| D-06 | Ed25519 library | 03 |
| D-07 | Retention of hands and chat | 02, 06 |
| D-08 | SPA hosting: component vs hand-rolled HTTP actions | 01, 09 |
| D-09 | Passphrase storage strength | 05 |
| D-10 | Auto-sit-out aggressiveness | 04, 05 |

---

### D-01 Default table size: 9-max vs 6-max

- **A. 9 seats max, host chooses 2–9 (default 9)** — classic full-ring;
  more code paths exercised (heads-up is the special case either way).
- **B. 6 seats max** — faster games, simpler table layout on mobile.
- **Recommended: A** (written into the docs). The engine is seat-count
  agnostic; only layout effort differs.

### D-02 Turn timer

- **A. 30 s default, timeout = check if free else fold** (written into the
  docs). Keeps games moving; forgiving when checking is free.
- **B. 60 s default** — friendlier for casual play, slower tables.
- **C. Timeout = sit out instead of fold when a call is required** — gentler
  but lets a disconnected player stall every street once per hand.
- **Recommended: A**, with the room-level setting (0/10–120 s) letting hosts
  pick B-like behaviour per room.

### D-03 Starting balance and faucet

- **A. Start 10,000; faucet 1,000 / 24 h when balance < 1,000** (written
  into the docs). Balances stay meaningful for months of casual play.
- **B. Unlimited faucet on demand** — zero friction, zero meaning.
- **C. Daily login bonus instead of a faucet** — more machinery.
- **Recommended: A.**

### D-04 Where the session token lives on the client

- **A. `sessionStorage`** (written into the docs) — gone when the browser
  closes; user logs in with their key file each day. Safer on shared
  machines.
- **B. `localStorage`** — stays logged in across restarts; risk on shared
  machines; note the token is a bearer credential for ≤ 30 days.
- **Recommended: A for v1**; B is a one-line change if daily re-login proves
  annoying.
- **Decided (2026-11): B.** Re-login on every new tab was too annoying. The
  token stays in `localStorage` until it expires or the user logs out, and
  tabs stay in sync. The Help page tells people on shared computers to log out. (The *private key* is never stored by the app under either
  option — that part is not negotiable.)

### D-05 Hand evaluator

- **A. Implement in-repo** (~150 lines + test vectors) — no dependency,
  exact tiebreak semantics under our control, matches the "pure engine"
  principle (written into the docs).
- **B. Adopt a library** (e.g. `pokersolver`) — faster to start; its hand
  descriptions and edge semantics must be wrapped to match §6 of
  [04-game-engine.md](04-game-engine.md), and 7-card evaluation goes through
  its own conventions.
- **Recommended: A.** The evaluator is small, heavily testable, and sits on
  the game's critical path.

### D-06 Ed25519 implementation

- **A. `@noble/ed25519`** (written into the docs) — pure TS, sync API once
  `sha512Sync` is wired, runs identically in browser and Convex runtime.
- **B. WebCrypto** — zero dependencies, but Ed25519 support across browsers
  is recent/uneven; fallback logic would be needed.
- **C. `tweetnacl`** — battle-tested but older API style.
- **Recommended: A.**

### D-07 Retention of finished hands and chat

- **A. Keep indefinitely** (written into the docs) — v1 traffic is small;
  keeps an audit trail.
- **B. Cron-delete hands/chat older than 90 days** — bounded growth; loses
  history.
- **Recommended: A for v1**, revisit if the `hands` table becomes a quota
  concern (see [09-deployment-and-operations.md](09-deployment-and-operations.md) §7).

### D-08 SPA hosting mechanism

- **A. Official `@convex-dev/static-hosting` component** (written into the
  docs) — versioned uploads, caching, SPA fallback, authenticated upload
  path; the CLI sets `VITE_CONVEX_URL` at build. Risk: young component
  (0.2.x), CLI surface may shift between versions.
- **B. Hand-rolled `httpAction` serving from file storage** — full control,
  but re-implements caching/ETag/fallback and the upload pipeline.
- **Recommended: A**; B is the fallback if the component proves unreliable.

### D-09 Passphrase hashing strength

Room passphrases are human-chosen words — low entropy. Options:

- **A. Single SHA-256** (written into the docs) — simple, works in the
  Convex V8 runtime; guessing is only possible by calling `joinRoom`, which
  is online and can be rate-limited by the app (add a per-user join-attempt
  counter if abuse appears).
- **B. Iterated SHA-256 (e.g. 10,000 rounds in the mutation)** — slows
  online guessing 10⁴× at trivial cost for a single check; no new deps.
- **C. A memory-hard KDF (scrypt/argon2)** — not available in the default
  Convex runtime; would force the Node runtime for that function.
- **Recommended: A for v1, upgrade to B if passphrase rooms see probing.**
  Note the real protection is that private rooms are unlisted and their
  existence is not confirmable via the API.

### D-10 Auto-sit-out aggressiveness

- **A. Sit out after a hand in which the player timed out on every action**
  (written into the docs).
- **B. Sit out after 2 consecutive hands of full timeouts** — more forgiving
  of a long phone call.
- **C. Never auto-sit-out** — tables can stall behind absent blind-posters.
- **Recommended: A.**
