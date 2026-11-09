# 08 — API Reference (Convex Functions)

Conventions:

- All functions live under `api.<file>.<name>` from the client's view.
- Unless stated otherwise, the first argument of every authenticated
  function is `sessionToken: v.string()` and the function begins with
  `requireSession` ([03-auth.md](03-auth.md) §5). Failures throw
  `ConvexError` with one of the codes in §9.
- "Secret" marks functions that read the `hands` document. Only the listed
  ones may do so; **no public function returns a `hands` document or any
  part of its `deck` field**.
- Return shapes are TypeScript-ish pseudocode; implement with Convex
  validators on arguments (returns validators recommended for public
  functions).

## 1. `convex/auth.ts`

### `register` — mutation, unauthenticated
- Args: `{ username: string, publicKey: string }`
- Returns: `{ userId: Id<"users"> }`
- Errors: `INVALID_USERNAME`, `INVALID_PUBLIC_KEY`, `USERNAME_TAKEN`
- Creates the user with `STARTING_BALANCE`. See [03-auth.md](03-auth.md) §3.

### `requestLoginChallenge` — mutation, unauthenticated
- Args: `{ username: string }`
- Returns: `{ challengeId: Id<"loginChallenges">, nonce: string, expiresAt: number }`
- Behaviour identical for unknown usernames ([03-auth.md](03-auth.md) §4.3).

### `login` — mutation, unauthenticated
- Args: `{ challengeId: Id<"loginChallenges">, signature: string }`
  (the username is recovered from the challenge document)
- Returns: `{ sessionToken: string, user: { userId, username, balance } }`
- Errors: `INVALID_CREDENTIALS` (all failure modes), `CHALLENGE_EXPIRED`
- Verifies the Ed25519 signature over
  `"nporkerd-login:" + challengeId + ":" + nonce`, deletes the challenge,
  creates the session, returns the raw token once.

### `logout` — mutation, authenticated
- Args: `{ sessionToken }` → Returns: `{ ok: true }`. Deletes that session.

### `me` — query, authenticated
- Args: `{ sessionToken }`
- Returns: `{ userId, username, balance, publicKeyFingerprint, createdAt }`
- Used by the client on load to validate the stored session.

## 2. `convex/users.ts`

### `heartbeat` — mutation, authenticated
- Args: `{ sessionToken, roomId?: Id<"rooms"> }`
- Updates `users.lastSeenAt`, and the caller's seat `lastSeenAt` if `roomId`
  given. Returns `{ ok: true }`. Called every 30 s by the client.

### `claimFaucet` — mutation, authenticated
- Args: `{ sessionToken }`
- Rule: [02-data-model.md](02-data-model.md) §8. Errors: `FAUCET_NOT_ELIGIBLE`,
  `FAUCET_COOLDOWN` (returns `nextClaimAt` in the error data).
- Returns: `{ balance }`.

## 3. `convex/rooms.ts`

### `createRoom` — mutation, authenticated
- Args: `{ sessionToken, name, visibility, passphrase?, maxSeats, smallBlind, bigBlind, buyIn, turnSeconds }`
  (validation per [05-rooms-and-lobby.md](05-rooms-and-lobby.md) §2)
- Returns: `{ roomId }`. Creator becomes host and first member.

### `listPublicRooms` — query, authenticated
- Args: `{ sessionToken }`
- Returns: array of `{ roomId, name, hostUsername, status, maxSeats, seatedCount, memberCount, smallBlind, bigBlind, buyIn, turnSeconds, lastActivityAt }`, newest activity first, max 50. Never includes private rooms.

### `getRoom` — query, authenticated
- Args: `{ sessionToken, roomId }`
- Returns per the projection rules in [05-rooms-and-lobby.md](05-rooms-and-lobby.md) §7:
  full room object for members/public rooms (settings, seats with usernames
  and stacks, presence flags, `isHost`, `yourSeatIndex`), redacted stub for
  private rooms to non-members, `{ closed: true }` for closed rooms.

