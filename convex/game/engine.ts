/**
 * The hand reducer — design 04 §3–§5 and §7–§9. PURE TypeScript: never
 * imports Convex APIs. State mirrors the `hands` document shape (design
 * 02/05) so the Convex shell can persist it nearly verbatim.
 *
 * Chip rule (04 §3): chips move from stacks into `betTotal`/`betStreet` at
 * commit time; the shell mirrors that into seat.stack. At hand end winners
 * are credited via `shares`.
 */

import { awardContributions } from "./pots";
import { compare, evaluate } from "./evaluator";
import { RandomInt, createDeck, shuffle } from "./cards";

export const SEATS = 10;

export type Stage = "preflop" | "flop" | "turn" | "river" | "showdown" | "finished";
export type PlayerStatus = "active" | "folded" | "allIn";

export interface HandPlayer {
 userId: string;
 seatIndex: number;
 stackStart: number;
 stack: number;
 betTotal: number;
 betStreet: number;
 status: PlayerStatus;
 hasActed: boolean;
 hole: number[];
}

export interface HandState {
 id: string;
 handNumber: number;
 buttonSeat: number;
 stage: Stage;
 deck: number[];
 board: number[];
 players: HandPlayer[];
 currentBet: number;
 minRaise: number;
 bigBlind: number;
 ante: number;
 turnSeat: number;
 lastAction?: { userId: string; action: string; amount?: number };
 result?: HandResult;
}

export interface HandResult {
 type: "showdown" | "fold";
 winnerIds: string[];
 shares: Array<{ userId: string; chips: number }>;
 revealedUserIds: string[];
 handRankLabel: string;
}

export interface ActionData {
 kind: "fold" | "check" | "call" | "raiseTo" | "allIn";
 amount?: number;
}

export interface StartHandInput {
 id: string;
 handNumber: number;
 /** -1 for the first hand: button = lowest occupied seat. */
 prevButtonSeat: number;
 /** seated, stack > 0, any order. */
 players: Array<{ userId: string; seatIndex: number; stack: number }>;
 smallBlind: number;
 bigBlind: number;
 ante: number;
 randomInt: RandomInt;
}

export interface StartHandResult {
 state: HandState;
 /** seat.stack deltas (chip conservation with seat documents). */
 deltas: Array<{ userId: string; stack: number }>;
}

/** Seats ordered clockwise from `from` (exclusive), wrapping. */
export function seatsAfter(from: number, seats: number[]): number[] {
  const dist = (seat: number): number => {
    const d = (seat - from + SEATS) % SEATS;
    return d === 0 ? SEATS : d;
  };
  return [...seats].sort((a, b) => dist(a) - dist(b));
}

function copyState(state: HandState): HandState {
 return {
  id: state.id,
  handNumber: state.handNumber,
  buttonSeat: state.buttonSeat,
  stage: state.stage,
  deck: [...state.deck],
  board: [...state.board],
  players: state.players.map((p) => ({ ...p })),
  currentBet: state.currentBet,
  minRaise: state.minRaise,
  bigBlind: state.bigBlind,
  ante: state.ante,
  turnSeat: state.turnSeat,
  lastAction: state.lastAction ? { ...state.lastAction } : undefined,
  result: state.result ? { ...state.result } : undefined,
 };
}

/** The active players (can still act). */
function activeOf(state: HandState): HandPlayer[] {
 return state.players.filter((p) => p.status === "active");
}

/** Clockwise seat order of participants starting left of the button. */
function seatOrder(buttonSeat: number, seats: number[]): number[] {
 return seatsAfter(buttonSeat, seats);
}

/** Next actor clockwise from `from` who still needs to act this street. */
function nextActorSeat(players: HandPlayer[], from: number, currentBet: number): number {
 const candidates = players.filter((p) => p.status === "active" && (!p.hasActed || p.betStreet < currentBet));
 const ordered = seatsAfter(from, candidates.map((p) => p.seatIndex));
 return ordered.length > 0 ? ordered[0] : -1;
}

/**
 * Start a hand (04 §3): participants, button rotation, blinds (heads-up:
 * button posts the small blind), antes, shuffled deck, hole cards dealt two
 * rounds left of the button.
 */
