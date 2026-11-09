// Phase 2 acceptance tests: register -> challenge -> login round-trip,
// duplicate username, generic rejection for the wrong key, expired challenge,
// session token stored only as SHA-256 (03 §2/§4.3, 02 §7).
import { describe, it, expect } from "vitest";
import { api } from "./_generated/api";
import { convexTest } from "convex-test";
import schema from "./schema";
import { CHALLENGE_TTL_MS, SESSION_TTL_MS, FAUCET_AMOUNT, FAUCET_COOLDOWN_MS } from "./lib/constants";
import { errorCodes } from "./lib/errors";
import { sha256Hex } from "./lib/hash";
import { bytesToBase64Url, textToBytes } from "./lib/base64url";
import { derivePublicKeyBytes, signBase64Url } from "./lib/ed5519";
import { loginWithKeypair } from "./lib/auth";

const modules = import.meta.glob("./**/*.ts");

function seedFrom(label: string): Uint8Array {
  const seed = new Uint8Array(32);
  const bytes = textToBytes(label);
  for (let i = 0; i < bytes.length; i++) seed[i] = bytes[i];
  seed[31] = bytes.length;
  return seed;
}

function errorCodeOf(e: unknown): string {
  const data = (e as { data?: unknown }).data;
  if (typeof data === "object" && typeof (data as { code?: string }).code === "string") {
    return (data as { code: string }).code;
  }
  return String(e);
}

async function expectError(fn: () => Promise<unknown>, code: string) {
  let threw = false;
  try {
    await fn();
  } catch (e) {
    threw = true;
    expect(errorCodeOf(e)).toContain(code);
  }
  expect(threw, "expected the call to throw").toBe(true);
}

function codeOf(result: unknown): string {
  const code = (result as { code?: string }).code ?? "";
  return code;
}

function okOf(result: unknown): boolean {
  return (result as { ok?: boolean }).ok === true;
}

