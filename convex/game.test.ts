// Phase 5 acceptance tests — hands driven only through public mutations
// (`game.startGame` + `game.act`), the turn clock firing when actions are
// withheld (04 §8), all-in runout pacing, next-hand continuation with the
// auto-sit-out rule (04 §9), concurrent `act` calls (04 §9 "simultaneously")
// and the projection security invariants (00 §5 / 08 §4).
import { describe, it, expect } from "vitest";
import { api, internal } from "./_generated/api";
import { convexTest } from "convex-test";
import schema from "./schema";
import { vi } from "vitest";
import {
  NEXT_HAND_DELAY_MS,
  OFFLINE_STOOD_UP_MS,
  ROOM_STALE_MS,
  SESSION_TTL_MS,
  STREET_DEAL_DELAY_MS,
  FAUCET_AMOUNT,
} from "./lib/constants";
import { errorCodes } from "./lib/errors";
import { sha256Hex } from "./lib/hash";

const modules = import.meta.glob("./**/*.ts");

function errorCodeOf(e: unknown): string {
  const data = (e as { data?: unknown }).data;
  if (typeof data === "object" && typeof (data as { code?: string }).code === "string") {
    return (data as { code: string }).code;
  }
  return String(e);
}

async function expectError(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
    expect(code).toBe("did not throw");
  } catch (e) {
    expect(errorCodeOf(e)).toContain(code);
  }
}

