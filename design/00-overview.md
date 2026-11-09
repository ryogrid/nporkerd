# 00 — Overview

## 1. What nporkerd is

nporkerd is a web-based, multiplayer **Texas Hold'em** poker game that friends
play in a browser. A user registers with a username, receives a one-time
**private key** that acts as their password, creates or joins a **room**, takes
a seat at the room's table, and plays hands of poker against the other seated
users. All dealing and all game rules are enforced **on the server side**
(Convex functions). Players at the same table can also exchange **text chat**.

Everything runs on Convex:

- the **database** (users, rooms, hands, chat) is Convex's document database;
- the **server logic** (auth, dealing, betting, chat) is Convex
  queries / mutations / actions / scheduled functions;
- the **SPA itself** is served from Convex (static hosting on the deployment's
  `*.convex.site` domain), so there is no separate web server, no separate
  database, and no other hosting provider.

Chips are **play money**. There is no deposit, no cash-out, no rake, and no
connection to real currency. This is a hard product constraint, not a setting.

## 2. Requirements summary

| # | Requirement | Where designed |
| --- | --- | --- |
| R1 | JS/TS stack for both frontend and backend | 01, 07 |
| R2 | Datastore, server, and SPA hosting all inside Convex | 01, 09 |
| R3 | Registration: user picks a username; a public/private key pair is generated; the user is given **only the private key**, which serves as their password; username + public key are stored server-side | 03 |
| R4 | A lost private key **cannot** be recovered or re-issued for the same account | 03 |
| R5 | Dealing (shuffle, hole cards, board) happens on the backend | 04 |
| R6 | Text chat; messages are visible to every user at the same table | 06 |
| R7 | Users can create rooms and wait for participants | 05 |
| R8 | Two room kinds: public (anyone may join) and passphrase rooms (only users who know the room's passphrase word may join) | 05 |
| R9 | A deployment procedure for the owner is documented | 09 |
| R10 | What the owner must do in Convex, and how credentials (including the ones the SPA uses) are managed, is documented | 03 §7, 09 |

## 3. Scope of the first version (v1)

In scope:

- One table per room; a room is created by a host, who configures name,
  visibility, optional passphrase, seat count, blinds, buy-in, and turn timer.
- No-limit Texas Hold'em for 2–9 players, one deck, standard hand rankings.
- Full betting: blinds, fold / check / call / raise / all-in, side pots,
  showdown, split pots.
- Turn timer with automatic check/fold on timeout.
- Disconnect tolerance: a disconnected player's turn is resolved by the timer;
  their stack stays at the table until they leave or the room closes.
- Room chat (text only).
- Play-money bankrolls: a starting balance, table buy-in / cash-out, and a
  rate-limited "faucet" that refills a broke player.

Out of scope for v1 (see also [10-open-decisions.md](10-open-decisions.md)):

- Real money in any form.
- Tournaments, sit-and-go brackets, multi-table play.
- Multiple tables inside one room, or spectator chat for non-seated users
  beyond read-only viewing of the room they joined.
- Bots / AI opponents.
- Hand histories beyond the currently stored hand record and a short
  per-room "last hand" summary.
- Native mobile apps (the SPA is responsive, that is all).
- Password reset / account recovery of any kind (impossible by design, R4).

## 4. Core design principles

1. **The server is the only referee.** Clients never shuffle, never deal,
   never compute winners, and never learn information the server has not
   revealed to them (see §5). The client is a renderer plus an intent sender
   ("I raise to 400").
2. **Secrecy is enforced by query shape, not by trust.** Convex has no
   field-level security: any document a query returns is fully visible to its
   caller. Therefore the raw hand document (deck, everyone's hole cards) is
   **never** returned by any public query. A single query,
   `game.getTableState`, builds a per-viewer projection. This rule is a
   release blocker if violated; [08-api-reference.md](08-api-reference.md)
   marks every function that touches secret state.
3. **All state changes are mutations.** Convex mutations are transactional
   and serialised, which is what makes concurrent actions by several players
   safe without hand-written locking. Anything that reads-then-writes game
   state is a mutation, never an action.
4. **Timers are scheduled functions, guarded by sequence numbers.** Every
   scheduled callback carries the identifier of the exact state it was
   scheduled for (hand id + turn sequence). If the state has moved on, the
   callback is a no-op. Stale timers are therefore harmless.
5. **Deterministic engine, impure shell.** The poker engine
   (`convex/game/engine.ts`) is a set of pure functions over plain data:
   given a hand state and an action, it returns the next hand state. Randomness
   (shuffle) and time are injected at the mutation layer. This makes the whole
   rule set unit-testable without Convex.
6. **Losing your key means losing your account — say it early, say it
   often.** The registration UI must make R4 unmissable before the account
   exists (see [03-auth.md](03-auth.md) §3 and [07-frontend.md](07-frontend.md)).

## 5. Information-hiding rules (normative)

| Data | Owner sees | Other seated players | Room members not seated | Non-members |
| --- | --- | --- | --- | --- |
| Own hole cards | yes, while in the hand | — | — | — |
| Others' hole cards | no | only at showdown, and only for players who did not fold | only at showdown | no |
| Remaining deck | **never, for anyone, via any API** | never | never | never |
| Folded players' cards | never revealed | never | never | never |
| Room passphrase | never stored in plaintext; never returned | — | — | — |
| User private keys | **never sent to or stored on the server at all** | — | — | — |
| Session tokens | only the SHA-256 hash is stored | — | — | — |

Note: the project owner can inspect the raw database through the Convex
dashboard. That is inherent to operating the service and is accepted; API
clients can never do it.

## 6. Glossary

- **Room** — a lobby + one table. Created by a host; has a lifecycle
  (`waiting` → `playing` ⇄ `waiting` → `closed`).
- **Seat** — one of a room's `maxSeats` positions. A user occupies a seat with
  a **stack** (chips bought in from their balance).
- **Balance** — a user's global play-money bankroll, stored on the user
  document. **Stack** — the chips a user currently has at one table.
- **Hand** — one deal of poker: shuffle to pot distribution.
- **Street** — a betting round: `preflop`, `flop`, `turn`, `river`, then
  `showdown`.
- **Button** — the dealer position for a hand; rotates clockwise each hand.
- **Deployment** — a Convex instance of this app. There are two: `dev`
  (development) and `prod` (production).
- **Deploy key** — the Convex credential used by `npx convex deploy` and by
  the static-hosting upload. Root-equivalent; see
  [09-deployment-and-operations.md](09-deployment-and-operations.md).
