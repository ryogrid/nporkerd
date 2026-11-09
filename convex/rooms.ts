// Rooms and lobby — design/05, API per 08 §3. A room is both the lobby unit
// and its table. Membership lives in the `seats` table: one document per
// (room, user); `seatIndex = -1` ⇔ member but not seated; `state` is only
// meaningful when `seatIndex ≥ 0` (05 §3, final rule). Money moves between
// `users.balance` and `seats.stack` atomically inside each mutation
// (transactions make the pair atomic — 05 §4).
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  BUY_IN_MIN_BIG_BLINDS,
  MAX_SEATS_MAX,
  MAX_SEATS_MIN,
  PRESENCE_ONLINE_MS,
  ROOM_NAME_MAX,
  TURN_SECONDS_MAX,
  TURN_SECONDS_MIN,
  PASSPHRASE_MIN,
  PASSPHRASE_MAX,
} from "./lib/constants";
import { fail, INVALID_ROOM_SETTINGS, JOIN_DENIED, NOT_A_MEMBER, NOT_HOST, ROOM_CLOSED, SEAT_TAKEN, ALREADY_SEATED, INSUFFICIENT_BALANCE, GAME_IN_PROGRESS, BETWEEN_HANDS_ONLY } from "./lib/errors";
import { requireSession } from "./lib/session";
import { foldMidHand, maybeAutoResume } from "./game";
import { sha256Hex } from "./lib/hash";

const LOBBY_LIMIT = 50; // 08 §3 listPublicRooms cap

function isInteger(n: number): boolean {
  return Number.isInteger(n);
}

/** The room's live hand, iff one is running (stage ≠ finished). */
async function liveHandStage(
  ctx: QueryCtx | MutationCtx,
  room: Doc<"rooms">,
): Promise<boolean> {
  if (room.currentHandId === undefined || room.currentHandId === null) {
    return false;
  }
  const hand = await ctx.db.get("hands", room.currentHandId);
  return hand !== null && hand.stage !== "finished";
}

/** Reject while a hand is live — 05 §5 / 08 §3 (`GAME_IN_PROGRESS`). */
async function rejectIfHandLive(ctx: MutationCtx, room: Doc<"rooms">) {
  if (await liveHandStage(ctx, room)) {
    fail(GAME_IN_PROGRESS);
  }
}

/** Membership document for (room, user), or null. */
async function membership(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<"rooms">,
  userId: Id<"users">,
): Promise<Doc<"seats"> | null> {
  const seats = await ctx.db
    .query("seats")
    .withIndex("by_room_user", (q) => q.eq("roomId", roomId))
    .collect();
  for (const seat of seats) {
    if (seat.userId === userId) {
      return seat;
    }
  }
  return null;
}

/** Every membership document of a room. */
async function members(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<"rooms">,
) {
  return await ctx.db
    .query("seats")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .collect();
}

/** Physically seated at the table (05 §3: filter `seatIndex ≥ 0`). */
function seated(membersList: Doc<"seats">[]): Doc<"seats">[] {
  return membersList.filter((s) => s.seatIndex >= 0 && s.state !== "left");
}

/** Display name of the host; "" if the user document is gone. */
async function getHostUsername(
  ctx: QueryCtx | MutationCtx,
  room: Doc<"rooms">,
): Promise<string> {
  const host = await ctx.db.get("users", room.hostId);
  return host === null ? "" : host.username;
}

/** Cash a seated seat out into the user's bankroll (leave stack = 0). */
async function cashOut(
  ctx: MutationCtx,
  userId: Id<"users">,
  seat: Doc<"seats">,
): Promise<void> {
  const person = await ctx.db.get("users", userId);
  if (person !== null) {
    await ctx.db.patch("users", userId, { balance: person.balance + seat.stack });
  }
  await ctx.db.patch("seats", seat._id, { seatIndex: -1, stack: 0, state: "left" });
}

// ---------------------------------------------------------------- creation