### `joinRoom` — mutation, authenticated
- Args: `{ sessionToken, roomId, passphrase? }`
- Errors: `JOIN_DENIED` (closed room or wrong/missing passphrase — same code).
- Creates the membership (seat document, `seatIndex = -1`) if absent.
  Returns `{ ok: true }`.

### `leaveRoom` — mutation, authenticated
- Args: `{ sessionToken, roomId }`. Stands the user up first if seated
  (mid-hand fold rule). Deletes membership. Host migration / auto-close per
  [05 §5]. Returns `{ ok: true }`.

### `sitDown` — mutation, authenticated
- Args: `{ sessionToken, roomId, seatIndex }`
- Errors: `SEAT_TAKEN`, `INSUFFICIENT_BALANCE`, `ALREADY_SEATED`,
  `ROOM_CLOSED`.
- Moves `buyIn` from balance to stack atomically. Returns `{ stack }`.

### `standUp` — mutation, authenticated
- Args: `{ sessionToken, roomId }`. Mid-hand: folds the user first.
  Returns `{ balance }`.

### `toggleSitOut` — mutation, authenticated
- Args: `{ sessionToken, roomId, sittingOut: boolean }`.
  Returns `{ ok: true }`.

### `topUp` — mutation, authenticated
- Args: `{ sessionToken, roomId }`. Only between hands
  (`BETWEEN_HANDS_ONLY` otherwise). Adds `min(buyIn − stack, balance)`.
  Returns `{ stack, balance }`.

### `endGame` — mutation, authenticated, host only
- Args: `{ sessionToken, roomId }`. Only when no hand is in a non-finished
  stage. Sets room `waiting`. Returns `{ ok: true }`.

### `closeRoom` — mutation, authenticated, host only
- Args: `{ sessionToken, roomId }`. Rejected while a hand is live
  (`GAME_IN_PROGRESS`). Cashes out all seated players, sets `closed`.
  Returns `{ ok: true }`.

## 4. `convex/game.ts`

### `getTableState` — query, authenticated, **secret-reading**
- Args: `{ sessionToken, roomId }`
- Returns the per-viewer projection (the only window onto `hands`):

```ts
{
  roomId, stage: "waiting" | Stage, handNumber?: number,
  board: number[],                      // revealed community cards
  pots: { amount: number }[],           // amounts only; eligibility is not exposed
  dealerSeat?: number,
  seats: {                              // aligned with rooms.getRoom seats
    seatIndex: number, userId, username,
    stack: number,                      // stack behind (not committed)
    betStreet: number,                  // committed on this street (0 between hands)
    inHand: boolean,
    folded: boolean, allIn: boolean,
    isDealer: boolean, isCurrentTurn: boolean,
    holeCards?: number[],               // ONLY: (a) the viewer's own cards, or
                                        // (b) revealed players' cards at/after showdown
    lastAction?: { kind, amount? },
  }[],
  currentTurnSeat?: number,
  turnDeadline?: number,
  yourTurn: boolean,
  legal?: {                             // present iff yourTurn
    canCheck: boolean, canCall: boolean, callAmount: number,
    minRaiseTo: number, maxRaiseTo: number, toCall: number,
  },
  lastHandResult?: {                    // from the most recent finished hand
    winners: { username, amount, handRankLabel }[],
  },
}
```

Projection rules (normative, from [00-overview.md](00-overview.md) §5): the
`deck` field is never copied; `holeCards` of another player appear only if
that player is in `result.revealedUserIds` of a finished/shown-down hand;
folded players' cards never appear. Before the next hand starts, the
previous hand's revealed cards may remain visible (they are history).

### `startGame` — mutation, authenticated, host only
- Args: `{ sessionToken, roomId }`. Errors: `NOT_HOST`,
  `NOT_ENOUGH_PLAYERS`, `ALREADY_PLAYING`.
- Sets room `playing`, deals hand #1 via `startHandInternal`.

