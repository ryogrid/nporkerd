# 05 — Rooms and Lobby

## 1. Concepts

A **room** is both the lobby unit and the table. Users:

1. browse public rooms in the lobby, or open a private room via its link/id;
2. **join** the room (passphrase required for private rooms);
3. **sit down** at a free seat, buying in from their balance;
4. wait for the host to start the game, play hands (auto-continuing), chat;
5. **stand up** (cash out) and/or **leave** the room.

Room lifecycle: `waiting` (created, no game running) → `playing` (host has
started; hands run back-to-back) → back to `waiting` when fewer than two
seated players remain at a hand boundary, or the host ends the game → 
`closed` (host closes it, or it empties, or it goes stale).

## 2. Creating a room

Function: `rooms.createRoom` (mutation). Host is any logged-in user.

| Setting | Validation | Default |
| --- | --- | --- |
| `name` | 1–40 chars after trim | — (required) |
| `visibility` | `"public" \| "private"` | `"public"` |
| `passphrase` | required iff private; 4–64 chars | — |
| `maxSeats` | integer 2–9 | 9 |
| `smallBlind` | integer ≥ 1 | 10 |
| `bigBlind` | integer > smallBlind | 20 |
| `buyIn` | integer ≥ bigBlind × 10 | 1,000 |
| `turnSeconds` | 0 (off) or 10–120 | 30 |

Server-side: `passphraseHash = SHA-256(passphrase)` (hex). The passphrase
itself is never stored, logged, or returned. A private room is **not**
returned by the lobby listing query at all; it is reachable by direct link
(`/room/<id>`) plus the passphrase — the link is a locator, not a credential.

The host is automatically joined to the room (but not seated) on creation.

## 3. Joining a room

Function: `rooms.joinRoom({ roomId, passphrase? })`.

- Public room: any logged-in user.
- Private room: the mutation hashes the supplied passphrase and compares
  with `passphraseHash` in constant work (a single SHA-256 + string compare;
  timing is not a practical concern inside a mutation, but error behaviour
  is: a wrong passphrase returns the same `JOIN_DENIED` error as a closed
  room, without confirming the room exists — for non-members,
  `rooms.getRoom` likewise returns a redacted stub, see §7).
- Joining creates nothing by itself; membership is implicit — a user is "in"
  a room once they hold a seat document or have joined this session. For
  chat/viewing purposes, membership = having successfully called `joinRoom`
  (server records it by inserting/updating a `seats` document with
  `state = "left"`, `stack = 0`, `seatIndex = -1` meaning "member, not
  seated") — implementer note: this keeps one membership table. A cleaner
  reading: `seats` is the membership table; `seatIndex ≥ 0` means physically
  seated. All seat-uniqueness checks consider only documents with
  `seatIndex ≥ 0` and `state ≠ "left"`.

*(This refines [02-data-model.md](02-data-model.md) §5: `seatIndex` may be
`-1` for members who have joined but not sat down, and such documents have
`state = "left"` is wrong — use a dedicated reading: members-not-seated are
documents with `seatIndex = -1` and `state = "sittingOut"` is also wrong.
Final rule, normative here: a membership document exists per (room, user);
`seatIndex = -1` ⇔ not seated; `state` is meaningful only when
`seatIndex ≥ 0`. Queries that list table occupants filter `seatIndex ≥ 0`.)*

- A user may be a member of several rooms but seated in only one seat per
  room (schema-enforced by `by_room_user` unique lookup in mutations).

## 4. Sitting down, standing up, leaving

- `rooms.sitDown({ roomId, seatIndex })`: seat must be free; user's
  `balance ≥ room.buyIn`; atomically: `balance -= buyIn`, seat document gets
  `seatIndex`, `stack = buyIn`, `state = "seated"`. If a hand is in
  progress, the player is dealt in from the **next** hand.
- `rooms.standUp({ roomId })`: if the user is in the current hand and has
  not folded, they are folded first (engine path, see
  [04-game-engine.md](04-game-engine.md) §9); then `balance += stack`,
  `stack = 0`, `seatIndex = -1`, seat released.
- `rooms.leaveRoom({ roomId })`: standUp (if seated) + delete the membership
  document. Leaving is always allowed, even mid-hand (with the fold rule
  above).
- `rooms.toggleSitOut({ roomId, sittingOut })`: a seated player may sit out
  (skipped by future hands, keeps seat and stack) or come back. Toggling
  mid-hand takes effect from the next hand.
- **Rebuy / top-up** (Default): between hands only — a seated player whose
  stack is below `buyIn` may `rooms.topUp({ roomId })` to add
  `min(buyIn − stack, balance)` chips. If stack is 0 and balance is 0, the
  faucet ([02-data-model.md](02-data-model.md) §8) is the way back.

## 5. Host powers and host migration

Host may: start the game (`game.startGame`), end the game back to `waiting`
(`rooms.endGame`, only at a hand boundary — if a hand is running it finishes
first, enforced by checking `currentHandId`'s stage), and close the room
(`rooms.closeRoom`: all seated players are cashed out automatically; if a
hand is in progress this is rejected with `GAME_IN_PROGRESS` — the host ends
the game first).

If the host leaves a non-closed room, host passes to the member with the
earliest `joinedAt` among seated members, else earliest member overall. If
the last member leaves, the room is closed (`status = "closed"`,
`closedAt = now`).

## 6. Game start and continuation

- `game.startGame` (host only, room `waiting`, ≥ 2 `seated` players with
  `stack > 0`): sets `status = "playing"` and deals the first hand via the
  same internal path as `startNextHand`.
- After each hand, `startNextHand` (internal, scheduled) deals again after
  5 s while conditions hold (see [04-game-engine.md](04-game-engine.md) §8).
  Players who timed out on every action of the previous hand are auto-set to
  `sittingOut` before the next deal.
- The room returns to `waiting` when a hand boundary finds < 2 qualifying
  players.

## 7. What each viewer can see (room-level projection)

`rooms.getRoom({ roomId, sessionToken })` returns:

- members: full detail (name, seats, stacks, states, presence) — stacks and
  seats are public game information;
- non-members, public room: the same room summary (name, settings, seat
  occupancy) but no chat and no table state;
- non-members, private room: only `{ exists: true, requiresPassphrase: true }`
  — not even the room name (prevents passphrase-probing users from learning
  anything beyond having a valid link);
- anyone, closed room: `{ closed: true }`.

`rooms.listPublicRooms({ sessionToken })` returns rooms with
`visibility = "public"` and `status ≠ "closed"`, newest activity first,
with seated/total seat counts. Limit: 50.

## 8. Presence and stale rooms

- Presence: `users.heartbeat` updates `lastSeenAt`; a member is shown
  "online" if `lastSeenAt` is within 45 s. Purely cosmetic.
- Seat hogging: a `seated` but offline (> 10 min) player who is not in a
  running hand is auto-stood-up by the hourly cron (stack cashed out to
  balance). During a running game, hands continue to auto-sit-out them per
  [04-game-engine.md](04-game-engine.md) §9 — the cron skips rooms in
  `playing` status.
- Stale rooms: rooms with `status = "waiting"` and no activity for 6 hours
  are closed by cron (members cashed out as in §5 close semantics).
