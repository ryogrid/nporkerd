// Room chat — design/06 (behaviour) with the API surface of 08 §5.
// Chat is per room (no global chat, no DMs): only members may read or post,
// usernames are joined from `users` at query time (06 §3), and bodies are
// stored verbatim after trimming — the client renders them as text nodes.
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  CHAT_MAX_LENGTH,
  CHAT_MIN_INTERVAL_MS,
  CHAT_WINDOW,
} from "./lib/constants";
import {
  fail,
  INVALID_MESSAGE,
  JOIN_DENIED,
  NOT_A_MEMBER,
  RATE_LIMITED,
  ROOM_CLOSED,
} from "./lib/errors";
import { requireSession } from "./lib/session";

/** Membership document for (room, user), or null (05 §3: membership ⇔ member). */
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

export const listMessages = query({
  args: { sessionToken: v.string(), roomId: v.id("rooms") },
  returns: v.array(
    v.object({
      id: v.id("chatMessages"),
      userId: v.id("users"),
      username: v.string(),
      body: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);
    const room = await ctx.db.get("rooms", args.roomId);
    if (room === null) {
      fail(JOIN_DENIED);
    }
    // 06 §2: closed rooms are not reachable through the API (documents stay).
    if (room.status === "closed") {
      fail(ROOM_CLOSED);
    }
    // 06 §2: non-members get nothing
    if (await membership(ctx, args.roomId, user._id) === null) {
      fail(NOT_A_MEMBER);
    }
    // 06 §2: the newest CHAT_WINDOW, oldest-to-newest (reactive query)
    const newest = await ctx.db
      .query("chatMessages")
      .withIndex("by_room_createdAt", (q) => q.eq("roomId", args.roomId))
      .order("desc")
      .take(CHAT_WINDOW);
    const out = [];
    for (const m of newest.reverse()) {
      const person = await ctx.db.get("users", m.userId);
      out.push({
        id: m._id,
        userId: m.userId,
        // 06 §3: current username, never taken from the message document
        username: person === null ? "" : person.username,
        body: m.body,
        createdAt: m.createdAt,
      });
    }
    return out;
  },
});

/** Insert the newest message per (room, user) — the rate-limit window. */
async function lastMessageAt(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  userId: Id<"users">,
): Promise<number> {
  const found = await ctx.db
    .query("chatMessages")
    .withIndex("by_room_createdAt", (q) => q.eq("roomId", roomId))
    .order("desc")
    .filter((q) => q.eq(q.field("userId"), userId))
    .first();
  return found === null || found === undefined ? -1 : found.createdAt;
}

export const sendMessage = mutation({
  args: { sessionToken: v.string(), roomId: v.id("rooms"), body: v.string() },
  returns: v.object({ messageId: v.id("chatMessages") }),
  handler: async (ctx, args) => {
    const { user } = await requireSession(ctx, args.sessionToken);
    const room = await ctx.db.get("rooms", args.roomId);
    if (room === null) {
      fail(JOIN_DENIED);
    }
    if (room.status === "closed") {
      fail(ROOM_CLOSED); // 06 §2: chat is unreachable once a room closes
    }
    if (await membership(ctx, args.roomId, user._id) === null) {
      fail(NOT_A_MEMBER);
    }
    // 06 §2: trim, then the length rules
    const body = args.body.trim();
    if (body === "" || body.length > CHAT_MAX_LENGTH) {
      fail(INVALID_MESSAGE, { max: CHAT_MAX_LENGTH, length: body.length });
    }
    // 06 §2: at most one message per CHAT_MIN_INTERVAL_MS per user per room
    const now = Date.now();
    const previous = await lastMessageAt(ctx, args.roomId, user._id);
    if (previous !== -1 && now - previous < CHAT_MIN_INTERVAL_MS) {
      fail(RATE_LIMITED, { retryInMs: CHAT_MIN_INTERVAL_MS - (now - previous) });
    }
    const messageId = await ctx.db.insert("chatMessages", {
      roomId: args.roomId,
      userId: user._id,
      body,
      createdAt: now,
    });
    // chat counts as activity: it keeps a room out of the stale-room window
    await ctx.db.patch("rooms", args.roomId, { lastActivityAt: now });
    return { messageId };
  },
});
