# 04 — Game Engine (Texas Hold'em, server-side)

## 1. Overview

All poker logic runs on the server, in two layers:

- **Pure engine** (`convex/game/`): plain TypeScript, no Convex imports.
  `engine.ts` exposes a reducer `applyAction(state, action, rng?)` and
  helpers `startHand(...)`, `legalActions(state, userId)`. Fully unit-tested.
- **Impure shell** (`convex/game.ts`): Convex mutations that load documents,
  call the reducer, persist the result, and schedule timers.

Rules are standard **no-limit Texas Hold'em** with the specific choices
below. Anything not mentioned follows the usual Robert's Rules of Poker
conventions.

## 2. Cards and deck

- A card is an integer `0–51`. `rank = card % 13` where `0=2, 1=3, …, 8=10,
  9=J, 10=Q, 11=K, 12=A`. `suit = Math.floor(card / 13)` where
  `0=spades, 1=hearts, 2=diamonds, 3=clubs`.
- Display string: rank char from `"23456789TJQKA"`, suit char from `"shdc"`
  (e.g. `51 → "Ac"`, check: 51 % 13 = 12 → A; ⌊51/13⌋ = 3 → clubs ✓).
- `createDeck()` returns `[0..51]`; `shuffle(deck, rng)` is Fisher–Yates
  from the end, drawing indices from the injected RNG.
- Dealing order per hand: shuffle → deal one card to each participating
  player in seat order starting left of the button, then a second card →
  burn 1, flop 3 → burn 1, turn 1 → burn 1, river 1. Burn cards are drawn
  from the deck and discarded (they remain in the deck array's dealt count;
  simplest correct implementation: `draw()` pops from the end of `deck`;
  burns call `draw()` and drop the result).
- The RNG in production is `convex/lib/rng.ts`: `randomInt(max)` built on
  `crypto.getRandomValues` with rejection sampling (no modulo bias). In
  tests, a seeded PRNG is injected.

## 3. Who is in a hand

At `startHand` (called by `startNextHand` internal mutation or the host's
`startGame`):

- Participants: seats with `state = "seated"` and `stack > 0`, in seat
  order. Fewer than 2 → the game does not start (error for manual start;
  silent no-op for auto-start).
- Each participant's stack is snapshotted into `stackStart`; blinds and bets
  are deducted from their seat `stack` as the hand progresses (the hand
  document tracks per-player commitments; the seat stack is debited at the
  moment chips are committed — implementer note: keep one source of truth.
  **Rule:** chips move seat.stack → player.betTotal at commit time; at hand
  end, winnings are credited seat.stack += amount. A player's "stack behind"
  during the hand is `seat.stack` as stored.)
- Button: for the first hand in a room, the lowest occupied seat index;
  afterwards, the next participant clockwise from the previous button. If the
  previous button's player has left, advance from their seat index anyway.
- Blinds:
  - 3+ players: small blind = seat after button, big blind = next seat.
  - Heads-up (2 players): the **button posts the small blind** and acts
    first preflop; the other player posts the big blind and acts first on
    later streets.
  - A player whose stack is smaller than the blind posts their whole stack
    (all-in for less); the engine records the posted amount as their
    `betStreet`/`betTotal`.
  - Dead blinds are not implemented: a player who was absent for a hand
    simply posts normally in the next hand they join. (Simplicity over
    casino exactness; v1 rule.)

## 4. The state machine

```
            startHand
 WAITING ─────────────▶ PREFLOP ──street complete──▶ FLOP ──▶ TURN ──▶ RIVER ──▶ SHOWDOWN ──▶ FINISHED
                            ▲                                                              │
                            └──────────── next hand scheduled after 5 s ──────────────────┘
 Any street ──(only one player not folded)──▶ FINISHED (pot awarded, no showdown, no reveal)
 Any street ──(all remaining players all-in)──▶ auto-deal remaining streets (1.2 s apart) ──▶ SHOWDOWN
```

- A **street completes** when every player with `status = "active"` has
  `betStreet = currentBet` and `hasActed = true` since the last raise, or
  when fewer than two players can still act (others folded/all-in) and the
  bets of those who can act are matched.
- On street completion: all `betStreet` reset to 0 into `betTotal`s (they
  were already accumulated at commit time — implementer note: `betTotal` is
  updated at commit; `betStreet` resets), `currentBet = 0`, `minRaise =
  bigBlind`, first actor = first `active` player clockwise from the button
  (postflop) — preflop first actor is left of the big blind (or the button
  heads-up).