export const createRoom = mutation({
  args: {
    sessionToken: v.string(),
    name: v.string(),
    visibility: v.optional(v.union(v.literal("public"), v.literal("private"))),
    passphrase: v.optional(v.string()),
    maxSeats: v.optional(v.number()),
    smallBlind: v.optional(v.number()),
    bigBlind: v.optional(v.number()),
    buyIn: v.optional(v.number()),
    turnSeconds: v.optional(v.number()),
  },
  returns: v.object({ roomId: v.id("rooms") }),
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);
    const now = Date.now();

    // Validation table — design/05 §2. Every failure carries the offending
    // setting in `data` so the client dialog can point at it.
    const name = args.name.trim();
    if (name.length < 1 || name.length > ROOM_NAME_MAX) {
      fail(INVALID_ROOM_SETTINGS, { setting: "name" });
    }
    const visibility = args.visibility ?? "public";
    const maxSeats = args.maxSeats ?? 9;
    if (!isInteger(maxSeats) || maxSeats < MAX_SEATS_MIN || maxSeats > MAX_SEATS_MAX) {
      fail(INVALID_ROOM_SETTINGS, { setting: "maxSeats" });
    }
    const smallBlind = args.smallBlind ?? 10;
    if (!isInteger(smallBlind) || smallBlind < 1) {
      fail(INVALID_ROOM_SETTINGS, { setting: "smallBlind" });
    }
    const bigBlind = args.bigBlind ?? 20;
    if (!isInteger(bigBlind) || bigBlind <= smallBlind) {
      fail(INVALID_ROOM_SETTINGS, { setting: "bigBlind" });
    }
    const buyIn = args.buyIn ?? 1000;
    if (!isInteger(buyIn) || buyIn < bigBlind * BUY_IN_MIN_BIG_BLINDS) {
      fail(INVALID_ROOM_SETTINGS, { setting: "buyIn" });
    }
    const turnSeconds = args.turnSeconds ?? 30;
    if (turnSeconds !== 0 && (!isInteger(turnSeconds) || turnSeconds < TURN_SECONDS_MIN || turnSeconds > TURN_SECONDS_MAX)) {
      fail(INVALID_ROOM_SETTINGS, { setting: "turnSeconds" });
    }
    // passphrase required iff private; 4–64 chars; never stored — hash only.
    const passphrase = args.passphrase;
    if (visibility === "private") {
      const trimmed = passphrase === undefined || passphrase === null ? "" : passphrase.trim();
      if (trimmed.length < PASSPHRASE_MIN || trimmed.length > PASSPHRASE_MAX) {
        fail(INVALID_ROOM_SETTINGS, { setting: "passphrase" });
      }
    }
    const passphraseHash =
      visibility === "private" && passphrase !== undefined && passphrase !== null
        ? await sha256Hex(passphrase)
        : undefined;

    const roomId = await ctx.db.insert("rooms", {
      name,
      hostId: user._id,
      visibility,
      passphraseHash,
      status: "waiting",
      maxSeats,
      smallBlind,
      bigBlind,
      buyIn,
      turnSeconds,
      lastActivityAt: now,
      createdAt: now,
    });
    // The host is joined (member, not seated) automatically — 05 §2.
    await ctx.db.insert("seats", {
      roomId,
      userId: user._id,
      seatIndex: -1,
      stack: 0,
      state: "left", // value required by schema; ignored when seatIndex = -1
      joinedAt: now,
      lastSeenAt: now,
    });
    return { roomId };
  },
});

// ------------------------------------------------------------------ lobby

