// User-level authenticated operations — design/08 §2.
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { FAUCET_AMOUNT, FAUCET_COOLDOWN_MS } from "./lib/constants";
import { fail, FAUCET_COOLDOWN, FAUCET_NOT_ELIGIBLE } from "./lib/errors";
import { requireSession } from "./lib/session";

export const heartbeat = mutation({
  args: {
    sessionToken: v.string(),
    roomId: v.optional(v.id("rooms")),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { sessionToken, roomId }) => {
    const { user } = await requireSession(ctx, sessionToken);
    const now = Date.now();
    await ctx.db.patch("users", user._id, { lastSeenAt: now });
    if (roomId) {
      // Caller's seat in that room, if any (presence display only — 05 §8).
      const seats = await ctx.db
        .query("seats")
        .withIndex("by_room_user", (q) => q.eq("roomId", roomId))
        .collect();
      for (const seat of seats) {
        if (seat.userId === user._id) {
          await ctx.db.patch("seats", seat._id, { lastSeenAt: now });
        }
      }
    }
    return { ok: true };
  },
});

export const claimFaucet = mutation({
  args: { sessionToken: v.string() },
  returns: v.object({ balance: v.number() }),
  handler: async (ctx, { sessionToken }) => {
    const { user } = await requireSession(ctx, sessionToken);
    const now = Date.now();
    // Rule (02 §8): claim only when balance < FAUCET_AMOUNT, once per cooldown.
    // The cooldown is reported first so the client gets the retry hint
    // (`nextClaimAt`) in the common "just claimed" case; a user who is
    // permanently above the line gets FAUCET_NOT_ELIGIBLE.
    const lastFaucetAt = user.lastFaucetAt;
    if (lastFaucetAt !== undefined && now - lastFaucetAt < FAUCET_COOLDOWN_MS) {
      fail(FAUCET_COOLDOWN, { nextClaimAt: lastFaucetAt + FAUCET_COOLDOWN_MS });
    }
    if (user.balance >= FAUCET_AMOUNT) {
      fail(FAUCET_NOT_ELIGIBLE);
    }
    const balance = user.balance + FAUCET_AMOUNT;
    await ctx.db.patch("users", user._id, { balance, lastFaucetAt: now });
    return { balance };
  },
});