### `act` — mutation, authenticated, **secret-reading/writing**
- Args: `{ sessionToken, roomId, kind: "fold"|"check"|"call"|"raiseTo"|"allIn", amount?: number }`
  (`amount` required iff `kind = "raiseTo"`, and means "raise **to** this
  total street bet").
- Errors: `NOT_IN_HAND`, `NOT_YOUR_TURN`, `ILLEGAL_ACTION` (with reason).
- Loads the caller's room hand, runs the engine reducer, persists, manages
  timers and street/hand transitions (scheduling internals per
  [04-game-engine.md](04-game-engine.md) §8). Returns `{ ok: true }`.

### Internal functions (not callable by clients)

| Function | Kind | Trigger | Guard |
| --- | --- | --- | --- |
| `startHandInternal` | internal mutation | `startGame`, `startNextHand` | room still `playing`, ≥ 2 qualifying seats |
| `handleTurnTimeout` | internal mutation | scheduler at `turnDeadline` | `(handId, turnSeq)` match |
| `advanceStreet` | internal mutation | scheduler during all-in runout | `(handId, turnSeq)` match |
| `startNextHand` | internal mutation | scheduler 5 s after a hand finishes | `(roomId, handId)` match; room still `playing` |
| `cleanupExpired` | internal action | cron (hourly) | deletes expired sessions/challenges; closes stale rooms per [05 §8] (via internal mutations it calls) |

## 5. `convex/chat.ts`

### `listMessages` — query, authenticated, members only
- Args: `{ sessionToken, roomId }`
- Returns: latest 100, ascending: `{ id, userId, username, body, createdAt }[]`.
- Errors: `NOT_A_MEMBER`.

### `sendMessage` — mutation, authenticated, members only
- Args: `{ sessionToken, roomId, body }`
- Errors: `NOT_A_MEMBER`, `INVALID_MESSAGE`, `RATE_LIMITED`.
- Returns: `{ messageId }`.

## 6. `convex/http.ts`

No application HTTP endpoints in v1. The file only registers the
static-hosting component's routes (`registerStaticRoutes`), so the SPA is
served from `https://<deployment>.convex.site`. Convex's own function
traffic (queries/mutations over WSS/HTTPS) does not go through `http.ts`.

## 7. `convex/crons.ts`

| Job | Schedule | Calls |
| --- | --- | --- |
| `cleanup` | every hour | `internal.game.cleanupExpired` (name it `internal.maintenance.cleanup` if placed in a `maintenance.ts` — pick one home and keep TODO consistent) |

## 8. Shared helpers (`convex/lib/`)

| Helper | Purpose |
| --- | --- |
| `session.requireSession(ctx, token)` | §5 of [03-auth.md](03-auth.md); returns `{ session, user }` or throws `UNAUTHENTICATED` |
| `hash.sha256Hex(input: string \| Uint8Array)` | token hashes, passphrase hashes (WebCrypto `crypto.subtle.digest`, async) |
| `rng.randomInt(maxExclusive)` / `rng.shuffleInPlace(arr)` | cryptographic RNG for dealing (sync, `crypto.getRandomValues`) |
| `errors` | the code constants below |

## 9. Error codes (complete list)

`UNAUTHENTICATED`, `INVALID_USERNAME`, `INVALID_PUBLIC_KEY`,
`USERNAME_TAKEN`, `INVALID_CREDENTIALS`, `CHALLENGE_EXPIRED`,
`FAUCET_NOT_ELIGIBLE`, `FAUCET_COOLDOWN`, `INVALID_ROOM_SETTINGS`,
`JOIN_DENIED`, `NOT_A_MEMBER`, `SEAT_TAKEN`, `ALREADY_SEATED`,
`INSUFFICIENT_BALANCE`, `ROOM_CLOSED`, `NOT_HOST`, `GAME_IN_PROGRESS`,
`BETWEEN_HANDS_ONLY`, `NOT_ENOUGH_PLAYERS`, `ALREADY_PLAYING`,
`NOT_IN_HAND`, `NOT_YOUR_TURN`, `ILLEGAL_ACTION`, `INVALID_MESSAGE`,
`RATE_LIMITED`.

Clients map codes to user-facing text; the server never relies on the
client having done so.