export const listPublicRooms = query({
  args: { sessionToken: v.string() },
  returns: v.array(
    v.object({
      roomId: v.id("rooms"),
      name: v.string(),
      hostUsername: v.string(),
      status: v.union(v.literal("waiting"), v.literal("playing"), v.literal("closed")),
      maxSeats: v.number(),
      seatedCount: v.number(),
      memberCount: v.number(),
      smallBlind: v.number(),
      bigBlind: v.number(),
      buyIn: v.number(),
      turnSeconds: v.number(),
      lastActivityAt: v.number(),
    }),
  ),
  handler: async (ctx, { sessionToken }) => {
    await requireSession(ctx, sessionToken);
    // public, non-closed (08 §3): the two open statuses via the index.
    const waiting = await ctx.db
      .query("rooms")
      .withIndex("by_status_visibility", (q) => q.eq("status", "waiting").eq("visibility", "public"))
      .collect();
    const playing = await ctx.db
      .query("rooms")
      .withIndex("by_status_visibility", (q) => q.eq("status", "playing").eq("visibility", "public"))
      .collect();
    const rooms = waiting.concat(playing);
    rooms.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    const out = [];
    for (const room of rooms.slice(0, LOBBY_LIMIT)) {
      const ms = await members(ctx, room._id);
      out.push({
        roomId: room._id,
        name: room.name,
        hostUsername: await getHostUsername(ctx, room),
        status: room.status,
        maxSeats: room.maxSeats,
        seatedCount: seated(ms).length,
        memberCount: ms.length,
        smallBlind: room.smallBlind,
        bigBlind: room.bigBlind,
        buyIn: room.buyIn,
        turnSeconds: room.turnSeconds,
        lastActivityAt: room.lastActivityAt,
      });
    }
    return out;
  },
});

// ------------------------------------------------------------- projection

export const getRoom = query({
  args: { sessionToken: v.string(), roomId: v.id("rooms") },
  returns: v.object({
    exists: v.boolean(),
    closed: v.optional(v.boolean()),
    requiresPassphrase: v.optional(v.boolean()),
    name: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("public"), v.literal("private"))),
    status: v.optional(v.union(v.literal("waiting"), v.literal("playing"), v.literal("closed"))),
    maxSeats: v.optional(v.number()),
    smallBlind: v.optional(v.number()),
    bigBlind: v.optional(v.number()),
    buyIn: v.optional(v.number()),
    turnSeconds: v.optional(v.number()),
    hostUsername: v.optional(v.string()),
    isHost: v.optional(v.boolean()),
    yourSeatIndex: v.optional(v.number()),
    lastActivityAt: v.optional(v.number()),
    // host pressed "End game" during a hand: the room stops after this hand
    stopAfterHand: v.optional(v.boolean()),
    seats: v.optional(
      v.array(
        v.object({
          seatIndex: v.number(),
          userId: v.id("users"),
          username: v.string(),
          stack: v.number(),
          state: v.union(v.literal("seated"), v.literal("sittingOut"), v.literal("left")),
          online: v.boolean(),
        }),
      ),
    ),
  }),
  handler: async (ctx, { sessionToken, roomId }) => {
    const { user } = await requireSession(ctx, sessionToken);
    const room = await ctx.db.get("rooms", roomId);
    if (room === null) {
      return { exists: false };
    }
    // Closed rooms: redacted to everyone (05 §7).
    if (room.status === "closed") {
      return { exists: true, closed: true };
    }
    const ms = await members(ctx, roomId);
    const mine = ms.find((s) => s.userId === user._id);
    const isMember = mine !== undefined && mine !== null;
    // Private, non-member: not even the name (05 §7 — link is a locator, not
    // a credential).
    if (room.visibility === "private" && !isMember) {
      return { exists: true, requiresPassphrase: true };
    }
    const now = Date.now();
    const seatViews = [];
    for (const seat of ms) {
      const person = await ctx.db.get("users", seat.userId);
      seatViews.push({
        seatIndex: seat.seatIndex,
        userId: seat.userId,
        username: person === null ? "" : person.username,
        stack: seat.stack,
        state: seat.state,
        // Presence: online within PRESENCE_ONLINE_MS (05 §8) — user-level
        // lastSeenAt (heartbeat always maintains it; seat copies are cosmetic).
        online: person !== null && now - person.lastSeenAt <= PRESENCE_ONLINE_MS,
      });
    }
    seatViews.sort((a, b) => b.seatIndex - a.seatIndex);
    return {
      exists: true,
      name: room.name,
      visibility: room.visibility,
      status: room.status,
      maxSeats: room.maxSeats,
      smallBlind: room.smallBlind,
      bigBlind: room.bigBlind,
      buyIn: room.buyIn,
      turnSeconds: room.turnSeconds,
      hostUsername: await getHostUsername(ctx, room),
      isHost: room.hostId === user._id,
      yourSeatIndex: mine === undefined || mine === null ? undefined : mine.seatIndex,
      lastActivityAt: room.lastActivityAt,
      stopAfterHand: room.stopAfterHand === true ? true : undefined,
      seats: seatViews,
    };
  },
});