export function startHand(input: StartHandInput): StartHandResult {
 const participants = [...input.players].sort((a, b) => a.seatIndex - b.seatIndex);
 if (participants.length < 2) {
  throw { code: "NOT_ENOUGH_PLAYERS", data: { count: participants.length } };
 }
 const seats = participants.map((p) => p.seatIndex);
 const buttonSeat = input.prevButtonSeat < 0 ? seats[0] : seatsAfter(input.prevButtonSeat, seats)[0];
 const order = seatOrder(buttonSeat, seats);

 const deck = shuffle(createDeck(), input.randomInt);
 const draw = (): number => {
  const card = deck.pop();
  if (card === undefined) {
   throw { code: "DECK_EXHAUSTED" };
  }
  return card as number;
 };

 const players: HandPlayer[] = participants.map((p) => ({
  userId: p.userId,
  seatIndex: p.seatIndex,
  stackStart: p.stack,
  stack: p.stack,
  betTotal: 0,
  betStreet: 0,
  status: "active" as PlayerStatus,
  hasActed: false,
  hole: [],
 }));

 // Deal two hole cards per player, one at a time, left of the button.
 for (let round = 0; round < 2; round += 1) {
  for (const seat of order) {
   const p = players.find((x) => x.seatIndex === seat);
   if (p) {
    p.hole.push(draw());
   }
  }
 }

 const commit = (seat: number, amount: number): void => {
  const p = players.find((x) => x.seatIndex === seat);
  if (!p) {
   return;
  }
  const n = Math.min(amount, p.stack);
  p.stack -= n;
  p.betTotal += n;
  p.betStreet += n;
  if (p.stack === 0) {
   p.status = "allIn";
  }
 };

 for (const p of players) {
  if (input.ante > 0) {
   commit(p.seatIndex, Math.min(input.ante, p.stackStart));
  }
 }

 const sbSeat = participants.length === 2 ? buttonSeat : order[0];
 const bbSeat = participants.length === 2 ? order[0] : order[1];
 commit(sbSeat, input.smallBlind);
 commit(bbSeat, input.bigBlind);

 const bbPlayer = players.find((p) => p.seatIndex === bbSeat);
 const state: HandState = {
  id: input.id,
  handNumber: input.handNumber,
  buttonSeat,
  stage: "preflop",
  deck,
  board: [],
  players,
  currentBet: bbPlayer ? bbPlayer.betStreet : 0,
  minRaise: input.bigBlind,
  bigBlind: input.bigBlind,
  ante: input.ante,
  // preflop first actor: heads-up the button (small blind); else left of BB.
  turnSeat: participants.length === 2 ? buttonSeat : nextActorSeat(players, bbSeat, bbPlayer ? bbPlayer.betStreet : 0),
 };
  const deltas = state.players.map((p) => ({ userId: p.userId, stack: p.stack }));
 return { state, deltas };
}

/** Burn one card and deal the next street's cards (04 §2 draw order). */
function dealStreet(state: HandState, count: number): void {
 const deck = state.deck;
 const draw = (): number => {
  const card = deck.pop();
  if (card === undefined) {
   throw { code: "DECK_EXHAUSTED" };
  }
  return card as number;
 };
 draw(); // burn
 for (let i = 0; i < count; i += 1) {
  state.board.push(draw());
 }
}

/**
 * Finish the hand (04 §4 "Win by fold" / §6–§7 showdown): computes result
 * + shares; stacks are NOT credited here — the shell credits seat.stack by
 * the shares (chip conservation stays in one place).
 */
