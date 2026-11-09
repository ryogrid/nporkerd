// Phase 8 — the Phase 5 security review re-checked against the final code,
// including what Phase 6/7 added (chat, the `nextHandAt` field, the SPA's call
// sites). 10's acceptance line is "no known way for a client to learn
// unrevealed cards (tested, not assumed)": every projection the browser can
// obtain is swept for hands-document shape, and a three-handed hand is played
// in which one player folds on the flop, so the server-side truth (six cards
// dealt) is compared with what the viewer is actually handed (four).
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import { convexTest } from "convex-test";
import schema from "./schema";
import { FunctionReturnType } from "convex/server";
import { NEXT_HAND_DELAY_MS, SESSION_TTL_MS } from "./lib/constants";
import { errorCodes } from "./lib/errors";
import { sha256Hex } from "./lib/hash";

const modules = import.meta.glob("./**/*.ts");

type Projection = FunctionReturnType<typeof api.game.getTableState>;

function errorCodeOf(e: unknown): string {
  const data = (e as { data?: unknown }).data;
  if (typeof data === "object") {
    const code = (data as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
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

/** Every key name reachable in a query result, at any depth. */
function keyNames(value: unknown): string[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      out.push(...keyNames(item));
    }
    return out;
  }
  const names: string[] = [];
  for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
    names.push(name);
    names.push(...keyNames(child));
  }
  return names;
}

// Names only a `hands` document has: if any crosses a client query, the
// projection boundary has moved (00 §5 / 02 §2).
const HANDS_ONLY = [
  "deck",
  "stackStart",
  "betTotal",
  "hasActed",
  "eligibleUserIds",
  "turnSeq",
  "startedAt",
  "minRaise",
  "currentBet",
  "pockets",
  "hidden",
];

/** Card values a viewer may see: the board plus every hole pair projected. */
function visibleCards(view: Projection): number[] {
  const seen: number[] = [...view.board];
  for (const seat of view.seats) {
    if (seat.holeCards === undefined || seat.holeCards === null) {
      continue;
    }
    seen.push(...seat.holeCards);
  }
  return seen;
}

