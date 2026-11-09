# 02 — Data Model

All tables are defined in `convex/schema.ts`. Field types below use Convex
validators. `Id<"table">` is Convex's typed document id. Indexes listed per
table are required; query patterns that use them are named in
[08-api-reference.md](08-api-reference.md).

Conventions:

- Money is always an integer number of chips. No floats anywhere near chips.
- `createdAt` / `updatedAt` are epoch milliseconds.
- Soft state (e.g. a room being `closed`) is preferred over deleting
  documents, except for ephemeral auth data (challenges, sessions), which is
  deleted by cron after expiry.

## 1. `users`

One document per registered account.

| Field | Type | Notes |
| --- | --- | --- |
| `username` | `string` | Display name, exactly as registered. 3–20 chars, `[A-Za-z0-9_]` only. |
| `usernameLower` | `string` | `username.toLowerCase()`; uniqueness key. |
| `publicKey` | `string` | Ed25519 public key, base64url, 32 bytes decoded. |
| `balance` | `number` | Global play-money bankroll (integer chips). Starts at `STARTING_BALANCE` = **10,000** (Default). Never negative. |
| `lastFaucetAt` | `optional(number)` | Last faucet claim time; faucet defined in §8. |
| `createdAt` | `number` | Registration time. |
| `lastSeenAt` | `number` | Updated by the heartbeat mutation; drives presence. |

Indexes: `by_usernameLower` on `usernameLower` (unique in effect — enforced
in the registration mutation, which runs serialisably).

Uniqueness rule: registration checks `by_usernameLower` inside the mutation
before inserting. Because Convex mutations are serialised transactions, two
concurrent registrations of the same name cannot both pass the check.

## 2. `sessions`

One document per live login session.

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | `Id<"users">` | Session owner. |
| `tokenHash` | `string` | SHA-256 hex of the session token. The raw token exists only on the client. |
| `createdAt` | `number` | |
| `expiresAt` | `number` | `createdAt + SESSION_TTL_MS`; **Default** TTL 30 days, not sliding. |
| `userAgent` | `optional(string)` | As reported at login; display/diagnostics only. |

Indexes: `by_tokenHash` on `tokenHash`; `by_user` on `userId`;
`by_expiresAt` on `expiresAt` (cron cleanup).

## 3. `loginChallenges`

Short-lived login nonces. One active challenge per user at a time.

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | `Id<"users">` | |
| `nonce` | `string` | 32 random bytes, base64url. Generated server-side. |
| `createdAt` | `number` | |
| `expiresAt` | `number` | `createdAt + 5 min`. |
| `attempts` | `number` | Failed verification count; challenge is invalidated at 5. |

Indexes: `by_user` on `userId`; `by_expiresAt` on `expiresAt`.

Requesting a new challenge deletes the user's previous challenge document.
See [03-auth.md](03-auth.md) §4 for the full protocol and anti-enumeration
behaviour (a challenge is issued even for unknown usernames, bound to no
user, so the endpoint cannot be used to probe which usernames exist —
implementation detail in 03 §4.3).

## 4. `rooms`

One document per room (lobby + its single table).

| Field | Type | Notes |
| --- | --- | --- |
| `name` | `string` | 1–40 chars, shown in the lobby. |
| `hostId` | `Id<"users">` | Creator; may transfer implicitly (see 05 §5). |
| `visibility` | `"public" \| "private"` | Private rooms require a passphrase to join and are not listed in the public lobby. |
| `passphraseHash` | `optional(string)` | SHA-256 hex of the passphrase; present iff `visibility = "private"`. Plaintext is never stored or returned. |
| `status` | `"waiting" \| "playing" \| "closed"` | `playing` while a hand or a game session is in progress (between hands it stays `playing` until the host ends the game or everyone leaves). |
| `maxSeats` | `number` | 2–9, chosen at creation. **Default** 9. |
| `smallBlind` | `number` | **Default** 10. Positive integer. |
| `bigBlind` | `number` | **Default** 20. Must be ≥ 2 × smallBlind is NOT required; must be > smallBlind. |
| `buyIn` | `number` | **Default** 1,000. Chips moved from balance to stack on sit-down; must be ≥ 20 × bigBlind is recommended but not enforced. |
| `turnSeconds` | `number` | Per-turn clock: 0 = off, else 10–120. **Default** 30. |
| `currentHandId` | `optional(Id<"hands">)` | The hand currently being played, if any. |
| `lastActivityAt` | `number` | Updated on joins, game actions, chat. Drives stale-room cleanup. |
| `createdAt` | `number` | |
| `closedAt` | `optional(number)` | Set when closed. |

Indexes: `by_status_visibility` on `(status, visibility)` for the lobby
listing; `by_host` on `hostId`; `by_lastActivityAt` on `lastActivityAt`.

## 5. `seats`

One document per (room, user) membership at the table. A user has at most one
seat document per room, created on first sit-down and kept until they leave
the room.

| Field | Type | Notes |
| --- | --- | --- |
| `roomId` | `Id<"rooms">` | |
| `userId` | `Id<"users">` | |
| `seatIndex` | `number` | 0 … `maxSeats-1`; unique within the room (enforced in mutation). |
| `stack` | `number` | Chips at the table (integer, ≥ 0). |
| `state` | `"seated" \| "sittingOut" \| "left"` | `seated` = dealt into the next hand; `sittingOut` = keeps the seat and stack but is skipped; `left` = cashed out, seat released (document retained for audit, `stack` = 0). |
| `joinedAt` | `number` | First sit-down time. |
| `lastSeenAt` | `number` | Heartbeat while in the room; presence display. |