export function finishHand(state: HandState): void {
 const contenders = state.players.filter((p) => p.status !== "folded");
 const folded = state.players.filter((p) => p.status === "folded").map((p) => p.userId);
 const contributed: Record<string, number> = {};
 for (const p of state.players) {
  if (p.betTotal > 0) {
   contributed[p.userId] = p.betTotal;
  }
 }
 const dealerSeat = state.buttonSeat;
 if (contenders.length === 1) {
  const winner = contenders[0];
  const awarded = awardContributions({
   contributed,
   folded,
   winners: [{ userId: winner.userId, seatIndex: winner.seatIndex }],
   dealer: { userId: winner.userId, seatIndex: dealerSeat },
  });
  state.result = {
   type: "fold",
   winnerIds: [winner.userId],
   shares: awarded.shares,
   revealedUserIds: [],
   handRankLabel: "Won by fold",
  };
  return;
 }
 const scored = contenders.map((p) => ({ userId: p.userId, seatIndex: p.seatIndex, eval: evaluate(p.hole.concat(state.board)) }));
 let best = scored[0];
 for (const s of scored) {
  if (compare(s.eval, best.eval) > 0) {
   best = s;
  }
 }
  const winners = scored.filter((s) => compare(s.eval, best.eval) === 0).map((s) => ({ userId: s.userId, seatIndex: s.seatIndex }));
 const awarded = awardContributions({
  contributed,
  folded,
  winners,
  dealer: { userId: state.players.find((p) => p.seatIndex === dealerSeat)?.userId ?? "", seatIndex: dealerSeat },
 });
 state.result = {
  type: "showdown",
  winnerIds: winners.map((w) => w.userId),
  shares: awarded.shares,
  revealedUserIds: contenders.map((p) => p.userId),
  handRankLabel: best.eval.label,
 };
}

/**
 * Move the game along the state machine (04 §4): after an action, find the
 * next actor; when the street is complete advance the stage (burn + deal),
 * auto-running out the remaining streets when no one can act any more, and
 * finishing the hand when a single contender remains or the river is done.
 */
export function advanceStreetIfNeeded(state: HandState): HandState {
 const live = activeOf(state);
 const contenders = state.players.filter((p) => p.status !== "folded");
 const next = nextActorSeat(state.players, state.turnSeat, state.currentBet);
 if (next !== -1 && !(contenders.length === 1)) {
  state.turnSeat = next;
  return state;
 }
 // street complete: reset street bookkeeping (04 §4)
 for (const p of state.players) {
  p.betStreet = 0;
  p.hasActed = false;
 }
 state.currentBet = 0;
 state.minRaise = state.bigBlind;
 if (contenders.length === 1) {
  state.stage = "finished";
  state.turnSeat = -1;
  finishHand(state);
  return state;
 }
 const noOneCanAct = live.length === 0;
 if (state.stage === "river" || (noOneCanAct && state.stage !== "finished")) {
  // run out remaining streets immediately, then showdown (04 §4 auto-deal)
  while (state.board.length < 5) {
   const remaining = 5 - state.board.length;
   const take = state.stage === "preflop" ? Math.min(3, remaining) : 1;
   dealStreet(state, take);
   state.stage = state.board.length >= 5 ? "river" : state.board.length >= 4 ? "turn" : "flop";
  }
  state.stage = "finished";
  state.turnSeat = -1;
  finishHand(state);
  return state;
 }
 if (state.stage === "preflop") {
  dealStreet(state, 3);
  state.stage = "flop";
 } else if (state.stage === "flop") {
  dealStreet(state, 1);
  state.stage = "turn";
 } else if (state.stage === "turn") {
  dealStreet(state, 1);
  state.stage = "river";
 }
 const first = nextActorSeat(state.players, state.buttonSeat, 0);
 state.turnSeat = first;
 if (first === -1) {
  // nobody to act: immediately keep running out
  return advanceStreetIfNeeded(state);
 }
 return state;
}

/**
 * Apply one action (04 §5). `actorUserId` must be the player whose turn it
 * is; the shell checks the session/user mapping before calling.
 */