describe("auth", () => {
  const t = convexTest(schema, modules);

  // `api.auth.login` is a Convex FunctionReference; what tests (and the SPA,
  // via the client) need is something *callable*, so this harness wraps the
  // reference in the convextest invocation. `loginWithKeypair` (08 §8) takes
  // any such invoker.
  const invokeLogin = (args: any) => t.mutation(api.auth.login, args);

  it("register creates the user with STARTING_BALANCE", async () => {
    const seed = seedFrom("alice");
    const publicKey = bytesToBase64Url(derivePublicKeyBytes(seed));
    const userId = await t.mutation(api.auth.register, { username: "Alice", publicKey });
    const user = await t.query(async (ctx) => ctx.db.get("users", userId));
    expect(user?.username).toBe("Alice");
    expect(user?.usernameLower).toBe("alice");
    expect(user?.publicKey).toBe(publicKey);
    expect(user?.balance).toBe(FAUCET_AMOUNT * 10); // STARTING_BALANCE
  });

  it("register validates username and public key", async () => {
    await expectError(
      async () => await t.mutation(api.auth.register, { username: "ab", publicKey: "AA" }),
      errorCodes.INVALID_USERNAME,
    );
    await expectError(
      async () =>
        await t.mutation(api.auth.register, { username: "bad user!", publicKey: "AAAA" }),
      errorCodes.INVALID_USERNAME,
    );
    await expectError(
      async () => await t.mutation(api.auth.register, { username: "Alice", publicKey: "!!" }),
      errorCodes.INVALID_PUBLIC_KEY,
    );
    await expectError(
      async () => await t.mutation(api.auth.register, { username: "Alice", publicKey: "AAAAAAAA" }),
      errorCodes.INVALID_PUBLIC_KEY,
    );
  });

  it("duplicate username (case-insensitive) is taken", async () => {
    const seed = seedFrom("bob");
    const publicKey = bytesToBase64Url(derivePublicKeyBytes(seed));
    await t.mutation(api.auth.register, { username: "Bob", publicKey });
    await expectError(
      async () => await t.mutation(api.auth.register, { username: "bOb", publicKey }),
      errorCodes.USERNAME_TAKEN,
    );
  });

  it("full challenge -> login round-trip", async () => {
    const seed = seedFrom("carol");
    const publicKey = bytesToBase64Url(derivePublicKeyBytes(seed));
    await t.mutation(api.auth.register, { username: "Carol", publicKey });

    const challenge = await t.mutation(api.auth.requestLoginChallenge, { username: "Carol" });
    expect(challenge.nonce.length).toBe(43); // base64url of 32 bytes
    expect(challenge.expiresAt > Date.now()).toBe(true);

    // re-issue within 5 s returns the SAME challenge (anti-abuse rule)
    const again = await t.mutation(api.auth.requestLoginChallenge, { username: "Carol" });
    expect(again.challengeId).toBe(challenge.challengeId);
    expect(again.nonce).toBe(challenge.nonce);

    // client signs "nporkerd-login:<challengeId>:<nonce>" (03 §4.1)
    const message = textToBytes(`nporkerd-login:${challenge.challengeId}:${challenge.nonce}`);
    const signature = signBase64Url(message, seed);
    const result = await loginWithKeypair(
      invokeLogin,
      { challengeId: challenge.challengeId, signature },
    );
    expect(result.sessionToken.startsWith("nps_")).toBe(true);
    expect(result.user.username).toBe("Carol");

    // the raw token must never be at rest; its SHA-256 must be
    const tokenHash = await sha256Hex(result.sessionToken);
    const session = await t.run(async (ctx) =>
      await ctx.db
        .query("sessions")
        .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
        .unique(),
    );
    expect((session?.expiresAt ?? 0) > Date.now() + SESSION_TTL_MS - 60_000).toBe(true);

    // challenge is single-use: deleted on successful login
    const gone = await t.run(async (ctx) => await ctx.db.get("loginChallenges", challenge.challengeId));
    expect(gone).toBe(null);

    const profile = await t.query(api.auth.me, { sessionToken: result.sessionToken });
    expect(profile.username).toBe("Carol");
    expect(profile.publicKeyFingerprint).toBe((await sha256Hex(publicKey)).slice(0, 10));
    expect(profile.balance).toBe(FAUCET_AMOUNT * 10);
  });

  it("login with the wrong key fails generically, 5 attempts invalidate", async () => {
    const seed = seedFrom("dave");
    const publicKey = bytesToBase64Url(derivePublicKeyBytes(seed));
    await t.mutation(api.auth.register, { username: "Dave", publicKey });
    const challenge = await t.mutation(api.auth.requestLoginChallenge, { username: "Dave" });
    const message = textToBytes(`nporkerd-login:${challenge.challengeId}:${challenge.nonce}`);

    const wrongSig = signBase64Url(message, seedFrom("mallory"));
    for (let i = 1; i <= 5; i++) {
      const attempt = await t.mutation(
        api.auth.login,
        { challengeId: challenge.challengeId, signature: wrongSig },
      );
      // always the generic code: never "no such user" / "bad signature"
      expect(okOf(attempt)).toBe(false);
      expect(codeOf(attempt)).toBe(errorCodes.INVALID_CREDENTIALS);
      if (i < 5) {
        // 03 §4.3: the attempt counter persists until the limit.
        const current = await t.run(async (ctx) => await ctx.db.get("loginChallenges", challenge.challengeId));
        expect(current?.attempts).toBe(i);
      }
    }
    // after the 5th the challenge is gone; re-login with it stays generic
    const gone = await t.run(async (ctx) => await ctx.db.get("loginChallenges", challenge.challengeId));
    expect(gone).toBe(null);
    await expectError(
      async () =>
        await loginWithKeypair(invokeLogin, { challengeId: challenge.challengeId, signature: wrongSig }),
      errorCodes.INVALID_CREDENTIALS,
    );
  });

  it("phantom challenge for unknown username behaves identically", async () => {
    const challenge = await t.mutation(api.auth.requestLoginChallenge, { username: "NoSuchUser" });
    expect(challenge.nonce.length).toBe(43);
    const message = textToBytes(`nporkerd-login:${challenge.challengeId}:${challenge.nonce}`);
    const sig = signBase64Url(message, seedFrom("anyone"));
    const attempt = await t.mutation(api.auth.login, { challengeId: challenge.challengeId, signature: sig });
    expect(okOf(attempt)).toBe(false);
    expect(codeOf(attempt)).toBe(errorCodes.INVALID_CREDENTIALS);
    const stored = await t.run(async (ctx) => await ctx.db.get("loginChallenges", challenge.challengeId));
    expect(stored?.userId).toBeUndefined(); // phantom: bound to no user
  });

  it("expired challenge -> CHALLENGE_EXPIRED and is deleted", async () => {
    const staleId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("loginChallenges", {
        nonce: "x".repeat(43),
        createdAt: Date.now() - CHALLENGE_TTL_MS - 5000,
        expiresAt: Date.now() - CHALLENGE_TTL_MS - 1000,
        attempts: 0,
      });
      return id;
    });
    const attempt = await t.mutation(api.auth.login, { challengeId: staleId, signature: "AAAAAAAA" });
    expect(okOf(attempt)).toBe(false);
    expect(codeOf(attempt)).toBe(errorCodes.CHALLENGE_EXPIRED);
    const gone = await t.run(async (ctx) => await ctx.db.get("loginChallenges", staleId));
    expect(gone).toBe(null);
    // A second attempt now targets a deleted challenge: per 08 §9 that is the
    // generic INVALID_CREDENTIALS ("no such challenge"), not CHALLENGE_EXPIRED.
    await expectError(
      async () => await loginWithKeypair(invokeLogin, { challengeId: staleId, signature: "AAAAAAAA" }),
      errorCodes.INVALID_CREDENTIALS,
    );
  });

  it("me rejects an invalid session token", async () => {
    await expectError(
      async () => await t.query(api.auth.me, { sessionToken: "nps_bogus" }),
      errorCodes.UNAUTHENTICATED,
    );
  });

  it("logout deletes the session and later calls fail", async () => {
    const seed = seedFrom("erin");
    const publicKey = bytesToBase64Url(derivePublicKeyBytes(seed));
    await t.mutation(api.auth.register, { username: "Erin", publicKey });
    const challenge = await t.mutation(api.auth.requestLoginChallenge, { username: "Erin" });
    const message = textToBytes(`nporkerd-login:${challenge.challengeId}:${challenge.nonce}`);
    const result = await loginWithKeypair(
      invokeLogin,
      { challengeId: challenge.challengeId, signature: signBase64Url(message, seed) },
    );
    const profile = await t.query(api.auth.me, { sessionToken: result.sessionToken });
    expect(profile.username).toBe("Erin");
    await t.mutation(api.auth.logout, { sessionToken: result.sessionToken });
    await expectError(
      async () => await t.query(api.auth.me, { sessionToken: result.sessionToken }),
      errorCodes.UNAUTHENTICATED,
    );
  });
});

