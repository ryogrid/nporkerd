// Game flow — the Convex SHELL around the pure engine (`convex/game/engine.ts`).
// Design 04 §3–§8 (rules + timers) and 08 §4 (API surface).
//
// `hands` documents are server-secret (00 §5 / 02 §6): nothing in this module
// ever returns one. `getTableState` is the only window onto them, and it
// projects per-viewer (own cards + showdown reveals only).
//
// This module is deliberately self-contained: it never imports `rooms.ts`
// (that would create a module cycle — `rooms.ts` imports `foldMidHand` from
// here instead, so the graph stays acyclic). Room documents are read/patched
// directly.
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  NEXT_HAND_DELAY_MS,
  OFFLINE_STOOD_UP_MS,
  ROOM_STALE_MS,
  STREET_DEAL_DELAY_MS,
} from "./lib/constants";
import {
  fail,
  ALREADY_PLAYING,
  ILLEGAL_ACTION,
  JOIN_DENIED,
  NOT_ENOUGH_PLAYERS,
  NOT_HOST,
  NOT_IN_HAND,
  NOT_YOUR_TURN,
  ROOM_CLOSED,
  NOT_A_MEMBER,
} from "./lib/errors";
import { requireSession } from "./lib/session";
import { randomInt } from "./lib/rng";
import {
  SEATS,
  ActionData,
  HandPlayer,
  HandState,
  applyAction,
  advanceStreetIfNeeded,
  legalActions,
  startHand,
} from "./game/engine";
import { buildBands } from "./game/pots";

const STAGES: string[] = ["preflop", "flop", "turn", "river", "showdown", "finished"];
const ACTING_STAGES: string[] = ["preflop", "flop", "turn", "river"];

/** `hands.lastAction.kind` literals (schema §6 union). */
const DOC_ACTION_KINDS: string[] = [
  "fold",
  "check",
  "call",
  "raiseTo",
  "allIn",
  "timeout-check",
  "timeout-fold",
];

type DocActionKind =
  | "fold"
  | "check"
  | "call"
  | "raiseTo"
  | "allIn"
  | "timeout-check"
  | "timeout-fold";

function docKindOf(kind: string): DocActionKind {
  if (DOC_ACTION_KINDS.includes(kind)) {
    return kind as DocActionKind;
  }
  throw { code: "INTERNAL_STATE", data: { kind } };
}

function asUserId(userId: string): Id<"users"> {
  return userId as Id<"users">;
}

type TimeoutStat = { userId: Id<"users">; timeouts: number; actions: number };

/** The `hands` fields a state write carries (02 §6, engine→document shape). */
type HandsFields = {
  stage: "preflop" | "flop" | "turn" | "river" | "showdown" | "finished";
  deck: number[];
  board: number[];
  players: Array<{
    userId: Id<"users">;
    seatIndex: number;
    holeCards: number[];
    stackStart: number;
    betStreet: number;
    betTotal: number;
    status: "active" | "folded" | "allIn" | "out";
    hasActed: boolean;
  }>;
  pots: Array<{ amount: number; eligibleUserIds: Array<Id<"users">> }>;
  dealerSeat: number;
  currentTurnSeat: number;
  currentBet: number;
  minRaise: number;
  lastAction?: {
    seatIndex: number;
    kind: DocActionKind;
    amount?: number;
    at: number;
  };
  result?: {
    winners: Array<{ userId: Id<"users">; amount: number; handRankLabel?: string }>;
    revealedUserIds: Array<Id<"users">>;
  };
};

/** Everything a write may additionally set (02 §6 bookkeeping fields). */
type HandsWrite = HandsFields & {
  turnSeq: number;
  timeoutStats: TimeoutStat[];
  finishedAt?: number;
  turnDeadline?: number;
};

// ------------------------------------------------------------------ state <-> doc

/** Hands document → engine `HandState` (02 §6 field names differ slightly). */
function docToState(hand: Doc<"hands">, bigBlind: number): HandState {
  const players = hand.players.map((p): HandPlayer => ({
    userId: p.userId,
    seatIndex: p.seatIndex,
    stackStart: p.stackStart,
    // `stack` is not stored (02 §6): chips behind = start − everything committed.
    stack: p.stackStart - p.betTotal,
    betTotal: p.betTotal,
    betStreet: p.betStreet,
    status: p.status as "active" | "folded" | "allIn",
    hasActed: p.hasActed,
    hole: p.holeCards,
  }));
  const planted = hand.lastAction;
  const lastAction = planted
    ? {
        userId: players.find((p) => p.seatIndex === planted.seatIndex)?.userId ?? "",
        action: planted.kind,
        amount: planted.amount,
      }
    : undefined;
  return {
    id: hand._id,
    handNumber: hand.handNumber,
    buttonSeat: hand.dealerSeat,
    stage: hand.stage,
    deck: hand.deck,
    board: hand.board,
    players,
    currentBet: hand.currentBet,
    minRaise: hand.minRaise,
    // No per-hand blind fields in 02 §6: they come from the immutable room.
    bigBlind,
    ante: 0, // no `ante` room setting in 02 §4 → live blinds only
    turnSeat: hand.currentTurnSeat === undefined || hand.currentTurnSeat === null ? -1 : hand.currentTurnSeat,
    lastAction,
    result: undefined,
  };
}