export function applyAction(state: HandState, actorUserId: string, action: ActionData): HandState {
 const next = copyState(state);
 const actor = next.players.find((p) => p.userId === actorUserId);
 if (!actor) {
  throw { code: "ILLEGAL_ACTION", data: { reason: "not a participant" } };
 }
 if (actor.seatIndex !== next.turnSeat) {
  throw { code: "ILLEGAL_ACTION", data: { reason: "not your turn" } };
 }
 if (actor.status !== "active") {
  throw { code: "ILLEGAL_ACTION", data: { reason: "cannot act" } };
 }

 const toCall = next.currentBet - actor.betStreet;
 const stack = actor.stack;

 const commit = (amount: number): void => {
  const n = Math.min(Math.max(0, amount), stack);
  actor.stack -= n;
  actor.betTotal += n;
  actor.betStreet += n;
  next.lastAction = { userId: actor.userId, action: action.kind, amount };
  if (actor.stack === 0) {
   actor.status = "allIn";
  }
 };

 switch (action.kind) {
  case "fold": {
   actor.status = "folded";
   next.lastAction = { userId: actor.userId, action: "fold" };
   break;
  }
  case "check": {
   if (toCall > 0) {
    throw { code: "ILLEGAL_ACTION", data: { reason: "cannot check while facing a bet" } };
   }
   next.lastAction = { userId: actor.userId, action: "check" };
   actor.hasActed = true;
   break;
  }
  case "call": {
   if (toCall <= 0) {
    throw { code: "ILLEGAL_ACTION", data: { reason: "nothing to call" } };
   }
   commit(Math.min(toCall, stack));
   actor.hasActed = true;
   break;
  }
  case "raiseTo": {
   const amount = action.amount ?? -1;
   const minRaiseTo = next.currentBet === 0 ? next.minRaise : next.currentBet + next.minRaise;
   const maxRaiseTo = actor.betStreet + stack;
    // legal: any raise >= minimum; below-minimum only as an all-in (04 §5),
    // which may also be an all-in call/completion at or below the current level.
    if (amount > maxRaiseTo || (amount < minRaiseTo && amount !== maxRaiseTo)) {
     throw { code: "ILLEGAL_ACTION", data: { reason: `raiseTo ${amount} outside legal range` } };
    }
    commit(amount - actor.betStreet);
    const fullRaise = amount - next.currentBet >= next.minRaise;
    if (fullRaise) {
     next.minRaise = amount - next.currentBet;
     for (const p of next.players) {
      if (p !== actor && p.status === "active") {
       p.hasActed = false;
      }
     }
    }
    if (amount > next.currentBet) {
     next.currentBet = amount;
    }
   actor.hasActed = true;
   break;
  }
  case "allIn": {
   if (stack <= 0) {
    throw { code: "ILLEGAL_ACTION", data: { reason: "no chips to push" } };
   }
   const target = actor.betStreet + stack;
   if (target > next.currentBet) {
    const minRaiseTo = next.currentBet === 0 ? next.minRaise : next.currentBet + next.minRaise;
    // an all-in below the minimum raise is legal (short all-in) but does not
    // reopen betting; only a full raise does.
    const fullRaise = target >= minRaiseTo;
    if (fullRaise) {
     next.minRaise = Math.max(1, target - next.currentBet);
     for (const p of next.players) {
      if (p !== actor && p.status === "active") {
       p.hasActed = false;
      }
     }
    }
    commit(stack);
    if (target > next.currentBet) {
     next.currentBet = target;
    }
   } else {
    commit(stack);
   }
   actor.hasActed = true;
   break;
  }
 }
 if (actor.status === "folded") {
  actor.hasActed = false;
 }
 return advanceStreetIfNeeded(next);
}

/** The set of legal actions for `userId` (design 04 legalActions helper). */
export function legalActions(state: HandState, userId: string): ActionData[] {
 const player = state.players.find((p) => p.userId === userId);
 if (!player || state.stage === "finished" || state.stage === "showdown" || player.seatIndex !== state.turnSeat || player.status !== "active") {
  return [];
 }
 const toCall = state.currentBet - player.betStreet;
 const stack = player.stack;
 const out: ActionData[] = [{ kind: "fold" }, { kind: "call" }, { kind: "allIn" }];
  if (toCall === 0) {
    out[1] = { kind: "check" };
  }
 if (stack > 0) {
  const minRaiseTo = state.currentBet === 0 ? state.minRaise : state.currentBet + state.minRaise;
  const maxRaiseTo = player.betStreet + stack;
  if (minRaiseTo <= maxRaiseTo) {
   out.push({ kind: "raiseTo", amount: minRaiseTo });
  }
  if (state.currentBet > 0 && player.betStreet + stack > state.currentBet && player.betStreet + stack < minRaiseTo) {
   // short all-in raise
   out.push({ kind: "raiseTo", amount: maxRaiseTo });
  }
 }
 return out;
}