describe("users", () => {
  const t = convexTest(schema, modules);

  // Insert a poor user with a live session; returns the user's id. `token`
  // doubles as the session token (its SHA-256 is what's stored at rest).
  async function seedUser(username: string, balance: number, token: string) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const uid = await ctx.db.insert("users", {
        username,
        usernameLower: username.toLowerCase(),
        publicKey: bytesToBase64Url(derivePublicKeyBytes(seedFrom(username))),
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

  it("heartbeat updates lastSeenAt and the caller's seat", async () => {
    const hbToken = "hb_token";
    const user = await seedUser("Frank", 500, hbToken);
    // A minimal room + seat document so the seat-presence path runs.
    const roomId = await t.run(async (ctx) =>
      await ctx.db.insert("rooms", {
        name: "hb room",
        hostId: user,
        visibility: "public",
        status: "waiting",
        maxSeats: 6,
        smallBlind: 5,
        bigBlind: 10,
        buyIn: 1000,
        turnSeconds: 30,
        lastActivityAt: 1,
        createdAt: 1,
      }),
    );
    const seat = await t.run(async (ctx) =>
      await ctx.db.insert("seats", {
        roomId,
        userId: user,
        seatIndex: 2,
        stack: 1000,
        state: "seated",
        joinedAt: 1,
        lastSeenAt: 7,
      }),
    );
    const first = await t.mutation(api.users.heartbeat, { sessionToken: hbToken });
    expect(first.ok).toBe(true);
    const userNow = await t.run(async (ctx) => (await ctx.db.get("users", user))?.lastSeenAt ?? 0);
    const seatNow = await t.run(async (ctx) => (await ctx.db.get("seats", seat))?.lastSeenAt ?? 0);
    expect(userNow > 1).toBe(true);
    expect(seatNow).toBe(7); // without roomId the seat is untouched (08 §2)

    const second = await t.mutation(api.users.heartbeat, { sessionToken: hbToken, roomId });
    expect(second.ok).toBe(true);
    const seatAfter = await t.run(async (ctx) => (await ctx.db.get("seats", seat))?.lastSeenAt ?? 0);
    const userAfter = await t.run(async (ctx) => (await ctx.db.get("users", user))?.lastSeenAt ?? 0);
    expect(seatAfter).toBe(userAfter); // one Date.now() stamps both
  });

  it("heartbeat with an unknown token is UNAUTHENTICATED", async () => {
    await expectError(
      async () => await t.mutation(api.users.heartbeat, { sessionToken: "no_such_token" }),
      errorCodes.UNAUTHENTICATED,
    );
  });

  it("claimFaucet tops up broke users, then enforces the cooldown", async () => {
    const ftToken = "faucet_token";
    const user = await seedUser("Penny", 500, ftToken);
    const res = await t.mutation(api.users.claimFaucet, { sessionToken: ftToken });
    expect(res.balance).toBe(500 + FAUCET_AMOUNT);
    // Chips moved to a table (Phase 3 sit-downs) take the balance back below
    // FAUCET_AMOUNT, so the cooldown rule is what blocks the next claim.
    await t.run(async (ctx) => await ctx.db.patch("users", user, { balance: 100 }));
    let nextClaimAt = 0;
    try {
      await t.mutation(api.users.claimFaucet, { sessionToken: ftToken });
      expect("re-claim within cooldown").toBe("must be rejected");
    } catch (e) {
      expect(errorCodeOf(e)).toContain(errorCodes.FAUCET_COOLDOWN);
      const data = (e as { data?: { data?: { nextClaimAt?: number } } }).data?.data;
      nextClaimAt = data?.nextClaimAt ?? 0;
    }
    // The retry hint is the claim time plus the cooldown window.
    const claimedAt = await t.run(async (ctx) => (await ctx.db.get("users", user))?.lastFaucetAt ?? 0);
    expect(nextClaimAt).toBe(claimedAt + FAUCET_COOLDOWN_MS);
    // A thrown rejection rolls the mutation back (no balance/counter change).
    const after = await t.run(async (ctx) => await ctx.db.get("users", user));
    expect(after?.balance).toBe(100);
  });

  it("claimFaucet rejects well-resourced users", async () => {
    const rich = await seedUser("Rich", FAUCET_AMOUNT * 10, "rich_token");
    void rich;
    await expectError(
      async () => await t.mutation(api.users.claimFaucet, { sessionToken: "rich_token" }),
      errorCodes.FAUCET_NOT_ELIGIBLE,
    );
  });
});