describe("game", () => {
  const t = convexTest(schema, modules);

  async function seedUser(username: string, balance: number, token: string) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const uid = await ctx.db.insert("users", {
        username,
        usernameLower: username.toLowerCase(),
        publicKey: "pk-placeholder",
        balance,
        createdAt: now,
        lastSeenAt: now,
      });
      await ctx.db.insert("sessions", {
        userId: uid,
        tokenHash: await sha256Hex(token),
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS,
      });
      return uid;
    });
  }

  async function userBalance(userId: any) {
    return await t.run(async (ctx) => (await ctx.db.get("users", userId))?.balance ?? -1);
  }

  async function seatStacks(roomId: any) {
    return await t.run(async (ctx) => {
      const ms = await ctx.db.query("seats").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
      return ms.filter((s) => s.seatIndex >= 0).map((s) => s.stack);
    });
  }

  async function handDoc(roomId: any) {
    return await t.run(async (ctx) => {
      const room = await ctx.db.get("rooms", roomId);
      if (room === null || room.currentHandId === undefined) {
        return null;
      }
      return await ctx.db.get("hands", room.currentHandId);
    });
  }

  // A table with two seated players; defaults are SB 10 / BB 20 / buyIn 1000.
  async function twoSeats(tag: string, turnSeconds: number) {
    const a = await seedUser(`A${tag}`, 5000, `tok_a_${tag}`);
    const b = await seedUser(`B${tag}`, 5000, `tok_b_${tag}`);
    const room = await t.mutation(
      api.rooms.createRoom,
      { sessionToken: `tok_a_${tag}`, name: `Room ${tag}`, turnSeconds },
    );
    await t.mutation(api.rooms.sitDown, { sessionToken: `tok_a_${tag}`, roomId: room.roomId, seatIndex: 0 });
    await t.mutation(api.rooms.sitDown, { sessionToken: `tok_b_${tag}`, roomId: room.roomId, seatIndex: 1 });
    return { a, b, roomId: room.roomId };
  }

  // --------------------------------------------------------------------- 1

  it("scripted heads-up hand runs preflop to showdown through public mutations only", async () => {
    const table = await twoSeats("script", 0); // clock off: nothing else acts
    const started = await t.mutation(api.game.startGame, { sessionToken: "tok_a_script", roomId: table.roomId });
    expect(started.ok).toBe(true);

    let view = await t.query(api.game.getTableState, { sessionToken: "tok_a_script", roomId: table.roomId });
    expect(view.stage).toBe("preflop");
    expect(view.handNumber).toBe(1);
    expect(view.board).toEqual([]);
    // heads-up: the button (seat 0) posts the small blind and acts first (04 §3)
    expect(view.yourTurn).toBe(true);
    expect(view.legal!.toCall).toBe(10);
    expect(view.legal!.canCall).toBe(true);
    expect(view.legal!.canCheck).toBe(false);
    expect(view.legal!.minRaiseTo).toBe(40);
    expect(view.legal!.maxRaiseTo).toBe(1000);

    await t.mutation(api.game.act, { sessionToken: "tok_a_script", roomId: table.roomId, kind: "call" });
    // the BB checks: matched, so the street is over (04 §5)
    await t.mutation(api.game.act, { sessionToken: "tok_b_script", roomId: table.roomId, kind: "check" });
    view = await t.query(api.game.getTableState, { sessionToken: "tok_a_script", roomId: table.roomId });
    expect(view.stage).toBe("flop");
    expect(view.board.length).toBe(3);
    // postflop the first actor is left of the button (seat 1)
    expect(view.currentTurnSeat).toBe(1);

    for (const token of ["tok_b_script", "tok_a_script", "tok_b_script", "tok_a_script", "tok_b_script", "tok_a_script"]) {
      await t.mutation(api.game.act, { sessionToken: token, roomId: table.roomId, kind: "check" });
    }
    view = await t.query(api.game.getTableState, { sessionToken: "tok_a_script", roomId: table.roomId });
    expect(view.stage).toBe("finished");
    expect(view.board.length).toBe(5);
    expect(view.yourTurn).toBe(false);
    // chip conservation across the hand (04 §7 invariant): the winner is
    // credited the whole pot into their seat stack
    const stacks = await seatStacks(table.roomId);
    expect(stacks.reduce((acc, n) => acc + n, 0)).toBe(2000);
    expect(stacks).not.toEqual([1000, 1000]);
    const winners = view.lastHandResult!.winners;
    expect(winners.length >= 1).toBe(true);
    const total = winners.reduce((acc, w) => acc + w.amount, 0);
    expect(total).toBe(40);
    const hand = await handDoc(table.roomId);
    expect(hand!.finishedAt === null || hand!.finishedAt === undefined).toBe(false);
    // both players' cards were revealed at showdown
    const both = await t.query(api.game.getTableState, { sessionToken: "tok_b_script", roomId: table.roomId });
    for (const s of both.seats) {
      expect(s.holeCards === undefined || s.holeCards === null).toBe(false);
      expect((s.holeCards as number[]).length).toBe(2);
    }
  });

  // --------------------------------------------------------------------- 2

  it("the game continues 5 s after a hand finishes (04 §8, 05 §6)", async () => {
    const table = await twoSeats("next", 0);
    // fake clock from the start: scheduled callbacks must sit on it
    vi.useFakeTimers();
    await t.mutation(api.game.startGame, { sessionToken: "tok_a_next", roomId: table.roomId });
    const first = await handDoc(table.roomId);
    expect(first!.stage).toBe("preflop");
    expect(first!.dealerSeat).toBe(0);
    // SB (seat 0 = button) calls, BB checks; then check every street down
    await t.mutation(api.game.act, { sessionToken: "tok_a_next", roomId: table.roomId, kind: "call" });
    await t.mutation(api.game.act, { sessionToken: "tok_b_next", roomId: table.roomId, kind: "check" });
    for (const token of ["tok_b_next", "tok_a_next", "tok_b_next", "tok_a_next", "tok_b_next", "tok_a_next"]) {
      await t.mutation(api.game.act, { sessionToken: token, roomId: table.roomId, kind: "check" });
    }
    const before = await handDoc(table.roomId);
    expect(before!.stage).toBe("finished");

    vi.advanceTimersByTime(NEXT_HAND_DELAY_MS);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();

    const second = await handDoc(table.roomId);
    expect(second!.handNumber).toBe(2);
    expect(second!.stage).not.toBe("finished");
    // button alternates heads-up (04 §3 rotation)
    expect(second!.dealerSeat).toBe(1);
    // stacks credited before the new blinds were posted
    // chips are conserved: seat stacks + what the new hand has committed
    const stacks = await seatStacks(table.roomId);
    const committed = second!.players.reduce((acc, p) => acc + p.betTotal, 0);
    expect(stacks.reduce((acc, n) => acc + n, 0) + committed).toBe(2000);
  });

  // --------------------------------------------------------------------- 3

  it("a withheld clock folds a facing bet, tallies the timeout and auto-sits out (04 §8–§9)", async () => {
    const table = await twoSeats("clock", 10);
    vi.useFakeTimers();
    await t.mutation(api.game.startGame, { sessionToken: "tok_a_clock", roomId: table.roomId });
    vi.advanceTimersByTime(10_500);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();

    const hand = await handDoc(table.roomId);
    // heads-up: the button/SB is first to act and faces the big blind ⇒ folds
    expect(hand!.stage).toBe("finished");
    expect(hand!.turnSeq).toBe(1);
    expect(hand!.lastAction!.kind).toBe("timeout-fold");
    expect(hand!.currentTurnSeat).toBe(-1);
    // 04 §9 tally: every action of the hand timed out
    expect(hand!.timeoutStats.some((s) => s.timeouts === 1 && s.actions === 1)).toBe(true);
    // chips conserved across seat stacks + committed chips
    const stacks = await seatStacks(table.roomId);
    expect(stacks.reduce((acc, n) => acc + n, 0)).toBe(2000);

    // 04 §9 auto-sit-out: that player is `sittingOut` before the next deal
    const sitStates = await t.run(async (ctx) => {
      const ms = await ctx.db
        .query("seats")
        .withIndex("by_room", (q) => q.eq("roomId", table.roomId))
        .collect();
      return ms.map((s) => s.state);
    });
    expect(sitStates.filter((x) => x === "sittingOut").length).toBe(1);
    // 05 §6: a hand boundary with < 2 qualifying players returns the room
    const roomDoc = await t.run(async (ctx) => await ctx.db.get("rooms", table.roomId));
    expect(roomDoc?.status).toBe("waiting");

    // the (handId, turnSeq) guard: an out-of-date callback no-ops
    const stale = await t.mutation(
      internal.game.handleTurnTimeout,
      { handId: hand!._id, turnSeq: hand!.turnSeq + 5 },
    );
    expect((stale as { applied: boolean }).applied).toBe(false);
  });

  // --------------------------------------------------------------------- 4

  it("an all-in runout is paced one STREET_DEAL_DELAY_MS per street (04 §8)", async () => {
    const table = await twoSeats("runout", 0);
    vi.useFakeTimers();
    await t.mutation(api.game.startGame, { sessionToken: "tok_a_runout", roomId: table.roomId });
    await t.mutation(api.game.act, { sessionToken: "tok_a_runout", roomId: table.roomId, kind: "allIn" });
    await t.mutation(api.game.act, { sessionToken: "tok_b_runout", roomId: table.roomId, kind: "allIn" });

    const view = await t.query(api.game.getTableState, { sessionToken: "tok_a_runout", roomId: table.roomId });
    // the street closed by the last all-in is dealt with that action…
    expect(view.stage).toBe("flop");
    expect(view.board.length).toBe(3);
    expect(view.yourTurn).toBe(false);
    expect(view.pots.reduce((acc, p) => acc + p.amount, 0)).toBe(2000);
    // …and every later street is a scheduled step, not an instant run-out
    const pending = await t.run(async (ctx) => {
      const ms = await ctx.db.system.query("_scheduled_functions").collect();
      return ms.filter((s) => s.state.kind === "pending").map((s) => `${s.name}|${JSON.stringify(s.args)}`);
    });
    expect(pending.filter((n) => n.includes("advanceStreet")).length).toBe(1);

    // turn + river: two steps, each STREET_DEAL_DELAY_MS apart
    vi.advanceTimersByTime(2 * STREET_DEAL_DELAY_MS + 500);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();

    const runout = await t.run(async (ctx) => {
      const ms = await ctx.db
        .query("hands")
        .withIndex("by_room_handNumber", (q) => q.eq("roomId", table.roomId))
        .collect();
      const h = ms.find((x) => x.handNumber === 1);
      return h === undefined || h === null
        ? null
        : { stage: h.stage, board: h.board.length, deck: h.deck.length, shares: (h.result?.winners ?? []).map((w) => w.amount) };
    });
    expect(runout!.stage).toBe("finished");
    expect(runout!.board).toBe(5);
    // 04 §2 burn accounting: 4 hole + 3 burns + 5 board = 12 cards drawn
    expect(runout!.deck).toBe(40);
    expect(runout!.shares.reduce((acc, n) => acc + n, 0)).toBe(2000);
  });

  // --------------------------------------------------------------------- 5

  it("two acts for the same turn: exactly one applies (04 §9)", async () => {
    const table = await twoSeats("concurrent", 0);
    await t.mutation(api.game.startGame, { sessionToken: "tok_a_concurrent", roomId: table.roomId });
    await t.mutation(api.game.act, { sessionToken: "tok_a_concurrent", roomId: table.roomId, kind: "call" });
    // the second mutation for seat 0 re-reads the serialised state: not its turn
    await expectError(
      async () =>
        await t.mutation(api.game.act, { sessionToken: "tok_a_concurrent", roomId: table.roomId, kind: "check" }),
      errorCodes.NOT_YOUR_TURN,
    );
    await t.mutation(api.game.act, { sessionToken: "tok_b_concurrent", roomId: table.roomId, kind: "check" });
    const view = await t.query(api.game.getTableState, { sessionToken: "tok_b_concurrent", roomId: table.roomId });
    expect(view.stage).toBe("flop");
  });

  // --------------------------------------------------------------------- 6

  it("a mid-hand opponent view leaks no cards and no deck (00 §5)", async () => {
    const table = await twoSeats("secret", 0);
    await t.mutation(api.game.startGame, { sessionToken: "tok_a_secret", roomId: table.roomId });
    await t.mutation(api.game.act, { sessionToken: "tok_a_secret", roomId: table.roomId, kind: "call" });

    const asOpponent = await t.query(
      api.game.getTableState,
      { sessionToken: "tok_b_secret", roomId: table.roomId },
    );
    const raw = JSON.stringify(asOpponent);
    // 00 §5: the deck never crosses the projection boundary at all
    for (const secret of ["deck", "stackStart", "betTotal", "hasActed", "eligibleUserIds", "turnSeq", "startedAt"]) {
      expect(raw.includes(secret)).toBe(false);
    }
    // the opponent's seat entry carries no cards; the viewer's own entry does
    const otherSeat = asOpponent.seats.find((s) => s.seatIndex === 0);
    expect(otherSeat === undefined || otherSeat === null).toBe(false);
    expect(JSON.stringify(otherSeat!).includes("holeCards")).toBe(false);
    const ownSeat = asOpponent.seats.find((s) => s.seatIndex === 1);
    expect((ownSeat!.holeCards ?? []).length).toBe(2);
    // pots expose amounts only (08 §4)
    expect(asOpponent.pots.every((p) => Object.keys(p).length === 1)).toBe(true);
  });

  // --------------------------------------------------------------------- 7

  it("the hourly sweep purges ephemeral docs, closes stale rooms, stands idle seats up (05 §8)", async () => {
    const stale = await seedUser("Stale", FAUCET_AMOUNT * 4, "tok_stale");
    const room = await t.mutation(
      api.rooms.createRoom,
      { sessionToken: "tok_stale", name: "Stale", turnSeconds: 0 },
    );
    await t.mutation(api.rooms.sitDown, { sessionToken: "tok_stale", roomId: room.roomId, seatIndex: 0 });
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.patch("rooms", room.roomId, { lastActivityAt: now - (ROOM_STALE_MS + 60_000) });
      await ctx.db.patch("users", stale, { lastSeenAt: now - (OFFLINE_STOOD_UP_MS + 60_000) });
      const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_user", (q) => q.eq("userId", stale))
        .collect();
      for (const s of sessions) {
        await ctx.db.patch("sessions", s._id, { expiresAt: now - 1000 });
      }
      await ctx.db.insert("loginChallenges", {
        userId: stale,
        nonce: "nonce-stale",
        createdAt: now - 60_000,
        expiresAt: now - 1000,
        attempts: 1,
      });
    });

    await t.action(internal.game.cleanupExpired, {});

    const roomDoc = await t.run(async (ctx) => await ctx.db.get("rooms", room.roomId));
    expect(roomDoc?.status).toBe("closed");
    expect(roomDoc?.closedAt === undefined || roomDoc?.closedAt === null).toBe(false);
    // the seated member was cashed out before closing (05 §5 semantics)
    expect(await userBalance(stale)).toBe(FAUCET_AMOUNT * 4);
    const seatLeft = await t.run(async (ctx) => {
      const ms = await ctx.db.query("seats").withIndex("by_room", (q) => q.eq("roomId", room.roomId)).collect();
      return ms.every((s) => s.seatIndex === -1);
    });
    expect(seatLeft).toBe(true);

    const expiredLeft = await t.run(async (ctx) => {
      const cutoff = Date.now();
      const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_expiresAt", (q) => q.lte("expiresAt", cutoff))
        .collect();
      const challenges = await ctx.db
        .query("loginChallenges")
        .withIndex("by_expiresAt", (q) => q.lte("expiresAt", cutoff))
        .collect();
      return sessions.length + challenges.length;
    });
    expect(expiredLeft).toBe(0);
  });
});