- **Showdown**: among players with `status ≠ "folded"`, evaluate each
  player's best 5 of 7 (hole + board) with `evaluator.ts`; build pots with
  `pots.ts`; distribute (see §7). Reveal exactly those players' cards in
  `result.revealedUserIds`.
- **Win by fold**: the last non-folded player receives all pots they are
  eligible for (in practice, the whole pot); no cards are revealed,
  `result.handRankLabel` is `"Won by fold"`.

## 5. Actions and legality

`game.act({ roomId, sessionToken, kind, amount? })`,
`kind ∈ fold | check | call | raiseTo | allIn`.

The engine computes, for the player to act:

- `toCall = currentBet − betStreet`
- `canCheck = toCall == 0`
- `callAmount = min(toCall, stack)` (calling for less = all-in call)
- `minRaiseTo = currentBet + minRaise` (if `currentBet == 0`, this is the
  minimum bet, `bigBlind`)
- `maxRaiseTo = betStreet + stack` (all-in)

Legality rules (invalid → mutation throws `ILLEGAL_ACTION` with a reason
string; the client also pre-validates for UX):

| Action | Legal when | Effect |
| --- | --- | --- |
| `fold` | always on your turn | `status = folded`; your committed chips stay in the pot |
| `check` | `toCall == 0` | — |
| `call` | `toCall > 0` | commit `callAmount`; if `callAmount == stack`, `status = allIn` |
| `raiseTo(amount)` | `amount ≥ minRaiseTo` and `amount ≤ maxRaiseTo` | commit `amount − betStreet`; if the raise increment `amount − currentBet ≥ minRaise` it is a *full raise*: `minRaise` becomes that increment and all other active players' `hasActed` reset to `false`. A raise below that increment is legal **only** as an all-in (`amount == maxRaiseTo`); it does *not* reopen betting (`hasActed` of others unchanged, `minRaise` unchanged) — standard "short all-in" rule |
| `allIn` | `stack > 0` | sugar for committing everything: treated as call or raiseTo by the resulting `betStreet`, with the same full-raise test |

After any action: if the actor's stack reaches 0 → `status = allIn`. The
turn passes to the next `active` player clockwise who still needs to act;
if none, the street completes (§4).

Out-of-turn or repeated actions are impossible to apply: the mutation checks
`players[currentTurnSeat].userId == caller` before reducing, so a retried or
raced mutation fails cleanly (see [01-architecture.md](01-architecture.md) §5).

## 6. Hand evaluation (`evaluator.ts`)

`evaluate(cards: number[]): { category: number; tiebreak: number[]; label: string }`
for 5–7 cards:

- For 6/7 cards, evaluate all 5-card subsets (21 for 7 cards) and take the
  maximum under lexicographic `(category, tiebreak)` comparison.
- Categories: 8 straight flush, 7 four of a kind, 6 full house, 5 flush,
  4 straight, 3 three of a kind, 2 two pair, 1 one pair, 0 high card.
- Tiebreaks are rank lists in standard order (e.g. two pair: high pair, low
  pair, kicker; full house: trips rank then pair rank). Straights compare by
  top card, with the wheel (A-2-3-4-5) valued as 5-high.
- `label` is a human string for the UI/result, e.g. `"Full House, Kings over
  Tens"`, `"Straight, Queen high"`, `"Flush, Ace high"`.
- `compare(a, b)` returns -1/0/1. Equal evaluations split the pot.

Test vectors are mandatory in TODO Phase 4: at minimum the wheel, a steel
wheel, board-plays (everyone uses the board), kicker decisions, and a
full-house-over-full-house case.

## 7. Pots and distribution (`pots.ts`)

Side pots are computed from `betTotal`s (classic algorithm):

1. Take all players with `betTotal > 0` (including folded players — their
   chips are in, they are just not eligible to win).
2. Sort distinct commitment levels ascending. For each level band, the pot
   slice is `(level − prevLevel) × (number of players with betTotal ≥ level)`,
   eligible winners = non-folded players whose `betTotal ≥ level`.