/** Engine `HandState` → the hands-document fields a write must carry. */
function stateFields(state: HandState, now: number): HandsFields {
  const contributed: Record<string, number> = {};
  const folded: string[] = [];
  for (const p of state.players) {
    if (p.betTotal > 0) {
      contributed[p.userId] = p.betTotal;
    }
    if (p.status === "folded") {
      folded.push(p.userId);
    }
  }
  const bands = buildBands(contributed, folded);
  const fields: HandsFields = {
    stage: state.stage,
    deck: state.deck,
    board: state.board,
    players: state.players.map((p) => ({
      userId: asUserId(p.userId),
      seatIndex: p.seatIndex,
      holeCards: p.hole,
      stackStart: p.stackStart,
      betStreet: p.betStreet,
      betTotal: p.betTotal,
      status: p.status,
      hasActed: p.hasActed,
    })),
    // Recomputed on every write (02 §6 "recomputed whenever bets change").
    pots: bands.map((b) => ({ amount: b.amount, eligibleUserIds: b.eligible.map(asUserId) })),
    dealerSeat: state.buttonSeat,
    // -1 ⇔ no action pending; stored as -1 rather than absent so a patch can
    // always overwrite a previous seat (patch cannot "unset" via omission).
    currentTurnSeat: state.turnSeat,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
  };
  const last = state.lastAction;
  if (last) {
    const seat = state.players.find((p) => p.userId === last.userId);
    fields.lastAction = {
      seatIndex: seat ? seat.seatIndex : -1,
      kind: docKindOf(last.action),
      at: now,
      ...(last.amount === undefined ? {} : { amount: last.amount }),
    };
  }
  const outcome = state.result;
  if (outcome) {
    fields.result = {
      winners: outcome.shares
        .filter((s) => s.chips > 0)
        .map((s) => ({
          userId: asUserId(s.userId),
          amount: s.chips,
          handRankLabel: outcome.handRankLabel,
        })),
      revealedUserIds: outcome.revealedUserIds.map(asUserId),
    };
  }
  return fields;
}

// ------------------------------------------------------------------ shared writes

/** Seat stack mirrors `players[].stack` (+ shares at hand end) (04 §7 crediting). */
async function syncSeatStacks(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  state: HandState,
  now: number,
): Promise<void> {
  const shares: Record<string, number> = {};
  const outcome = state.result;
  if (outcome) {
    for (const s of outcome.shares) {
      shares[s.userId] = (shares[s.userId] ?? 0) + s.chips;
    }
  }
  const seats = await ctx.db
    .query("seats")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();
  for (const seat of seats) {
    const p = state.players.find((x) => x.userId === seat.userId);
    if (!p || p.seatIndex < 0) {
      continue;
    }
    const stack = p.stack + (shares[p.userId] ?? 0);
    if (stack !== seat.stack) {
      await ctx.db.patch("seats", seat._id, { stack, lastSeenAt: now });
    }
  }
}

/**
 * Persist a state change (+1 turnSeq), mirror stacks into seats and re-arm
 * the timers of 04 §8. Returns the new `turnSeq` for scheduled-callback args.
 */
async function persistAndSchedule(
  ctx: MutationCtx,
  hand: Doc<"hands">,
  state: HandState,
  now: number,
  timeoutStats: TimeoutStat[],
): Promise<number> {
  const room = await ctx.db.get("rooms", hand.roomId);
  const turnSeq = hand.turnSeq + 1;
  const fields = stateFields(state, now);
  const patch: HandsWrite = {
    ...fields,
    turnSeq,
    timeoutStats,
  };
  if (state.stage === "finished") {
    patch.finishedAt = now;
    patch.turnDeadline = undefined;
  } else if (state.turnSeat >= 0 && room !== null && room.turnSeconds > 0) {
    patch.turnDeadline = now + room.turnSeconds * 1000;
  } else {
    patch.turnDeadline = undefined;
  }
  await ctx.db.patch("hands", hand._id, patch);
  await syncSeatStacks(ctx, hand.roomId, state, now);
  await scheduleFromState(ctx, hand.roomId, hand._id, state, now, turnSeq, room);
  return turnSeq;
}

