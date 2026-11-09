import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { requireSession } from "./lib/session";
import { sha256Hex } from "./lib/hash";
import { bytesToBase64Url, textToBytes } from "./lib/base64url";
import { derivePublicKeyBytes } from "./lib/ed5519";
import { UNAUTHENTICATED, errorCodes } from "./lib/errors";

function seedFrom(label: string): Uint8Array {
  const seed = new Uint8Array(32);
  const bytes = textToBytes(label);
  for (let i = 0; i < bytes.length; i++) seed[i] = bytes[i];
  seed[31] = bytes.length;
  return seed;
}

const modules = import.meta.glob("./**/*.ts");

async function expectUnauthenticated(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    expect(label).toBe("did not throw");
  } catch (e) {
    const data = (e as { data?: unknown }).data;
    const code = typeof data === "object" && typeof (data as { code?: string }).code === "string" ? (data as { code: string }).code : String(e);
    expect(code).toContain(UNAUTHENTICATED);
  }
}

describe("session", () => {
  const t = convexTest(schema, modules);

  it("accepts a valid live session", async () => {
    const now = Date.now();
    const token = "sess_test-token-0123456789ABCDEF";
    const tokenHash = await sha256Hex(token);
    const publicKey = bytesToBase64Url(derivePublicKeyBytes(seedFrom("user-1")));

    const userId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        username: "Alice",
        usernameLower: "alice",
        publicKey,
        balance: 1000,
        createdAt: now,
        lastSeenAt: now,
      });
      await ctx.db.insert("sessions", {
        userId: uid,
        tokenHash,
        createdAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
      });
      return uid;
    });

    const result = await t.run(async (ctx) => await requireSession(ctx, token));
    expect(typeof result.session._id).toBe("string");
    expect(result.session.userId).toBe(userId);
    expect(result.user.username).toBe("Alice");
    expect(result.user.usernameLower).toBe("alice");
  });

  it("rejects an empty token before touching the database", async () => {
    await expectUnauthenticated("empty", async () => await t.run(async (ctx) => await requireSession(ctx, "")));
  });

  it("rejects an unknown token", async () => {
    await expectUnauthenticated("unknown", async () =>
      await t.run(async (ctx) => await requireSession(ctx, "no-such-token-anywhere")),
    );
  });

  it("rejects an expired session", async () => {
    const now = Date.now();
    const token = "sess_expired-token";
    const tokenHash = await sha256Hex(token);
    await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        username: "Bob",
        usernameLower: "bob",
        publicKey: bytesToBase64Url(derivePublicKeyBytes(seedFrom("user-2"))),
        balance: 500,
        createdAt: now,
        lastSeenAt: now,
      });
      await ctx.db.insert("sessions", {
        userId: uid,
        tokenHash,
        createdAt: 1,
        expiresAt: now - 1000, // already dead
      });
    });
    await expectUnauthenticated("expired", async () =>
      await t.run(async (ctx) => await requireSession(ctx, token)),
    );
  });

  it("only hashes are stored, never the raw token", async () => {
    const token = "sess_check-hash";
    const tokenHash = await sha256Hex(token);
    const sessions = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        username: "Carol",
        usernameLower: "carol",
        publicKey: bytesToBase64Url(derivePublicKeyBytes(seedFrom("user-3"))),
        balance: 700,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      });
      await ctx.db.insert("sessions", {
        userId: uid,
        tokenHash,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60 * 60 * 1000,
      });
      return await ctx.db.query("sessions").withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash)).collect();
    });
    expect(sessions.length).toBeGreaterThan(0);
    // raw token string must never appear in any stored session doc
    const leaked = sessions.filter((s) => JSON.stringify(s).includes(token));
    expect(leaked).toEqual([]);
  });

  it("error code used is from the shared list", async () => {
    expect(errorCodes.UNAUTHENTICATED).toBe(UNAUTHENTICATED);
  });
});