3. At showdown, each slice goes to the eligible player(s) with the best
   evaluation. At win-by-fold there is a single non-folded player, eligible
   for every slice they contributed to; **note**: a folded player's excess
   uncalled chips cannot exist (betting stops when bets are matched), except
   the final aggressor's uncalled bet — standard rule: an uncalled portion
   of the last bet is returned. The engine handles this in step 2 naturally:
   the top band where only one player has `betTotal ≥ level` and that player
   is the sole eligible one returns to them even without showdown. Simplify:
   distribution code just awards each slice to the best eligible hand(s);
   an uncalled slice has exactly one eligible player and goes back to them.
4. **Split pots and odd chips**: divide equally; remainder chips (at most
   winners−1) are dealt one each to the winners in seat order starting from
   the first winner clockwise after the button.
5. Crediting: `seat.stack += amountWon`. A full audit record is stored in
   `hands.result`.

Invariant (asserted in tests and in a dev-only check): chips are conserved —
`Σ stacks before = Σ stacks after + 0` across a hand (no rake).

## 8. Timers tied to streets

- After `startHand` and after every action that leaves a pending turn, if
  `room.turnSeconds > 0` the shell sets `turnDeadline = now + turnSeconds`
  and calls
  `ctx.scheduler.runAfter(turnSeconds * 1000, internal.game.handleTurnTimeout, { handId, turnSeq })`.
- `handleTurnTimeout` (internal mutation): loads the hand; if
  `hand.turnSeq != args.turnSeq` or `hand.stage` is a non-acting stage →
  return (stale). Otherwise apply the timeout action for the current player:
  **check if `toCall == 0`, else fold** — via the same engine path as a
  manual action, with `lastAction.kind = "timeout-check" | "timeout-fold"`.
- Street pacing on all-in runout: when a street completes and no betting is
  possible on later streets (≤ 1 player `active`, rest `allIn`/`folded`,
  ≥ 2 not folded), the shell schedules `internal.game.advanceStreet`
  after `STREET_DEAL_DELAY_MS` (1.2 s), guarded by `turnSeq`, repeatedly
  until showdown. This gives players time to see each street.
- Between hands: on `finished`, schedule
  `internal.game.startNextHand({ roomId, handId, turnSeq })` after
  `NEXT_HAND_DELAY_MS` (5 s). It starts a new hand if the room is still
  `playing` and ≥ 2 seats qualify; otherwise sets the room back to
  `waiting`.

## 9. Edge cases (all must be handled; most are TODO Phase 4/5 tests)

| Case | Behaviour |
| --- | --- |
| Player disconnects mid-hand | Nothing special: their turn times out (auto check/fold). Their stack and cards persist. If they never return, they bleed blinds across hands only if still `seated` — see next row. |
| Player does not return between hands | A `seated` player keeps being dealt in (and blind-posted) until they stand up or are removed. Mitigation (Default): auto-sit-out — if a player timed out on **every** action of a hand, set their seat to `sittingOut` at hand end. |
| Player leaves mid-hand | `leaveRoom`/`standUp` during a hand: if in the hand and not folded, they are folded immediately (via the engine), then the seat is released and the stack's uncommitted part is cashed out. Committed chips stay in the pot. |
| Stack < blind at hand start | They post what they have (all-in for less). If stack is 0, they are not dealt in (`sittingOut` effectively for this hand; seat state unchanged). |
| Only one player remains seated (others left) mid-game | Current hand finishes if a hand is in progress and ≥ 2 players were dealt; afterwards `startNextHand` finds < 2 and the room returns to `waiting`. |
| Host leaves while `waiting` | Host role passes to the earliest-joined seated member (see [05-rooms-and-lobby.md](05-rooms-and-lobby.md) §5). If the room empties, it closes. |
| Two players act "simultaneously" | Convex serialises the mutations; the second one re-reads state, finds it is no longer their turn (or the street moved), and throws `NOT_YOUR_TURN`/`ILLEGAL_ACTION`. No partial application is possible. |
| Everyone folds to the big blind preflop | Big-blind player wins by fold, including the small blind; their own uncalled BB portion handling follows §7. |
| A player is all-in on the blind and others fold | Win by fold for the all-in player up to eligibility; uncalled portions return per §7. |
| Chat/heartbeat traffic during a hand | Independent tables; no locking interaction with the hand document. |

## 10. What the client may compute

The client may compute **display-only** helpers from the projected state:
legal action ranges (to disable buttons/sliders), pot total (sum of the
projected pots), and countdown rendering from `turnDeadline`. These are
conveniences; the server re-validates everything. The client must never be
the source of a number the server trusts.
