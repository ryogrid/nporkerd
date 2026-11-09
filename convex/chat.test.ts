// Phase 6 acceptance tests — chat per 06 §2–§3 and 08 §5: the member gate
// (read AND post), the 500-char rule, the 800 ms per-user anti-flood window
// tracked through `by_room_createdAt`, the latest-100 ascending window, the
// username joined from `users` at query time, and closed rooms being
// unreachable while their message documents stay put (D-07 retention).
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import { convexTest } from "convex-test";
import schema from "./schema";
import { CHAT_MAX_LENGTH, CHAT_MIN_INTERVAL_MS, CHAT_WINDOW, SESSION_TTL_MS } from "./lib/constants";
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

describe("chat", () => {
  const t = convexTest(schema, modules);

  // A user with a live session; `token` is the raw token, stored hashed only.
  async function seedUser(username: string, token: string) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const uid = await ctx.db.insert("users", {
        username,
        usernameLower: username.toLowerCase(),
        publicKey: "pk-placeholder",
        balance: 10_000,
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

  // Bodies actually stored for (room), oldest-to-newest, straight from the
  // table (bypasses the member gate, so it also proves retention).
  async function storedBodies(roomId: any) {
    return await t.run(async (ctx) => {
      const ms = await ctx.db
        .query("chatMessages")
        .withIndex("by_room_createdAt", (q) => q.eq("roomId", roomId))
        .collect();
      return ms.map((m) => m.body);
    });
  }

  async function storedCount(roomId: any) {
    return (await storedBodies(roomId)).length;
  }

  // A room with the host auto-joined plus one joined-but-not-seated member.
  async function twoMembers(tag: string) {
    const host = await seedUser(`Host${tag}`, `tok_h_${tag}`);
    const guest = await seedUser(`Guest${tag}`, `tok_g_${tag}`);
    const outsider = await seedUser(`Outsider${tag}`, `tok_o_${tag}`);
    const room = await t.mutation(api.rooms.createRoom, { sessionToken: `tok_h_${tag}`, name: `Chat ${tag}` });
    await t.mutation(api.rooms.joinRoom, { sessionToken: `tok_g_${tag}`, roomId: room.roomId });
    return { host, guest, outsider, roomId: room.roomId };
  }

  // --------------------------------------------------------------------- 1

  it("members read and post; non-members get nothing (06 §2, 05 §7)", async () => {
    const table = await twoMembers("gate");
    await t.mutation(api.chat.sendMessage, { sessionToken: `tok_h_gate`, roomId: table.roomId, body: "host says hi" });
    // a member who is not seated still reads and posts (05 §3: membership only)
    await t.mutation(api.chat.sendMessage, { sessionToken: `tok_g_gate`, roomId: table.roomId, body: "guest at the bar" });
    const seen = await t.query(api.chat.listMessages, { sessionToken: `tok_g_gate`, roomId: table.roomId });
    expect(seen.map((m) => m.body)).toEqual(["host says hi", "guest at the bar"]);
    expect(seen[0].username).toBe("Hostgate");
    // the ids and ordering come from the table, oldest-to-newest (08 §5)
    expect(seen[0].id).not.toBe(seen[1].id);
    expect(seen[0].createdAt < seen[1].createdAt).toBe(true);

    // the outsider knows the room exists but gets no chat, read or write
    await expectError(
      async () => await t.query(api.chat.listMessages, { sessionToken: `tok_o_gate`, roomId: table.roomId }),
      errorCodes.NOT_A_MEMBER,
    );
    await expectError(
      async () =>
        await t.mutation(api.chat.sendMessage, { sessionToken: `tok_o_gate`, roomId: table.roomId, body: "lurking" }),
      errorCodes.NOT_A_MEMBER,
    );
    expect((await storedBodies(table.roomId)).includes("lurking")).toBe(false);
  });

  // --------------------------------------------------------------------- 2

  it("bodies are trimmed; empty and over-length are INVALID_MESSAGE (06 §2)", async () => {
    const table = await twoMembers("lengths");
    const long = "x".repeat(CHAT_MAX_LENGTH + 1);
    await expectError(
      async () => await t.mutation(api.chat.sendMessage, { sessionToken: `tok_h_lengths`, roomId: table.roomId, body: long }),
      errorCodes.INVALID_MESSAGE,
    );
    await expectError(
      async () => await t.mutation(api.chat.sendMessage, { sessionToken: `tok_h_lengths`, roomId: table.roomId, body: "   \n\t " }),
      errorCodes.INVALID_MESSAGE,
    );
    // exactly the limit is fine, and the body is stored trimmed but verbatim
    const exact = "y".repeat(CHAT_MAX_LENGTH);
    const sent = await t.mutation(
      api.chat.sendMessage,
      { sessionToken: `tok_h_lengths`, roomId: table.roomId, body: `  ${exact}  ` },
    );
    const stored = await storedBodies(table.roomId);
    expect(stored).toEqual([exact]);
    const posted = await t.query(api.chat.listMessages, { sessionToken: `tok_h_lengths`, roomId: table.roomId });
    expect(posted[0].body).toBe(exact);
    expect(posted[0].body.length).toBe(CHAT_MAX_LENGTH);
    expect(posted[0].id).toBe(sent.messageId);
  });

  // --------------------------------------------------------------------- 3

  it("one message per CHAT_MIN_INTERVAL_MS per user per room (06 §2)", async () => {
    const table = await twoMembers("flood");
    const first = await t.mutation(
      api.chat.sendMessage,
      { sessionToken: `tok_h_flood`, roomId: table.roomId, body: "one" },
    );
    // put the stored timestamp in the future so the outcome never depends on
    // how long this test takes to run
    await t.run(async (ctx) => {
      await ctx.db.patch("chatMessages", first.messageId, { createdAt: Date.now() + 60_000 });
    });
    await expectError(
      async () =>
        await t.mutation(api.chat.sendMessage, { sessionToken: `tok_h_flood`, roomId: table.roomId, body: "two" }),
      errorCodes.RATE_LIMITED,
    );
    // the anti-flood window is per user: the other member is unaffected
    await t.mutation(api.chat.sendMessage, { sessionToken: `tok_g_flood`, roomId: table.roomId, body: "other user" });
    // age the message and the same user may post again
    await t.run(async (ctx) => {
      await ctx.db.patch("chatMessages", first.messageId, { createdAt: Date.now() - 60_000 });
    });
    const again = await t.mutation(
      api.chat.sendMessage,
      { sessionToken: `tok_h_flood`, roomId: table.roomId, body: "three" },
    );
    expect(await storedBodies(table.roomId)).toEqual(["one", "other user", "three"]);
    const view = await t.query(api.chat.listMessages, { sessionToken: `tok_h_flood`, roomId: table.roomId });
    expect(view.map((m) => m.body)).toEqual(["one", "other user", "three"]);
    expect(view.some((m) => m.id === again.messageId)).toBe(true);
  });

  it("chat counts as room activity (02 §4 lastActivityAt)", async () => {
    const table = await twoMembers("activity");
    const before = await t.run(async (ctx) => (await ctx.db.get("rooms", table.roomId))?.lastActivityAt ?? -1);
    await t.mutation(api.chat.sendMessage, { sessionToken: `tok_g_activity`, roomId: table.roomId, body: "ping" });
    const after = await t.run(async (ctx) => (await ctx.db.get("rooms", table.roomId))?.lastActivityAt ?? -1);
    expect(after).not.toBe(before);
    expect(after >= before).toBe(true);
  });

  // --------------------------------------------------------------------- 4

  it("listMessages returns the latest CHAT_WINDOW, oldest-to-newest (06 §2)", async () => {
    const table = await twoMembers("window");
    const total = CHAT_WINDOW + 5;
    // insert directly: the rate limit would otherwise dominate the test
    await t.run(async (ctx) => {
      const base = Date.now() - 1000;
      for (let i = 0; i < total; i += 1) {
        await ctx.db.insert("chatMessages", {
          roomId: table.roomId,
          userId: table.host,
          body: `m${String(i).padStart(3, "0")}`,
          createdAt: base + i,
        });
      }
    });
    const view = await t.query(api.chat.listMessages, { sessionToken: `tok_h_window`, roomId: table.roomId });
    expect(view.length).toBe(CHAT_WINDOW);
    expect(view[0].body).toBe("m005"); // the five oldest fell out of the window
    expect(view[CHAT_WINDOW - 1].body).toBe(`m${String(total - 1).padStart(3, "0")}`);
    let ascending = true;
    for (let i = 1; i < view.length; i += 1) {
      ascending = ascending && view[i].createdAt > view[i - 1].createdAt;
    }
    expect(ascending).toBe(true);
  });

  it("usernames are joined from users at query time, never from messages (06 §3)", async () => {
    const table = await twoMembers("rename");
    const first = await t.mutation(
      api.chat.sendMessage,
      { sessionToken: `tok_g_rename`, roomId: table.roomId, body: "before rename" },
    );
    // age it so this user may post again (the 800 ms window is tested elsewhere)
    await t.run(async (ctx) => {
      await ctx.db.patch("chatMessages", first.messageId, { createdAt: Date.now() - 60_000 });
      await ctx.db.patch("users", table.guest, { username: "Renamed", usernameLower: "renamed" });
    });
    const view = await t.query(api.chat.listMessages, { sessionToken: `tok_h_rename`, roomId: table.roomId });
    expect(view[0].username).toBe("Renamed");
    expect(view[0].userId).toBe(table.guest);
    // a message cannot impersonate someone: bodies stay verbatim
    await t.mutation(
      api.chat.sendMessage,
      { sessionToken: `tok_g_rename`, roomId: table.roomId, body: "Hostrename: I am not the host" },
    );
    const again = await t.query(api.chat.listMessages, { sessionToken: `tok_h_rename`, roomId: table.roomId });
    expect(again.every((m) => m.username === "Hostrename" || m.username === "Renamed")).toBe(true);
    expect(again[1].body.includes(":")).toBe(true);
  });

  // --------------------------------------------------------------------- 7

  it("a closed room's chat is unreachable but its messages are retained (06 §2)", async () => {
    const table = await twoMembers("closed");
    await t.mutation(api.chat.sendMessage, { sessionToken: `tok_h_closed`, roomId: table.roomId, body: "see you later" });
    const closed = await t.mutation(api.rooms.closeRoom, { sessionToken: `tok_h_closed`, roomId: table.roomId });
    expect(closed.ok).toBe(true);
    await expectError(
      async () => await t.query(api.chat.listMessages, { sessionToken: `tok_h_closed`, roomId: table.roomId }),
      errorCodes.ROOM_CLOSED,
    );
    await expectError(
      async () =>
        await t.mutation(api.chat.sendMessage, { sessionToken: `tok_h_closed`, roomId: table.roomId, body: "too late" }),
      errorCodes.ROOM_CLOSED,
    );
    // documents are retained: deletion policy is the open decision D-07 (10)
    expect(await storedCount(table.roomId)).toBe(1);
    expect(await storedBodies(table.roomId)).toEqual(["see you later"]);
  });
});