/** 04 §8 timer arming: turn clock, runout street step, or the next hand. */
async function scheduleFromState(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  handId: Id<"hands">,
  state: HandState,
  now: number,
  turnSeq: number,
  room: Doc<"rooms"> | null,
): Promise<void> {
  if (room !== null) {
    // every state change counts as activity (02 §4 `lastActivityAt`)
    await ctx.db.patch("rooms", roomId, { lastActivityAt: now });
  }
  if (state.stage === "finished") {
    await ctx.scheduler.runAfter(
      NEXT_HAND_DELAY_MS,
      internal.game.startNextHand,
      { roomId, handId, turnSeq },
    );
    return;
  }
  if (state.turnSeat >= 0) {
    if (room !== null && room.turnSeconds > 0) {
      await ctx.scheduler.runAfter(
        room.turnSeconds * 1000,
        internal.game.handleTurnTimeout,
        { handId, turnSeq },
      );
    }
    return;
  }
  await ctx.scheduler.runAfter(
    STREET_DEAL_DELAY_MS,
    internal.game.advanceStreet,
    { handId, turnSeq },
  );
}

/** Bump the auto-sit-out tally (04 §9) for one participant. */
function bumpStat(
  stats: TimeoutStat[],
  userId: Id<"users">,
  timedOut: boolean,
): TimeoutStat[] {
  const out = stats.map((s) => ({ ...s }));
  const hit = out.find((s) => s.userId === userId);
  if (hit) {
    hit.actions += 1;
    if (timedOut) {
      hit.timeouts += 1;
    }
  } else {
    out.push({ userId, timeouts: timedOut ? 1 : 0, actions: 1 });
  }
  return out;
}

// ------------------------------------------------------------- participants

/** Seats that qualify for the next hand (05 §6 / 04 §3). */
async function qualifyingSeats(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
): Promise<Doc<"seats">[]> {
  const ms = await ctx.db
    .query("seats")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();
  return ms.filter((s) => s.seatIndex >= 0 && s.state === "seated" && s.stack > 0);
}

/** Deal the next hand and arm its first-turn timer (05 §6, 04 §8). */
async function beginHand(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  now: number,
): Promise<Id<"hands"> | null> {
  const room = await ctx.db.get("rooms", roomId);
  if (room === null || room.status !== "playing") {
    return null;
  }
  const seats = await qualifyingSeats(ctx, roomId);
  if (seats.length < 2) {
    return null;
  }
  const prev = room.currentHandId === undefined || room.currentHandId === null
    ? null
    : await ctx.db.get("hands", room.currentHandId);
  const { state } = startHand({
    // The document id is unknown before insert and unused by the engine.
    id: "",
    handNumber: prev === null ? 1 : prev.handNumber + 1,
    prevButtonSeat: prev === null ? -1 : prev.dealerSeat,
    players: seats.map((s) => ({
      userId: s.userId,
      seatIndex: s.seatIndex,
      stack: s.stack,
    })),
    smallBlind: room.smallBlind,
    bigBlind: room.bigBlind,
    ante: 0, // 02 §4 has no ante setting
    randomInt: randomInt, // 04 §2: crypto RNG in production
  });
  const firstTurn = state.turnSeat;
  const handId = await ctx.db.insert("hands", {
    ...stateFields(state, now),
    ...(room.turnSeconds > 0 && firstTurn >= 0
      ? { turnDeadline: now + room.turnSeconds * 1000 }
      : {}),
    roomId,
    handNumber: state.handNumber,
    turnSeq: 0,
    startedAt: now,
    timeoutStats: [] as TimeoutStat[],
  });
  await ctx.db.patch("rooms", roomId, { currentHandId: handId, lastActivityAt: now });
  await syncSeatStacks(ctx, roomId, state, now);
  await scheduleFromState(ctx, roomId, handId, state, now, 0, room);
  return handId;
}

// ------------------------------------------------------------------ public API

/**
 * Host starts the game: room `waiting` → `playing` + hand #1 (05 §6, 08 §4).
 */
export const startGame = mutation({
  args: { sessionToken: v.string(), roomId: v.id("rooms") },
  returns: v.object({ ok: v.boolean(), handNumber: v.number() }),
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);
    const room = await ctx.db.get("rooms", args.roomId);
    if (room === null) {
      fail(JOIN_DENIED);
    }
    if (room.status === "closed") {
      fail(ROOM_CLOSED);
    }
    if (room.hostId !== user._id) {
      fail(NOT_HOST);
    }
    if (room.status === "playing") {
      fail(ALREADY_PLAYING);
    }
    if ((await qualifyingSeats(ctx, args.roomId)).length < 2) {
      fail(NOT_ENOUGH_PLAYERS);
    }
    const now = Date.now();
    await ctx.db.patch("rooms", args.roomId, { status: "playing", lastActivityAt: now });
    const handId = await beginHand(ctx, args.roomId, now);
    if (handId === null) {
      // race-free safety net: a concurrent start already flipped the room
      fail(NOT_ENOUGH_PLAYERS);
    }
    const hand = await ctx.db.get("hands", handId);
    return { ok: true, handNumber: hand === null ? 1 : hand.handNumber };
  },
});