// ------------------------------------------------------- join / membership

export const joinRoom = mutation({
  args: {
    sessionToken: v.string(),
    roomId: v.id("rooms"),
    passphrase: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);
    const room = await ctx.db.get("rooms", args.roomId);
    // Missing room, closed room and wrong passphrase are ALL `JOIN_DENIED`
    // — identical behaviour, no existence oracle (05 §3, 08 §3).
    if (room === null || room.status === "closed") {
      fail(JOIN_DENIED);
    }
    if (room.visibility === "private") {
      const supplied = args.passphrase === undefined || args.passphrase === null ? "" : args.passphrase;
      const hashed = await sha256Hex(supplied);
      if (room.passphraseHash === undefined || room.passphraseHash === null || hashed !== room.passphraseHash) {
        fail(JOIN_DENIED);
      }
    }
    const existing = await membership(ctx, args.roomId, user._id);
    if (existing === null) {
      await ctx.db.insert("seats", {
        roomId: args.roomId,
        userId: user._id,
        seatIndex: -1, // member, not seated (05 §3)
        stack: 0,
        state: "left",
        joinedAt: Date.now(),
        lastSeenAt: Date.now(),
      });
    }
    await ctx.db.patch("rooms", args.roomId, { lastActivityAt: Date.now() });
    return { ok: true };
  },
});

export const sitDown = mutation({
  args: {
    sessionToken: v.string(),
    roomId: v.id("rooms"),
    seatIndex: v.number(),
  },
  returns: v.object({ stack: v.number() }),
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);
    const room = await ctx.db.get("rooms", args.roomId);
    if (room === null) {
      fail(JOIN_DENIED);
    }
    if (room.status === "closed") {
      fail(ROOM_CLOSED);
    }
    const seatIndex = args.seatIndex;
    if (!isInteger(seatIndex) || seatIndex < 0 || seatIndex >= room.maxSeats) {
      fail(SEAT_TAKEN);
    }
    const mine = await membership(ctx, args.roomId, user._id);
    // Private rooms need the passphrase gate first: sitting down without
    // membership would bypass it. Public rooms may seat-and-join in one go.
    if (mine === null && room.visibility === "private") {
      fail(JOIN_DENIED);
    }
    if (mine !== null && mine !== undefined && mine.seatIndex >= 0 && mine.state !== "left") {
      fail(ALREADY_SEATED);
    }
    // Occupant of that chair — `by_room_seat` is (roomId, seatIndex).
    const rival = await ctx.db
      .query("seats")
      .withIndex("by_room_seat", (q) => q.eq("roomId", args.roomId).eq("seatIndex", seatIndex))
      .first();
    if (rival !== null && rival !== undefined && rival.userId !== user._id && rival.state !== "left") {
      fail(SEAT_TAKEN);
    }
    if (user.balance < room.buyIn) {
      fail(INSUFFICIENT_BALANCE);
    }
    const now = Date.now();
    // Atomic balance→stack move (single transaction — 05 §4).
    await ctx.db.patch("users", user._id, { balance: user.balance - room.buyIn });
    if (mine === null || mine === undefined) {
      await ctx.db.insert("seats", {
        roomId: args.roomId,
        userId: user._id,
        seatIndex,
        stack: room.buyIn,
        state: "seated",
        joinedAt: now,
        lastSeenAt: now,
      });
    } else {
      await ctx.db.patch("seats", mine._id, {
        seatIndex,
        stack: room.buyIn,
        state: "seated",
        lastSeenAt: now,
      });
    }
    await ctx.db.patch("rooms", args.roomId, { lastActivityAt: now });
    await maybeAutoResume(ctx, args.roomId);
    return { stack: room.buyIn };
  },
});

