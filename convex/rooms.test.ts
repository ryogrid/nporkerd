// Phase 3 acceptance tests — room lifecycle: the 05 §2 validation table,
// lobby rules (05 §6), uniform JOIN_DENIED gates (05 §3), the three-tier
// getRoom projection (05 §7), sit/stand chip conservation (05 §4),
// host migration + auto-close (05 §5) and the mid-hand guards exercised
// through planted `hands` documents.
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import { convexTest } from "convex-test";
import schema from "./schema";
import {
  BUY_IN_MIN_BIG_BLINDS,
  FAUCET_AMOUNT,
  PASSPHRASE_MIN,
  PRESENCE_ONLINE_MS,
  ROOM_NAME_MAX,
  SESSION_TTL_MS,
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

describe("rooms", () => {
  const t = convexTest(schema, modules);

  // Insert a user with a live session; `token` doubles as the raw session
  // token (only its SHA-256 is stored at rest — 03 §5).
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

  // Minimal hands doc (players/pots empty — the guards only read `stage`).
  async function seedHand(roomId: any, stage: "turn" | "finished") {
    return await t.run(async (ctx) => {
      const id = await ctx.db.insert("hands", {
        roomId,
        handNumber: 1,
        stage,
        deck: [1, 2],
        board: [],
        players: [],
        pots: [],
        dealerSeat: 0,
        currentBet: 0,
        minRaise: 0,
        timeoutStats: [],
        turnSeq: 0,
        startedAt: Date.now(),
      });
      await ctx.db.patch("rooms", roomId, { currentHandId: id });
      return id;
    });
  }

  it("createRoom applies defaults and auto-joins the host", async () => {
    const host = await seedUser("Host", FAUCET_AMOUNT * 10, "tok_host_cr");
    const created = await t.mutation(api.rooms.createRoom, {
      sessionToken: "tok_host_cr",
      name: "Casual",
    });
    const room = await t.run(async (ctx) => await ctx.db.get("rooms", created.roomId));
    expect(room?.name).toBe("Casual");
    expect(room?.visibility).toBe("public");
    expect(room?.maxSeats).toBe(9);
    expect(room?.smallBlind).toBe(10);
    expect(room?.bigBlind).toBe(20);
    expect(room?.buyIn).toBe(1000);
    expect(room?.turnSeconds).toBe(30);
    expect(room?.status).toBe("waiting");
    const ms = await t.run(async (ctx) =>
      await ctx.db.query("seats").withIndex("by_room", (q) => q.eq("roomId", created.roomId)).collect(),
    );
    expect(ms.length).toBe(1);
    expect(ms[0].userId).toBe(host);
    expect(ms[0].seatIndex).toBe(-1);
  });

  it("createRoom validation table (05 §2) is INVALID_ROOM_SETTINGS", async () => {
    const host = await seedUser("Gate", FAUCET_AMOUNT * 10, "tok_gate");
    const bad: any[] = [
      { name: "   " },
      { name: "x".repeat(ROOM_NAME_MAX + 1) },
      { name: "ok", maxSeats: 10 },
      { name: "ok", smallBlind: 0 },
      { name: "ok", bigBlind: 5 },
      { name: "ok", bigBlind: 20, buyIn: 20 * BUY_IN_MIN_BIG_BLINDS - 1 },
      { name: "ok", turnSeconds: 5 },
      { name: "ok", visibility: "private", passphrase: "abc" },
    ];
    for (const setting of bad) {
      await expectError(
        async () => await t.mutation(api.rooms.createRoom, { sessionToken: "tok_gate", ...setting }),
        errorCodes.INVALID_ROOM_SETTINGS,
      );
    }
    await expectError(
      async () =>
        await t.mutation(api.rooms.createRoom, { sessionToken: "tok_gate", name: "x".repeat(ROOM_NAME_MAX + 1) }),
      errorCodes.INVALID_ROOM_SETTINGS,
    );
  });

  it("lobby: private hidden, newest first, closed gone (05 §6)", async () => {
    const l1 = await seedUser("L1", 5000, "tok_l1");
    const pub = await t.mutation(api.rooms.createRoom, { sessionToken: "tok_l1", name: "Pub" });
    const secret = await t.mutation(api.rooms.createRoom, {
      sessionToken: "tok_l1",
      name: "Secret",
      visibility: "private",
      passphrase: "sixchars",
    });
    const first = await t.query(api.rooms.listPublicRooms, { sessionToken: "tok_l1" });
    expect(first.some((r: any) => r.roomId === secret.roomId)).toBe(false);
    expect(first.some((r: any) => r.name === "Pub")).toBe(true);
    // same-second creation makes ordering ambiguous; age the old room
    await t.run(async (ctx) => await ctx.db.patch("rooms", pub.roomId, { lastActivityAt: 1 }));
    const l2 = await seedUser("L2", 5000, "tok_l2");
    const pub2 = await t.mutation(api.rooms.createRoom, { sessionToken: "tok_l2", name: "Newer" });
    const second = await t.query(api.rooms.listPublicRooms, { sessionToken: "tok_l1" });
    const names = second.map((r: any) => r.name);
    expect(names.includes("Newer")).toBe(true);
    expect(names.includes("Pub")).toBe(true);
    expect(names.includes("Secret")).toBe(false);
    expect(names.indexOf("Pub")).toBe(names.length - 1); // aged to lastActivityAt=1
    const newer = second[names.indexOf("Newer")];
    expect(newer.hostUsername).toBe("L2");
    // closing removes it from the lobby
    await t.mutation(api.rooms.closeRoom, { sessionToken: "tok_l2", roomId: pub2.roomId });
    const third = await t.query(api.rooms.listPublicRooms, { sessionToken: "tok_l1" });
    expect(third.some((r: any) => r.name === "Newer")).toBe(false);
  });

  it("joinRoom: wrong passphrase ≡ closed ≡ missing room (no oracle)", async () => {
    const h = await seedUser("J1", 5000, "tok_j1");
    const peer = await seedUser("J2", 5000, "tok_j2");
    const secret = await t.mutation(api.rooms.createRoom, {
      sessionToken: "tok_j1",
      name: "Locked",
      visibility: "private",
      passphrase: "sixchars",
    });
    await expectError(
      async () => await t.mutation(api.rooms.joinRoom, {
        sessionToken: "tok_j2",
        roomId: secret.roomId,
        passphrase: "nope",
      }),
      errorCodes.JOIN_DENIED,
    );
    await expectError(
      async () => await t.mutation(api.rooms.joinRoom, { sessionToken: "tok_j2", roomId: secret.roomId }),
      errorCodes.JOIN_DENIED,
    );
    // correct passphrase joins once; re-join is idempotent (05 §3)
    await t.mutation(api.rooms.joinRoom, { sessionToken: "tok_j2", roomId: secret.roomId, passphrase: "sixchars" });
    const afterJoin = await t.run(async (ctx) =>
      await ctx.db.query("seats").withIndex("by_room", (q) => q.eq("roomId", secret.roomId)).collect(),
    );
    expect(afterJoin.length).toBe(2);
    expect(afterJoin.some((s) => s.userId === peer && s.seatIndex === -1)).toBe(true);
    // closed and deleted rooms produce the identical code
    await t.mutation(api.rooms.closeRoom, { sessionToken: "tok_j1", roomId: secret.roomId });
    await expectError(
      async () => await t.mutation(api.rooms.joinRoom, { sessionToken: "tok_j2", roomId: secret.roomId }),
      errorCodes.JOIN_DENIED,
    );
    await t.run(async (ctx) => await ctx.db.delete("rooms", secret.roomId));
    await expectError(
      async () => await t.mutation(api.rooms.joinRoom, { sessionToken: "tok_j2", roomId: secret.roomId }),
      errorCodes.JOIN_DENIED,
    );
  });

  it("getRoom: closed / private-non-member stub / member full (05 §7)", async () => {
    const h = await seedUser("G1", 5000, "tok_g1");
    const peer = await seedUser("G2", 5000, "tok_g2");
    const secret = await t.mutation(api.rooms.createRoom, {
      sessionToken: "tok_g1",
      name: "Locked",
      visibility: "private",
      passphrase: "sixchars",
    });
    // tier: private non-member — not even the name leaks
    const stub = await t.query(api.rooms.getRoom, { sessionToken: "tok_g2", roomId: secret.roomId });
    expect(stub.exists).toBe(true);
    expect(stub.requiresPassphrase).toBe(true);
    expect(stub.name).toBeUndefined();
    // tier: member sees the full projection
    await t.mutation(api.rooms.joinRoom, { sessionToken: "tok_g2", roomId: secret.roomId, passphrase: "sixchars" });
    const sat = await t.mutation(api.rooms.sitDown, { sessionToken: "tok_g2", roomId: secret.roomId, seatIndex: 3 });
    expect(sat.stack).toBe(1000);
    const full = await t.query(api.rooms.getRoom, { sessionToken: "tok_g2", roomId: secret.roomId });
    expect(full.exists).toBe(true);
    expect(full.name).toBe("Locked");
    expect(full.visibility).toBe("private");
    expect(full.isHost).toBe(false);
    expect(full.yourSeatIndex).toBe(3);
    expect((full.seats ?? []).length).toBe(2);
    const mine = (full.seats ?? []).find((s: any) => s.seatIndex === 3);
    expect(mine?.username).toBe("G2");
    expect(mine?.online).toBe(true);
    // an idle account is not "online"
    await t.run(async (ctx) => await ctx.db.patch("users", peer, { lastSeenAt: Date.now() - PRESENCE_ONLINE_MS - 1000 }));
    const stale = await t.query(api.rooms.getRoom, { sessionToken: "tok_g1", roomId: secret.roomId });
    const idle = (stale.seats ?? []).find((s: any) => s.seatIndex === 3);
    expect(idle?.online).toBe(false);
    // tier: closed room is redacted for everyone
    await t.mutation(api.rooms.closeRoom, { sessionToken: "tok_g1", roomId: secret.roomId });
    const closed = await t.query(api.rooms.getRoom, { sessionToken: "tok_g2", roomId: secret.roomId });
    expect(closed.exists).toBe(true);
    expect(closed.closed).toBe(true);
    expect(closed.name).toBeUndefined();
  });
  it("sitDown/standUp move chips atomically, seat rules enforced (05 §4)", async () => {
    const host = await seedUser("SH", FAUCET_AMOUNT * 10, "tok_sh");
    const peer = await seedUser("SP", 1500, "tok_sp");
    const room = await t.mutation(api.rooms.createRoom, { sessionToken: "tok_sh", name: "Cash" });
    const sat = await t.mutation(api.rooms.sitDown, { sessionToken: "tok_sp", roomId: room.roomId, seatIndex: 0 });
    expect(sat.stack).toBe(1000);
    const bal = await userBalance(peer);
    expect(bal).toBe(500);
    const stack = await t.run(async (ctx) => {
      const ms = await ctx.db.query("seats").withIndex("by_room", (q) => q.eq("roomId", room.roomId)).collect();
      const mine = ms.find((s) => s.userId === peer);
      return mine?.stack ?? -1;
    });
    expect(bal + stack).toBe(1500); // chip conservation across balance/stack
    // a second chair while seated -> ALREADY_SEATED (checked before the chair)
    await expectError(
      async () => await t.mutation(api.rooms.sitDown, { sessionToken: "tok_sp", roomId: room.roomId, seatIndex: 1 }),
      errorCodes.ALREADY_SEATED,
    );
    // host cannot steal the taken chair, nor a chair beyond maxSeats
    await expectError(
      async () => await t.mutation(api.rooms.sitDown, { sessionToken: "tok_sh", roomId: room.roomId, seatIndex: 0 }),
      errorCodes.SEAT_TAKEN,
    );
    await expectError(
      async () => await t.mutation(api.rooms.sitDown, { sessionToken: "tok_sh", roomId: room.roomId, seatIndex: 9 }),
      errorCodes.SEAT_TAKEN,
    );
    // broke users keep their balance (the throw rolls the pair back)
    const poor = await seedUser("Poor", 900, "tok_poor");
    await expectError(
      async () => await t.mutation(api.rooms.sitDown, { sessionToken: "tok_poor", roomId: room.roomId, seatIndex: 1 }),
      errorCodes.INSUFFICIENT_BALANCE,
    );
    expect(await userBalance(poor)).toBe(900);
    // private rooms cannot be seated into without membership first
    const sec = await t.mutation(api.rooms.createRoom, {
      sessionToken: "tok_sh",
      name: "Priv",
      visibility: "private",
      passphrase: "abcd",
    });
    await expectError(
      async () => await t.mutation(api.rooms.sitDown, { sessionToken: "tok_poor", roomId: sec.roomId, seatIndex: 0 }),
      errorCodes.JOIN_DENIED,
    );
    // standUp pays back exactly what was bought in
    const stood = await t.mutation(api.rooms.standUp, { sessionToken: "tok_sp", roomId: room.roomId });
    expect(stood.balance).toBe(1500);
    // and now the closed room refuses seats
    await t.mutation(api.rooms.closeRoom, { sessionToken: "tok_sh", roomId: room.roomId });
    await expectError(
      async () => await t.mutation(api.rooms.sitDown, { sessionToken: "tok_sp", roomId: room.roomId, seatIndex: 0 }),
      errorCodes.ROOM_CLOSED,
    );
  });

  it("mid-hand boundaries: host ops refused, stand-up/leave folded-first (05 §4–§5)", async () => {
    const host = await seedUser("GH", FAUCET_AMOUNT * 10, "tok_gh");
    const room = await t.mutation(api.rooms.createRoom, { sessionToken: "tok_gh", name: "Guard" });
    await t.mutation(api.rooms.sitDown, { sessionToken: "tok_gh", roomId: room.roomId, seatIndex: 0 });
    const handId = await seedHand(room.roomId, "turn");
    // host powers stay hand-boundary-only (05 §5)
    await expectError(
      async () => await t.mutation(api.rooms.endGame, { sessionToken: "tok_gh", roomId: room.roomId }),
      errorCodes.GAME_IN_PROGRESS,
    );
    await expectError(
      async () => await t.mutation(api.rooms.closeRoom, { sessionToken: "tok_gh", roomId: room.roomId }),
      errorCodes.GAME_IN_PROGRESS,
    );
    // topUp is the one with its own code — BETWEEN_HANDS_ONLY
    await expectError(
      async () => await t.mutation(api.rooms.topUp, { sessionToken: "tok_gh", roomId: room.roomId }),
      errorCodes.BETWEEN_HANDS_ONLY,
    );
    // 05 §4: standing up mid-hand is legal — the player is folded first through
    // the engine (the fold itself is exercised on a real hand in game.test.ts),
    // so the whole stack cashes back out here.
    const stood = await t.mutation(api.rooms.standUp, { sessionToken: "tok_gh", roomId: room.roomId });
    expect(stood.balance).toBe(FAUCET_AMOUNT * 10);
    await t.mutation(api.rooms.sitDown, { sessionToken: "tok_gh", roomId: room.roomId, seatIndex: 0 });
    expect(await userBalance(host)).toBe(FAUCET_AMOUNT * 10 - 1000);
    // finish the hand -> all boundary ops become legal
    await t.run(async (ctx) => await ctx.db.patch("hands", handId, { stage: "finished", finishedAt: Date.now() }));
    // seat deflated to make the rebuy interesting: add min(buyIn − stack, balance)
    await t.run(async (ctx) => {
      const ms = await ctx.db.query("seats").withIndex("by_room", (q) => q.eq("roomId", room.roomId)).collect();
      await ctx.db.patch("seats", ms[0]._id, { stack: 300 });
    });
    const topped = await t.mutation(api.rooms.topUp, { sessionToken: "tok_gh", roomId: room.roomId });
    expect(topped.stack).toBe(1000);
    expect(topped.balance).toBe(FAUCET_AMOUNT * 10 - 1000 - 700);
    const ended = await t.mutation(api.rooms.endGame, { sessionToken: "tok_gh", roomId: room.roomId });
    expect(ended.ok).toBe(true);
    // 05 §4: leaving is always allowed, even mid-hand; last member out closes.
    await t.mutation(api.rooms.leaveRoom, { sessionToken: "tok_gh", roomId: room.roomId });
    expect(await userBalance(host)).toBe(FAUCET_AMOUNT * 10 - 700);
    const closed = await t.run(async (ctx) => await ctx.db.get("rooms", room.roomId));
    expect(closed?.status).toBe("closed");
  });

  it("host migration and auto-close on last member (05 §5)", async () => {
    const m1 = await seedUser("M1", 5000, "tok_m1");
    const m2 = await seedUser("M2", 5000, "tok_m2");
    const m3 = await seedUser("M3", FAUCET_AMOUNT * 10, "tok_m3");
    const room = await t.mutation(api.rooms.createRoom, { sessionToken: "tok_m1", name: "Migrate" });
    await t.mutation(api.rooms.joinRoom, { sessionToken: "tok_m2", roomId: room.roomId });
    await t.mutation(api.rooms.joinRoom, { sessionToken: "tok_m3", roomId: room.roomId });
    // deterministic joinedAt order: m1 < m2 < m3 (same-second joins otherwise)
    await t.run(async (ctx) => {
      const ms = await ctx.db.query("seats").withIndex("by_room", (q) => q.eq("roomId", room.roomId)).collect();
      for (const s of ms) {
        const rank = s.userId === m1 ? 1 : s.userId === m2 ? 2 : 3;
        await ctx.db.patch("seats", s._id, { joinedAt: rank * 100 });
      }
    });
    await t.mutation(api.rooms.sitDown, { sessionToken: "tok_m3", roomId: room.roomId, seatIndex: 0 });
    // the host leaves: crown goes to the earliest-joined SEATED member
    await t.mutation(api.rooms.leaveRoom, { sessionToken: "tok_m1", roomId: room.roomId });
    let roomDoc = await t.run(async (ctx) => await ctx.db.get("rooms", room.roomId));
    expect(roomDoc?.hostId).toBe(m3);
    // that host leaves (seated — cash-out must be exact); next crown overall-earliest
    await t.mutation(api.rooms.leaveRoom, { sessionToken: "tok_m3", roomId: room.roomId });
    expect(await userBalance(m3)).toBe(FAUCET_AMOUNT * 10);
    roomDoc = await t.run(async (ctx) => await ctx.db.get("rooms", room.roomId));
    expect(roomDoc?.hostId).toBe(m2);
    // last member leaves -> auto-close, no members left
    await t.mutation(api.rooms.leaveRoom, { sessionToken: "tok_m2", roomId: room.roomId });
    roomDoc = await t.run(async (ctx) => await ctx.db.get("rooms", room.roomId));
    expect(roomDoc?.status).toBe("closed");
    expect((roomDoc?.closedAt ?? 0) > 0).toBe(true);
    const left = await t.run(async (ctx) =>
      await ctx.db.query("seats").withIndex("by_room", (q) => q.eq("roomId", room.roomId)).collect(),
    );
    expect(left.length).toBe(0);
  });

  it("toggleSitOut keeps seat and stack (05 §4)", async () => {
    const host = await seedUser("SO", FAUCET_AMOUNT * 10, "tok_so");
    const room = await t.mutation(api.rooms.createRoom, { sessionToken: "tok_so", name: "SitOut" });
    await t.mutation(api.rooms.sitDown, { sessionToken: "tok_so", roomId: room.roomId, seatIndex: 1 });
    await t.mutation(api.rooms.toggleSitOut, { sessionToken: "tok_so", roomId: room.roomId, sittingOut: true });
    const mid = await t.run(async (ctx) => {
      const ms = await ctx.db.query("seats").withIndex("by_room", (q) => q.eq("roomId", room.roomId)).collect();
      const mine = ms.find((s) => s.seatIndex === 1);
      return { state: mine?.state ?? "missing", stack: mine?.stack ?? -1 };
    });
    expect(mid.state).toBe("sittingOut");
    expect(mid.stack).toBe(1000); // the stack stays put (05 §4)
    const back = await t.mutation(api.rooms.toggleSitOut, { sessionToken: "tok_so", roomId: room.roomId, sittingOut: false });
    expect(back.ok).toBe(true);
    // a member who is not at a chair cannot toggle
    const peer = await seedUser("Peer", 5000, "tok_peer");
    await t.mutation(api.rooms.joinRoom, { sessionToken: "tok_peer", roomId: room.roomId });
    await expectError(
      async () => await t.mutation(api.rooms.toggleSitOut, { sessionToken: "tok_peer", roomId: room.roomId, sittingOut: true }),
      errorCodes.NOT_A_MEMBER,
    );
  });

  it("endGame at boundaries; closeRoom cashes everyone out (05 §5)", async () => {
    const host = await seedUser("CX", FAUCET_AMOUNT * 10, "tok_cx");
    const peer = await seedUser("CY", 5000, "tok_cy");
    const room = await t.mutation(api.rooms.createRoom, { sessionToken: "tok_cx", name: "Cash" });
    await t.mutation(api.rooms.joinRoom, { sessionToken: "tok_cy", roomId: room.roomId });
    await t.mutation(api.rooms.sitDown, { sessionToken: "tok_cy", roomId: room.roomId, seatIndex: 0 });
    // non-host powers are refused...
    await expectError(
      async () => await t.mutation(api.rooms.endGame, { sessionToken: "tok_cy", roomId: room.roomId }),
      errorCodes.NOT_HOST,
    );
    await expectError(
      async () => await t.mutation(api.rooms.closeRoom, { sessionToken: "tok_cy", roomId: room.roomId }),
      errorCodes.NOT_HOST,
    );
    // ...and closing is refused while a hand is live
    const handId = await seedHand(room.roomId, "turn");
    await expectError(
      async () => await t.mutation(api.rooms.closeRoom, { sessionToken: "tok_cx", roomId: room.roomId }),
      errorCodes.GAME_IN_PROGRESS,
    );
    await t.run(async (ctx) => await ctx.db.patch("hands", handId, { stage: "finished", finishedAt: Date.now() }));
    const closed = await t.mutation(api.rooms.closeRoom, { sessionToken: "tok_cx", roomId: room.roomId });
    expect(closed.ok).toBe(true);
    // every seated player gets their chips back into the bankroll
    expect(await userBalance(peer)).toBe(5000);
    expect(await userBalance(host)).toBe(FAUCET_AMOUNT * 10);
    const seat = await t.run(async (ctx) => {
      const ms = await ctx.db.query("seats").withIndex("by_room", (q) => q.eq("roomId", room.roomId)).collect();
      const mine = ms.find((s) => s.userId === peer);
      return { stack: mine?.stack ?? -1, state: mine?.state ?? "?", seatIndex: mine?.seatIndex ?? -2 };
    });
    expect(seat.stack).toBe(0);
    expect(seat.state).toBe("left");
    expect(seat.seatIndex).toBe(-1);
  });
});