/**
 * One poker action (04 §5, 08 §4): the engine reducer does all rules work;
 * the shell maps engine rejections onto the 08 error codes and re-arms timers.
 */
export const act = mutation({
  args: {
    sessionToken: v.string(),
    roomId: v.id("rooms"),
    kind: v.union(
      v.literal("fold"),
      v.literal("check"),
      v.literal("call"),
      v.literal("raiseTo"),
      v.literal("allIn"),
    ),
    amount: v.optional(v.number()),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);
    const room = await ctx.db.get("rooms", args.roomId);
    if (room === null) {
      fail(JOIN_DENIED);
    }
    const hand =
      room.currentHandId === undefined || room.currentHandId === null
        ? null
        : await ctx.db.get("hands", room.currentHandId);
    if (hand === null || hand.stage === "finished") {
      fail(NOT_IN_HAND);
    }
    const state = docToState(hand, room.bigBlind);
    const me = state.players.find((p) => p.userId === user._id);
    if (me === undefined) {
      fail(NOT_IN_HAND);
    }
    if (state.turnSeat !== me.seatIndex) {
      fail(NOT_YOUR_TURN);
    }
    if (args.kind === "raiseTo" && args.amount === undefined) {
      fail(ILLEGAL_ACTION, { reason: "raiseTo needs an amount" });
    }
    if (args.kind === "raiseTo" && (!Number.isInteger(args.amount) || (args.amount as number) < 0)) {
      fail(ILLEGAL_ACTION, { reason: "raiseTo amount must be a non-negative integer" });
    }
    let next: HandState;
    try {
      next = applyAction(state, user._id, { kind: args.kind, amount: args.amount } as ActionData);
    } catch (e) {
      const reason = (e as { data?: { reason?: string } }).data?.reason ?? "action rejected";
      // the engine's own turn check stays 08's NOT_YOUR_TURN
      if (reason === "not your turn" || reason === "cannot act") {
        fail(NOT_YOUR_TURN, { reason });
      }
      fail(ILLEGAL_ACTION, { reason });
    }
    await persistAndSchedule(ctx, hand, next, Date.now(), bumpStat(hand.timeoutStats, user._id, false));
    return { ok: true };
  },
});

// ------------------------------------------------------------------ projection

/**
 * The ONLY window onto a `hands` document (00 §5 / 08 §4): per-viewer,
 * never the deck, opponent hole cards only at showdown reveals.
 */