Indexes: `by_room` on `roomId`; `by_room_user` on `(roomId, userId)`;
`by_room_seat` on `(roomId, seatIndex)`.

Invariants enforced by mutations:

- `balance + Σ stacks` only changes via faucet (creates chips) — poker moves
  chips between stacks and pots, never creates or destroys them.
- A user may occupy seats in several rooms, but may be `seated` in at most
  one hand at a time per room (trivially true: one seat per room).

## 6. `hands`

One document per hand. This document is **server-secret**: it is never
returned by any public query (see [00-overview.md](00-overview.md) §5). Only
`game.*` functions read it, and only `game.getTableState` exposes a
projection.

| Field | Type | Notes |
| --- | --- | --- |
| `roomId` | `Id<"rooms">` | |
| `handNumber` | `number` | Per-room sequence, starting at 1. |
| `stage` | `"preflop" \| "flop" \| "turn" \| "river" \| "showdown" \| "finished"` | |
| `deck` | `number[]` | Remaining undealt cards (0–51), top of deck = last element (pop to deal). Secret. |
| `board` | `number[]` | Community cards revealed so far (0, 3, 4, or 5 entries). Public once dealt. |
| `players` | `object[]` | One entry per participant in this hand, in seat order. Shape below. |
| `pots` | `object[]` | Computed pots: `{ amount: number, eligibleUserIds: Id<"users">[] }`. Recomputed by the engine whenever bets change; final at showdown. |
| `dealerSeat` | `number` | Seat index of the button for this hand. |
| `currentTurnSeat` | `optional(number)` | Seat index to act; absent when no action is pending (street transition, showdown, finished). |
| `currentBet` | `number` | Highest total bet on the current street. |
| `minRaise` | `number` | Size of the last full raise (or big blind preflop); the minimum legal raise increment. |
| `turnSeq` | `number` | Increments on **every** state change. All scheduled callbacks carry the `turnSeq` they were scheduled for and no-op if it has moved. |
| `turnDeadline` | `optional(number)` | Epoch ms when the current turn times out (absent if `turnSeconds = 0`). |
| `lastAction` | `optional(object)` | `{ seatIndex, kind, amount?, at }` of the most recent action, for UI display ("Alice raised to 400"). |
| `result` | `optional(object)` | At `finished`: `{ winners: { userId, amount, handRankLabel }[], revealedUserIds: Id<"users">[] }` — safe to show to the whole room. |
| `startedAt` | `number` | |
| `finishedAt` | `optional(number)` | |

`players[]` entry:

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | `Id<"users">` | |
| `seatIndex` | `number` | |
| `holeCards` | `number[]` | Exactly 2 cards once dealt. **Secret** until showdown reveal. |
| `stackStart` | `number` | Stack at hand start (for pot maths). |
| `betStreet` | `number` | Chips committed on the current street. |
| `betTotal` | `number` | Chips committed in the whole hand (drives side pots). |
| `status` | `"active" \| "folded" \| "allIn" \| "out"` | `out` = was seated but not dealt in (stack 0 or sitting out at deal time — normally excluded from `players` entirely; see 04 §3). |
| `hasActed` | `boolean` | Has acted on the current street since the last raise. Engine-internal but stored for the reducer's convenience. |

Indexes: `by_room` on `roomId`; `by_room_handNumber` on
`(roomId, handNumber)`.

Retention: hand documents are kept (they are the audit trail and the source
of the "last hand" summary). A v1 deployment with friendly traffic will not
grow large; a cleanup policy is an open decision (D-07 in
[10-open-decisions.md](10-open-decisions.md)).

## 7. `chatMessages`

| Field | Type | Notes |
| --- | --- | --- |
| `roomId` | `Id<"rooms">` | |
| `userId` | `Id<"users">` | Author. Username is read from `users` at query time (no denormalised copy, so it can never disagree). |
| `body` | `string` | 1–500 chars after trimming. Stored raw; rendered as text by React (never as HTML). |
| `createdAt` | `number` | Server time of the send mutation. |

Indexes: `by_room_createdAt` on `(roomId, createdAt)` — the chat query takes
the newest 100 in descending order.

## 8. Constants (single source of truth: `convex/lib/constants.ts`)

| Constant | Value | Used by |
| --- | --- | --- |
| `STARTING_BALANCE` | 10,000 | registration |
| `FAUCET_AMOUNT` | 1,000 | faucet |
| `FAUCET_COOLDOWN_MS` | 24 h | faucet |
| `FAUCET_MAX_BALANCE` | 1,000 (claim only if `balance < buyIn` of the target room is NOT assumed; global rule: claim only if `balance < FAUCET_AMOUNT`) | faucet — see note |
| `SESSION_TTL_MS` | 30 days | login |
| `CHALLENGE_TTL_MS` | 5 min | login |
| `CHAT_MAX_LENGTH` | 500 | chat |
| `CHAT_MIN_INTERVAL_MS` | 800 | chat rate limit (tracked on the user document as transient state via last message query — see 06 §3) |
| `NEXT_HAND_DELAY_MS` | 5,000 | between hands |
| `STREET_DEAL_DELAY_MS` | 1,200 | pacing when a street is dealt automatically (all-in runout) |

Faucet rule (Default): a user whose `balance < FAUCET_AMOUNT` may claim
`FAUCET_AMOUNT` chips, at most once per `FAUCET_COOLDOWN_MS`. This keeps
broke players able to rejoin a default-buy-in table without making balances
meaningless. The rule is deliberately global (not per-room) for v1.