describe("security", () => {
  const t = convexTest(schema, modules);

  async function seedUser(username: string, token: string) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const uid = await ctx.db.insert("users", {
        username,
        usernameLower: username.toLowerCase(),
        publicKey: "pk-placeholder",
        balance: 5000,
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

  /** Three seated players, clock off so only the acts drive the hand. */
  async function threeSeats(tag: string) {
    const seats = [`tok_a_${tag}`, `tok_b_${tag}`, `tok_c_${tag}`];
    for (let i = 0; i < seats.length; i += 1) {
      await seedUser(`Player${i}${tag}`, seats[i]);
    }
    await seedUser(`Outsider${tag}`, `tok_o_${tag}`); // has a session, never joins
    const room = await t.mutation(
      api.rooms.createRoom,
      { sessionToken: seats[0], name: `Secure ${tag}`, turnSeconds: 0 },
    );
    for (let i = 0; i < seats.length; i += 1) {
      await t.mutation(api.rooms.sitDown, { sessionToken: seats[i], roomId: room.roomId, seatIndex: i });
    }
    return { roomId: room.roomId, seats };
  }

  /** Server-side truth: the hand's own document (bypasses the projection). */
  async function readHands(roomId: any) {
    return await t.run(async (ctx) => {
      const room = await ctx.db.get("rooms", roomId);
      if (room === null || room.currentHandId === undefined || room.currentHandId === null) {
        return null;
      }
      return await ctx.db.get("hands", room.currentHandId);
    });
  }

  /**
   * Plays a hand using only public mutations: every seat checks (or calls when
   * it must), except that `foldSeat` folds on its first flop action. Seen from
   * `viewer`'s seat so the sweep also covers the waiting/finished views.
   */
  async function playHand(roomId: any, seats: string[], foldSeat: number, viewer: string) {
    const names: string[] = [];
    let last: Projection | undefined = undefined;
    for (let step = 0; step < 40; step += 1) {
      const asViewer = await t.query(api.game.getTableState, { sessionToken: viewer, roomId });
      names.push(...keyNames(asViewer));
      last = asViewer;
      if (asViewer.stage === "finished" || asViewer.stage === "showdown" || asViewer.stage === "waiting") {
        break;
      }
      const seat = asViewer.currentTurnSeat;
      if (seat === undefined || seat === null) {
        break; // nobody to act: the hand is over
      }
      const token = seats[seat];
      const asActor = await t.query(api.game.getTableState, { sessionToken: token, roomId });
      names.push(...keyNames(asActor));
      const legal = asActor.legal;
      expect(legal === undefined || legal === null).toBe(false);
      const foldNow = asViewer.stage === "flop" && seat === foldSeat && legal!.canCheck;
      const kind = foldNow ? "fold" : legal!.canCheck ? "check" : "call";
      await t.mutation(api.game.act, { sessionToken: token, roomId, kind });
    }
    return { view: last, names };
  }

  // ------------------------------------------------------------------- 1
  it("no hands-document shape crosses any client query, at any stage (00 §5 re-check)", async () => {
    const table = await threeSeats("sweep");
    const waiting = await t.query(api.game.getTableState, { sessionToken: `tok_a_sweep`, roomId: table.roomId });
    expect(waiting.stage).toBe("waiting");
    const allNames = keyNames(waiting);
    expect(allNames.some((k) => HANDS_ONLY.includes(k))).toBe(false);

    await t.mutation(api.game.startGame, { sessionToken: `tok_a_sweep`, roomId: table.roomId });
    const played = await playHand(table.roomId, table.seats, 1, `tok_a_sweep`);
    for (const name of played.names) {
      expect(HANDS_ONLY.includes(name)).toBe(false);
    }
    const view = played.view!;
    expect(view.stage).toBe("finished");
    expect(view.board.length).toBe(5);
    // pots stay amounts-only (08 §4)
    expect(view.pots.every((p) => Object.keys(p).length === 1)).toBe(true);
  });

  // ------------------------------------------------------------------- 2
  it("six cards were dealt, four are projected: a folded player stays hidden (00 §5)", async () => {
    const table = await threeSeats("foldreveal");
    await t.mutation(api.game.startGame, { sessionToken: `tok_a_foldreveal`, roomId: table.roomId });
    const played = await playHand(table.roomId, table.seats, 1, `tok_c_foldreveal`);
    const view = played.view!;

    // the server dealt two cards to each of the three players
    const hands = await readHands(table.roomId);
    expect(hands === null || hands === undefined).toBe(false);
    const players = hands!.players;
    expect(players.length).toBe(3);
    let dealtCards = 0;
    for (const p of players) {
      expect(p.holeCards.length).toBe(2);
      dealtCards += p.holeCards.length;
    }
    expect(dealtCards).toBe(6);

    // the viewer sits at seat 2 and folds-at-showdown peer seat 0 is revealed
    const folded = view.seats.find((s) => s.seatIndex === 1);
    expect(folded === undefined || folded === null).toBe(false);
    expect(folded!.holeCards === undefined || folded!.holeCards === null).toBe(true);
    const contested = view.seats.find((s) => s.seatIndex === 0);
    expect(contested === undefined || contested === null).toBe(false);
    expect(contested!.holeCards === undefined || contested!.holeCards === null).toBe(false);
    expect((contested!.holeCards as number[]).length).toBe(2);
    const mine = view.seats.find((s) => s.seatIndex === 2);
    expect(mine === undefined || mine === null).toBe(false);
    expect(mine!.holeCards === undefined || mine!.holeCards === null).toBe(false);
    expect((mine!.holeCards as number[]).length).toBe(2);

    // visible set = board + own pair + the contested peer's pair, all distinct
    const visible = visibleCards(view);
    expect(view.board.length).toBe(5);
    expect(visible.length).toBe(9);
    expect(new Set(visible).size).toBe(9);
    for (const card of visible) {
      expect(card >= 0 && card < 52).toBe(true);
    }

    // the additive Phase 7 deadline is the server's own schedule (07 §2.4)
    expect(view.nextHandAt === undefined || view.nextHandAt === null).toBe(false);
    const finishedAt = hands!.finishedAt;
    expect(finishedAt === undefined || finishedAt === null).toBe(false);
    expect(view.nextHandAt).toBe((finishedAt as number) + NEXT_HAND_DELAY_MS);

    // 04 §6: the reveal ids are exactly the players who contested the pot
    const revealed = hands!.result === undefined || hands!.result === null ? [] : hands!.result.revealedUserIds;
    expect(revealed.length).toBe(2);
  });

  // ------------------------------------------------------------------- 3
  it("rooms/chat queries carry no card data at all (05 §7, 06 §2)", async () => {
    const table = await threeSeats("neighbours");
    await t.mutation(api.game.startGame, { sessionToken: `tok_a_neighbours`, roomId: table.roomId });
    const room = await t.query(api.rooms.getRoom, { sessionToken: `tok_a_neighbours`, roomId: table.roomId });
    const lobby = await t.query(api.rooms.listPublicRooms, { sessionToken: `tok_a_neighbours` });
    await t.mutation(api.chat.sendMessage, {
      sessionToken: `tok_a_neighbours`,
      roomId: table.roomId,
      body: "the chat carries no cards",
    });
    const chat = await t.query(api.chat.listMessages, { sessionToken: `tok_a_neighbours`, roomId: table.roomId });
    for (const value of [room, lobby, chat]) {
      const names = keyNames(value);
      for (const cardKey of ["deck", "board", "holeCards", "cards", "hands", "pot"]) {
        expect(names.some((k) => k === cardKey)).toBe(false);
      }
    }
  });

  // ------------------------------------------------------------------- 4
  it("a non-member and a closed room get nothing from the table or the chat (05 §7, 06 §2)", async () => {
    const table = await threeSeats("locked");
    // no hand is started: closing is allowed, and the point is what a closed
    // room (or a stranger) can learn, not the game's progress
    await expectError(
      async () => await t.query(api.game.getTableState, { sessionToken: `tok_o_locked`, roomId: table.roomId }),
      errorCodes.NOT_A_MEMBER,
    );
    await expectError(
      async () => await t.query(api.chat.listMessages, { sessionToken: `tok_o_locked`, roomId: table.roomId }),
      errorCodes.NOT_A_MEMBER,
    );
    // the outsider knows the table exists (public lobby) but learns no cards
    const lobby = await t.query(api.rooms.listPublicRooms, { sessionToken: `tok_o_locked` });
    expect(lobby.some((r) => r.roomId === table.roomId)).toBe(true);

    const closed = await t.mutation(api.rooms.closeRoom, { sessionToken: `tok_a_locked`, roomId: table.roomId });
    expect(closed.ok).toBe(true);
    await expectError(
      async () => await t.query(api.game.getTableState, { sessionToken: `tok_a_locked`, roomId: table.roomId }),
      errorCodes.ROOM_CLOSED,
    );
    await expectError(
      async () => await t.query(api.chat.listMessages, { sessionToken: `tok_a_locked`, roomId: table.roomId }),
      errorCodes.ROOM_CLOSED,
    );
  });
});