// ------------------------------------------------- stand up / leave

export const standUp = mutation({
  args: { sessionToken: v.string(), roomId: v.id("rooms") },
  returns: v.object({ balance: v.number() }),
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);
    const room = await ctx.db.get("rooms", args.roomId);
    if (room === null) {
      fail(JOIN_DENIED);
    }
    const mine = await membership(ctx, args.roomId, user._id);
    if (mine === null) {
      fail(JOIN_DENIED);
    }
    // 05 §4 mid-hand rule: fold through the engine first (committed chips stay
    // in the pot), then the seat's uncommitted stack is cashed back out.
    await foldMidHand(ctx, args.roomId, user._id);
    const current = await membership(ctx, args.roomId, user._id);
    if (current === null) {
      fail(JOIN_DENIED);
    }
    const now = Date.now();
    const balance = user.balance + current.stack;
    // Atomic balance↔stack move (single transaction — 05 §4).
    await ctx.db.patch("users", user._id, { balance });
    await ctx.db.patch("seats", mine._id, {
      seatIndex: -1,
      stack: 0,
      state: "left",
      lastSeenAt: now,
    });
    await ctx.db.patch("rooms", args.roomId, { lastActivityAt: now });
    return { balance };
  },
});

// Stand-up without money bookkeeping surprises: cash out a seated member,
// then drop the membership document. Host migration / auto-close per 05 §5.
export const leaveRoom = mutation({
  args: { sessionToken: v.string(), roomId: v.id("rooms") },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);
    const room = await ctx.db.get("rooms", args.roomId);
    if (room === null) {
      fail(JOIN_DENIED);
    }
    const mine = await membership(ctx, args.roomId, user._id);
    if (mine === null) {
      fail(NOT_A_MEMBER);
    }
    // 05 §4: leaving is always allowed, mid-hand included (fold first).
    await foldMidHand(ctx, args.roomId, user._id);
    const current = await membership(ctx, args.roomId, user._id);
    if (current === null) {
      fail(NOT_A_MEMBER);
    }
    const now = Date.now();
    if (current.seatIndex >= 0 && current.state !== "left") {
      const balance = user.balance + current.stack;
      await ctx.db.patch("users", user._id, { balance });
    }
    await ctx.db.delete("seats", mine._id);
    // Host migration and auto-close (05 §5): only for a live room.
    if (room.hostId === user._id && room.status !== "closed") {
      const remaining = await members(ctx, args.roomId);
      if (remaining.length === 0) {
        await ctx.db.patch("rooms", args.roomId, {
          status: "closed",
          closedAt: now,
          lastActivityAt: now,
        });
      } else {
        const candidates = seated(remaining).length > 0 ? seated(remaining) : remaining;
        let successor = candidates[0];
        for (const seat of candidates) {
          if (seat.joinedAt < successor.joinedAt) {
            successor = seat;
          }
        }
        await ctx.db.patch("rooms", args.roomId, {
          hostId: successor.userId,
          lastActivityAt: now,
        });
      }
    } else {
      await ctx.db.patch("rooms", args.roomId, { lastActivityAt: now });
    }
    return { ok: true };
  },
});

// ------------------------------------------------------ sit out / top up