export const getTableState = query({
  args: { sessionToken: v.string(), roomId: v.id("rooms") },
  returns: v.object({
    roomId: v.id("rooms"),
    stage: v.union(
      v.literal("waiting"),
      v.literal("preflop"),
      v.literal("flop"),
      v.literal("turn"),
      v.literal("river"),
      v.literal("showdown"),
      v.literal("finished"),
    ),
    handNumber: v.optional(v.number()),
    board: v.array(v.number()),
    pots: v.array(v.object({ amount: v.number() })),
    dealerSeat: v.optional(v.number()),
    currentTurnSeat: v.optional(v.number()),
    turnDeadline: v.optional(v.number()),
    yourTurn: v.boolean(),
    legal: v.optional(
      v.object({
        canCheck: v.boolean(),
        canCall: v.boolean(),
        callAmount: v.number(),
        minRaiseTo: v.number(),
        maxRaiseTo: v.number(),
        toCall: v.number(),
      }),
    ),
    seats: v.array(
      v.object({
        seatIndex: v.number(),
        userId: v.id("users"),
        username: v.string(),
        stack: v.number(),
        betStreet: v.number(),
        inHand: v.boolean(),
        folded: v.boolean(),
        allIn: v.boolean(),
        isDealer: v.boolean(),
        isCurrentTurn: v.boolean(),
        holeCards: v.optional(v.array(v.number())),
        lastAction: v.optional(
          v.object({
            kind: v.union(
              v.literal("fold"),
              v.literal("check"),
              v.literal("call"),
              v.literal("raiseTo"),
              v.literal("allIn"),
              v.literal("timeout-check"),
              v.literal("timeout-fold"),
            ),
            amount: v.optional(v.number()),
          }),
        ),
      }),
    ),
    lastHandResult: v.optional(
      v.object({
        winners: v.array(
          v.object({
            username: v.string(),
            amount: v.number(),
            handRankLabel: v.optional(v.string()),
          }),
        ),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);
    const room = await ctx.db.get("rooms", args.roomId);
    if (room === null) {
      fail(JOIN_DENIED);
    }
    if (room.status === "closed") {
      fail(ROOM_CLOSED);
    }
    const ms = await ctx.db
      .query("seats")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();
    const mine = ms.find((s) => s.userId === user._id);
    if (mine === null || mine === undefined) {
      fail(NOT_A_MEMBER);
    }

    // The room's current hand (secret) — projected, never returned as-is.
    const handDoc =
      room.currentHandId === undefined || room.currentHandId === null
        ? null
        : await ctx.db.get("hands", room.currentHandId);
    const handLive = handDoc !== null && handDoc.stage !== "finished";

    // The hand whose result may be shown (08 §4 `lastHandResult`).
    let resultHand: Doc<"hands"> | null = null;
    if (handDoc !== null && handDoc.stage === "finished") {
      resultHand = handDoc;
    } else if (handDoc !== null) {
      const recent = await ctx.db
        .query("hands")
        .withIndex("by_room_handNumber", (q) => q.eq("roomId", args.roomId))
        .order("desc")
        .take(3);
      for (const h of recent) {
        if (h.stage === "finished" && h._id !== handDoc._id) {
          resultHand = h;
          break;
        }
      }
    }

    const state = handDoc === null ? null : docToState(handDoc, room.bigBlind);
    const participants = state === null ? [] : state.players;
    const revealedIds = resultHand === null ? [] : resultHand.result?.revealedUserIds ?? [];
    const currentTurnSeat =
      handDoc === null || handDoc.currentTurnSeat === undefined || handDoc.currentTurnSeat === null
        ? -1
        : handDoc.currentTurnSeat;

    const seatViews = [];
    for (const seat of ms) {
      if (seat.seatIndex < 0) {
        continue; // member but not at the table (05 §3)
      }
      const person = await ctx.db.get("users", seat.userId);
      const p = participants.find((x) => x.userId === seat.userId);
      const own = p !== undefined && seat.userId === user._id;
      // 00 §5: opponents' cards appear only for showdown-revealed players.
      const revealed = p !== undefined && revealedIds.some((r) => r === seat.userId);
      seatViews.push({
        seatIndex: seat.seatIndex,
        userId: seat.userId,
        username: person === null ? "" : person.username,
        stack: seat.stack,
        betStreet: p === undefined ? 0 : p.betStreet,
        inHand: p !== undefined && p.status !== "folded",
        folded: p !== undefined && p.status === "folded",
        allIn: p !== undefined && p.status === "allIn",
        isDealer: handDoc !== null && handDoc.dealerSeat === seat.seatIndex,
        isCurrentTurn: currentTurnSeat === seat.seatIndex,
        holeCards: p === undefined || (!own && !revealed)
          ? undefined
          : p.hole,
        lastAction:
          handDoc === null || handDoc.lastAction === undefined || handDoc.lastAction === null ||
            handDoc.lastAction.seatIndex !== seat.seatIndex
            ? undefined
            : {
                kind: handDoc.lastAction.kind,
                ...(handDoc.lastAction.amount === undefined || handDoc.lastAction.amount === null
                  ? {}
                  : { amount: handDoc.lastAction.amount }),
              },
      });
    }
    // Same ordering as `rooms.getRoom` seats (08 §4 "aligned with").
    seatViews.sort((a, b) => b.seatIndex - a.seatIndex);

    // `legal` is computed here (not by the engine): the 08 §4 block needs the
    // raise range, which `legalActions` deliberately does not enumerate.
    let legal: {
      canCheck: boolean;
      canCall: boolean;
      callAmount: number;
      minRaiseTo: number;
      maxRaiseTo: number;
      toCall: number;
    } | undefined = undefined;
    let yourTurn = false;
    const me = state === null ? undefined : state.players.find((p) => p.userId === user._id);
    if (handLive && state !== null && me !== undefined && me.seatIndex === currentTurnSeat && me.status === "active") {
      yourTurn = true;
      const toCall = state.currentBet - me.betStreet;
      const minRaiseTo = state.currentBet === 0 ? state.minRaise : state.currentBet + state.minRaise;
      const maxRaiseTo = me.betStreet + me.stack;
      legal = {
        canCheck: toCall === 0,
        canCall: toCall > 0 && me.stack > 0,
        callAmount: Math.min(toCall, me.stack),
        minRaiseTo,
        maxRaiseTo,
        toCall,
      };
    }

    let lastHandResult = undefined;
    if (resultHand !== null && resultHand.result !== undefined && resultHand.result !== null) {
      const winners = [];
      for (const w of resultHand.result.winners) {
        const winner = await ctx.db.get("users", w.userId);
        winners.push({
          username: winner === null ? "" : winner.username,
          amount: w.amount,
          ...(w.handRankLabel === undefined || w.handRankLabel === null ? {} : { handRankLabel: w.handRankLabel }),
        });
      }
      lastHandResult = { winners };
    }

    const stage: "waiting" | "preflop" | "flop" | "turn" | "river" | "showdown" | "finished" =
      handDoc === null || (room.status === "waiting" && handDoc.stage === "finished")
        ? "waiting"
        : handDoc.stage;

    return {
      roomId: args.roomId,
      stage,
      ...(handDoc === null ? {} : { handNumber: handDoc.handNumber }),
      board: handDoc === null ? [] : handDoc.board,
      // 08 §4: amounts only; eligibility never crosses the projection.
      pots: handDoc === null ? [] : handDoc.pots.map((p2) => ({ amount: p2.amount })),
      ...(handDoc === null ? {} : { dealerSeat: handDoc.dealerSeat }),
      ...(handLive && currentTurnSeat >= 0 ? { currentTurnSeat } : {}),
      ...(handLive && handDoc.turnDeadline !== undefined && handDoc.turnDeadline !== null
        ? { turnDeadline: handDoc.turnDeadline }
        : {}),
      yourTurn,
      ...(legal === undefined ? {} : { legal }),
      seats: seatViews,
      ...(lastHandResult === undefined ? {} : { lastHandResult }),
    };
  },
});

/** Seat document of (room, user), or null. */
async function seatOf(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  userId: Id<"users">,
): Promise<Doc<"seats"> | null> {
  const found = await ctx.db
    .query("seats")
    .withIndex("by_room_user", (q) => q.eq("roomId", roomId))
    .filter((q) => q.eq(q.field("userId"), userId))
    .first();
  return found;
}

// ------------------------------------------------------------ internals (08 §4)

/**
 * Deal a hand for a room that is (still) `playing` with ≥ 2 qualifying seats.
 * Shared by `startGame` and `startNextHand` (05 §6 "the same internal path").
 */
export const startHandInternal = internalMutation({
  args: { roomId: v.id("rooms") },
  returns: v.object({ handId: v.optional(v.id("hands")) }),
  handler: async (ctx, args) => {
    const handId = await beginHand(ctx, args.roomId, Date.now());
    return { handId: handId === null ? undefined : handId };
  },
});

/**
 * Turn clock fired (04 §8): stale callbacks no-op via the `(handId, turnSeq)`
 * guard; otherwise check-if-free-else-fold through the engine path, tagged
 * `timeout-check` / `timeout-fold` for the UI.
 */
export const handleTurnTimeout = internalMutation({
  args: { handId: v.id("hands"), turnSeq: v.number() },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args) => {
    const hand = await ctx.db.get("hands", args.handId);
    if (hand === null || hand.turnSeq !== args.turnSeq) {
      return { applied: false };
    }
    const room = await ctx.db.get("rooms", hand.roomId);
    if (room === null || room.status !== "playing") {
      return { applied: false };
    }
    const state = docToState(hand, room.bigBlind);
    if (!ACTING_STAGES.includes(state.stage) || state.turnSeat < 0) {
      return { applied: false };
    }
    const actor = state.players.find((p) => p.seatIndex === state.turnSeat);
    if (actor === undefined) {
      return { applied: false };
    }
    const toCall = state.currentBet - actor.betStreet;
    const timedOut = toCall !== 0;
    const next = applyAction(state, actor.userId, {
      kind: timedOut ? "fold" as const : "check" as const,
    } as ActionData);
    // 04 §8: the UI shows which kind of timeout happened
    if (next.lastAction) {
      next.lastAction = { ...next.lastAction, action: timedOut ? "timeout-fold" : "timeout-check" };
    }
    await persistAndSchedule(
      ctx,
      hand,
      next,
      Date.now(),
      bumpStat(hand.timeoutStats, asUserId(actor.userId), true),
    );
    return { applied: true };
  },
});

/**
 * One street of an all-in runout (04 §8, STREET_DEAL_DELAY_MS pacing): deal
 * exactly one street per scheduled step so players can see each street; the
 * write re-arms another step while no actor remains.
 */
export const advanceStreet = internalMutation({
  args: { handId: v.id("hands"), turnSeq: v.number() },
  returns: v.object({ stage: v.string() }),
  handler: async (ctx, args) => {
    const hand = await ctx.db.get("hands", args.handId);
    if (hand === null || hand.turnSeq !== args.turnSeq) {
      return { stage: "stale" };
    }
    const room = await ctx.db.get("rooms", hand.roomId);
    if (room === null || STAGES.includes(hand.stage) === false || hand.stage === "finished") {
      return { stage: "finished" };
    }
    const state = docToState(hand, room.bigBlind);
    const next = advanceStreetIfNeeded(state);
    const turnSeq = await persistAndSchedule(ctx, hand, next, Date.now(), hand.timeoutStats);
    return { stage: `${next.stage}:${turnSeq}` };
  },
});

/**
 * 5 s after a hand finished (04 §8): auto-sit-out the chronically-timed-out,
 * then deal the next hand while conditions hold; else room → `waiting` (05 §6).
 */
export const startNextHand = internalMutation({
  args: { roomId: v.id("rooms"), handId: v.id("hands"), turnSeq: v.number() },
  returns: v.object({ started: v.boolean() }),
  handler: async (ctx, args) => {
    const room = await ctx.db.get("rooms", args.roomId);
    // (roomId, handId) guard + "room still playing" (08 §4)
    if (room === null || room.status !== "playing" || room.currentHandId !== args.handId) {
      return { started: false };
    }
    const prev = await ctx.db.get("hands", args.handId);
    if (prev === null || prev.turnSeq !== args.turnSeq || prev.stage !== "finished") {
      return { started: false };
    }
    // 04 §9 auto-sit-out: every action of that hand timed out
    for (const stat of prev.timeoutStats) {
      if (stat.timeouts > 0 && stat.timeouts >= stat.actions) {
        const seat = await seatOf(ctx, args.roomId, stat.userId);
        if (seat !== null && seat.seatIndex >= 0 && seat.state === "seated") {
          await ctx.db.patch("seats", seat._id, { state: "sittingOut" });
        }
      }
    }
    const now = Date.now();
    const handId = await beginHand(ctx, args.roomId, now);
    if (handId === null) {
      await ctx.db.patch("rooms", args.roomId, { status: "waiting", lastActivityAt: now });
      return { started: false };
    }
    return { started: true };
  },
});

// ------------------------------------------------------------------ cleanup (05 §8)

/** What the hourly sweep found (read side of `cleanupExpired`). */
export const sweepForCleanup = internalQuery({
  args: {},
  returns: v.object({
    now: v.number(),
    sessionIds: v.array(v.id("sessions")),
    challengeIds: v.array(v.id("loginChallenges")),
    staleRoomIds: v.array(v.id("rooms")),
  }),
  handler: async (ctx, _args) => {
    const now = Date.now();
    const expiredSessions = await ctx.db
      .query("sessions")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", now))
      .collect();
    const expiredChallenges = await ctx.db
      .query("loginChallenges")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", now))
      .collect();
    const staleRooms = await ctx.db
      .query("rooms")
      .withIndex("by_lastActivityAt", (q) => q.lt("lastActivityAt", now - ROOM_STALE_MS))
      .filter((q) => q.eq(q.field("status"), "waiting"))
      .take(50);
    return {
      now,
      sessionIds: expiredSessions.map((s) => s._id),
      challengeIds: expiredChallenges.map((c) => c._id),
      staleRoomIds: staleRooms.map((r) => r._id),
    };
  },
});

/** Hourly cron (08 §7): sweep, then delegate to internal mutations (05 §8). */
export const cleanupExpired = internalAction({
  args: {},
  returns: v.object({ purged: v.number(), closedRooms: v.number(), stoodUp: v.number() }),
  handler: async (ctx, _args): Promise<{ purged: number; closedRooms: number; stoodUp: number }> => {
    // Annotated: referencing this module's own functions through `internal`
    // is circular for inference, so the handler states its own types.
    const found: {
      now: number;
      sessionIds: Array<Id<"sessions">>;
      challengeIds: Array<Id<"loginChallenges">>;
      staleRoomIds: Array<Id<"rooms">>;
    } = await ctx.runQuery(internal.game.sweepForCleanup, {});
    let purged = 0;
    if (found.sessionIds.length > 0 || found.challengeIds.length > 0) {
      const done: { deleted: number } = await ctx.runMutation(
        internal.game.purgeEphemeral,
        { sessionIds: found.sessionIds, challengeIds: found.challengeIds },
      );
      purged = done.deleted;
    }
    let closedRooms = 0;
    for (const roomId of found.staleRoomIds) {
      const res: { closed: boolean } = await ctx.runMutation(internal.game.closeStaleRoom, { roomId });
      if (res.closed) {
        closedRooms += 1;
      }
    }
    const stoodUpRes: { stoodUp: number } = await ctx.runMutation(
      internal.game.standUpIdleSeats,
      { now: found.now },
    );
    return {
      purged,
      closedRooms,
      stoodUp: stoodUpRes.stoodUp,
    };
  },
});

/** Delete expired session/login-challenge documents (03 §5). */
export const purgeEphemeral = internalMutation({
  args: {
    sessionIds: v.array(v.id("sessions")),
    challengeIds: v.array(v.id("loginChallenges")),
  },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    let deleted = 0;
    for (const id of args.sessionIds) {
      await ctx.db.delete("sessions", id);
      deleted += 1;
    }
    for (const id of args.challengeIds) {
      await ctx.db.delete("loginChallenges", id);
      deleted += 1;
    }
    return { deleted };
  },
});

/** Cron close of a stale room: cash out seated members (05 §5 semantics). */
export const closeStaleRoom = internalMutation({
  args: { roomId: v.id("rooms") },
  returns: v.object({ closed: v.boolean() }),
  handler: async (ctx, args) => {
    const room = await ctx.db.get("rooms", args.roomId);
    if (room === null || room.status !== "waiting") {
      return { closed: false };
    }
    const now = Date.now();
    const ms = await ctx.db
      .query("seats")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .collect();
    for (const seat of ms) {
      if (seat.seatIndex >= 0 && seat.state !== "left") {
        const person = await ctx.db.get("users", seat.userId);
        if (person !== null) {
          await ctx.db.patch("users", seat.userId, { balance: person.balance + seat.stack });
        }
        await ctx.db.patch("seats", seat._id, { seatIndex: -1, stack: 0, state: "left" });
      }
    }
    await ctx.db.patch("rooms", args.roomId, { status: "closed", closedAt: now, lastActivityAt: now });
    return { closed: true };
  },
});

/** 05 §8: cash out `seated` players offline > OFFLINE_STOOD_UP_MS. */
export const standUpIdleSeats = internalMutation({
  args: { now: v.number() },
  returns: v.object({ stoodUp: v.number() }),
  handler: async (ctx, args) => {
    let stoodUp = 0;
    // The cron skips `playing` rooms: hands auto-sit players out per 04 §9.
    const waitingRooms = await ctx.db
      .query("rooms")
      .withIndex("by_status_visibility", (q) => q.eq("status", "waiting"))
      .collect();
    {
      const rooms = waitingRooms;
      for (const room of rooms) {
        const ms = await ctx.db
          .query("seats")
          .withIndex("by_room", (q) => q.eq("roomId", room._id))
          .collect();
        for (const seat of ms) {
          if (seat.seatIndex < 0 || seat.state !== "seated") {
            continue;
          }
          const person = await ctx.db.get("users", seat.userId);
          if (person === null) {
            continue;
          }
          if (args.now - person.lastSeenAt > OFFLINE_STOOD_UP_MS) {
            await ctx.db.patch("users", seat.userId, { balance: person.balance + seat.stack });
            await ctx.db.patch("seats", seat._id, { seatIndex: -1, stack: 0, state: "left" });
            stoodUp += 1;
          }
        }
      }
    }
    return { stoodUp };
  },
});

// ------------------------------------------------- mid-hand stand-up (05 §4)

/**
 * 04 §9 / 05 §4: a player standing up or leaving during a live hand is folded
 * through the engine, then the shell writes the state (which keeps `seat.stack`
 * at the uncommitted part — committed chips stay in the pot). Used by
 * `rooms.standUp` / `rooms.leaveRoom`; not turn-gated (unlike `applyAction`),
 * because the player may stand up while it is someone else's turn.
 */
export async function foldMidHand(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  userId: Id<"users">,
): Promise<boolean> {
  const room = await ctx.db.get("rooms", roomId);
  if (room === null || room.currentHandId === undefined || room.currentHandId === null) {
    return false;
  }
  const hand = await ctx.db.get("hands", room.currentHandId);
  if (hand === null || hand.stage === "finished") {
    return false;
  }
  const state = docToState(hand, room.bigBlind);
  const me = state.players.find((p) => p.userId === userId);
  if (me === undefined || me.status === "folded") {
    return false;
  }
  // fold outside the turn cycle: mutate the participant, then let the reducer
  // finish the street/hand as if the action had been taken.
  const foldedPlayers = state.players.map((p) =>
    p.userId === userId
      ? { ...p, status: "folded" as "active" | "folded" | "allIn", hasActed: true }
      : { ...p },
  );
  const folded: HandState = {
    ...state,
    players: foldedPlayers,
    lastAction: { userId, action: "fold" },
  };
  const next = advanceStreetIfNeeded(folded);
  await persistAndSchedule(ctx, hand, next, Date.now(), bumpStat(hand.timeoutStats, userId, false));
  return true;
}