export const toggleSitOut = mutation({
  args: {
    sessionToken: v.string(),
    roomId: v.id("rooms"),
    sittingOut: v.boolean(),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);
    const room = await ctx.db.get("rooms", args.roomId);
    if (room === null) {
      fail(JOIN_DENIED);
    }
    if (room.status === "closed") {
      fail(ROOM_CLOSED);
    }
    // Only a physically seated player may toggle (keeps seat + stack — 05 §4).
    const mine = await membership(ctx, args.roomId, user._id);
    if (mine === null || mine.seatIndex < 0 || mine.state === "left") {
      fail(NOT_A_MEMBER);
    }
    await ctx.db.patch("seats", mine._id, {
      state: args.sittingOut ? "sittingOut" : "seated",
      lastSeenAt: Date.now(),
    });
    if (!args.sittingOut) {
      await maybeAutoResume(ctx, args.roomId);
    }
    return { ok: true };
  },
});

// Rebuy (05 §4, relaxed): between hands, or mid-hand for a player who was not
// dealt into the live hand (their seat stack is not in play). Adds
// min(buyIn − stack, balance).
export const topUp = mutation({
  args: { sessionToken: v.string(), roomId: v.id("rooms") },
  returns: v.object({ stack: v.number(), balance: v.number() }),
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);
    const room = await ctx.db.get("rooms", args.roomId);
    if (room === null) {
      fail(JOIN_DENIED);
    }
    const mine = await membership(ctx, args.roomId, user._id);
    if (mine === null || mine.seatIndex < 0 || mine.state === "left") {
      fail(NOT_A_MEMBER);
    }
    if (room.currentHandId !== undefined && room.currentHandId !== null) {
      const hand = await ctx.db.get("hands", room.currentHandId);
      if (hand !== null && hand.stage !== "finished" && hand.players.some((p) => p.userId === user._id)) {
        fail(BETWEEN_HANDS_ONLY);
      }
    }
    const add = Math.max(0, Math.min(room.buyIn - mine.stack, user.balance));
    const stack = mine.stack + add;
    const balance = user.balance - add;
    // Atomic: same transaction moves chips from balance to stack (05 §4).
    await ctx.db.patch("users", user._id, { balance });
    await ctx.db.patch("seats", mine._id, { stack, lastSeenAt: Date.now() });
    await ctx.db.patch("rooms", args.roomId, { lastActivityAt: Date.now() });
    await maybeAutoResume(ctx, args.roomId);
    return { stack, balance };
  },
});

// ------------------------------------------------------ host powers

export const endGame = mutation({
  args: { sessionToken: v.string(), roomId: v.id("rooms") },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);
    const room = await ctx.db.get("rooms", args.roomId);
    if (room === null) {
      fail(JOIN_DENIED);
    }
    if (room.hostId !== user._id) {
      fail(NOT_HOST);
    }
    // Mid-hand (05 §5 relaxed): let the live hand finish, then stop —
    // `startNextHand` sees the flag and returns the room to `waiting`.
    if (await liveHandStage(ctx, room)) {
      await ctx.db.patch("rooms", args.roomId, { stopAfterHand: true, lastActivityAt: Date.now() });
      return { ok: true };
    }
    // An explicit end also cancels any pending automatic restart.
    await ctx.db.patch("rooms", args.roomId, {
      status: "waiting",
      lastActivityAt: Date.now(),
      stopAfterHand: undefined,
      autoResume: undefined,
      resumeAt: undefined,
    });
    return { ok: true };
  },
});

export const closeRoom = mutation({
  args: { sessionToken: v.string(), roomId: v.id("rooms") },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);
    const room = await ctx.db.get("rooms", args.roomId);
    if (room === null) {
      fail(JOIN_DENIED);
    }
    if (room.hostId !== user._id) {
      fail(NOT_HOST);
    }
    // Rejected while a hand is live — host must endGame first (05 §5).
    await rejectIfHandLive(ctx, room);
    const now = Date.now();
    for (const seat of seated(await members(ctx, args.roomId))) {
      await cashOut(ctx, seat.userId, seat);
    }
    await ctx.db.patch("rooms", args.roomId, {
      status: "closed",
      closedAt: now,
      lastActivityAt: now,
    });
    return { ok: true };
  },
});
