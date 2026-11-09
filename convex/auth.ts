// Authentication — design/03 §3–5, API per 08 §1. Keypair challenge/response
// login: the private key is never sent to the server; the client proves
// possession by signing "nporkerd-login:<challengeId>:<nonce>".
import { mutation, query, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  CHALLENGE_RECHALLENGE_WINDOW_MS,
  CHALLENGE_TTL_MS,
  MAX_CHALLENGE_ATTEMPTS,
  NONCE_BYTES,
  SESSION_TTL_MS,
  SESSION_TOKEN_BYTES,
  STARTING_BALANCE,
  USERNAME_REGEX,
} from "./lib/constants";
import {
  CHALLENGE_EXPIRED,
  fail,
  INVALID_CREDENTIALS,
  INVALID_PUBLIC_KEY,
  INVALID_USERNAME,
  USERNAME_TAKEN,
} from "./lib/errors";
import { requireSession } from "./lib/session";
import { sha256Hex } from "./lib/hash";
import { bytesToBase64Url, textToBytes } from "./lib/base64url";
import { decodePublicKeyBytes, verifyBase64UrlSignature } from "./lib/ed5519";

const LOGIN_MESSAGE_PREFIX = "nporkerd-login:"; // 03 §4.1

/** Fresh random token of `count` bytes, base64url (nonce / session token). */
function randomTokenBase64Url(count: number): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(count)));
}

/** Failed login bookkeeping: bump attempts, invalidate the challenge at MAX. */
async function registerFailedAttempt(ctx: MutationCtx, challenge: Doc<"loginChallenges">) {
  const attempts = challenge.attempts + 1;
  if (attempts >= MAX_CHALLENGE_ATTEMPTS) {
    await ctx.db.delete("loginChallenges", challenge._id);
  } else {
    await ctx.db.patch("loginChallenges", challenge._id, { attempts });
  }
}

export const register = mutation({
  args: { username: v.string(), publicKey: v.string() },
  returns: v.id("users"),
  handler: async (ctx, { username, publicKey }): Promise<Id<"users">> => {
    if (!USERNAME_REGEX.test(username)) {
      fail(INVALID_USERNAME);
    }
    try {
      decodePublicKeyBytes(publicKey); // must decode to exactly 32 bytes
    } catch {
      fail(INVALID_PUBLIC_KEY);
    }
    const usernameLower = username.toLowerCase();
    const existing = await ctx.db
      .query("users")
      .withIndex("by_usernameLower", (q) => q.eq("usernameLower", usernameLower))
      .first();
    if (existing) {
      fail(USERNAME_TAKEN);
    }
    const now = Date.now();
    return await ctx.db.insert("users", {
      username,
      usernameLower,
      publicKey,
      balance: STARTING_BALANCE,
      createdAt: now,
      lastSeenAt: now,
    });
  },
});

export const requestLoginChallenge = mutation({
  args: { username: v.string() },
  returns: v.object({
    challengeId: v.id("loginChallenges"),
    nonce: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, { username }) => {
    if (!USERNAME_REGEX.test(username)) {
      fail(INVALID_USERNAME);
    }
    const now = Date.now();
    const usernameLower = username.toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("by_usernameLower", (q) => q.eq("usernameLower", usernameLower))
      .first();

    if (user) {
      // Newest previous challenge for this user (index orders by creation time).
      const previous = await ctx.db
        .query("loginChallenges")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .order("desc")
        .first();
      if (previous) {
        // Anti-abuse rule (03 §4.3): while a challenge is younger than 5 s,
        // return it unchanged instead of minting a replacement.
        if (
          now < previous.createdAt + CHALLENGE_RECHALLENGE_WINDOW_MS &&
          previous.expiresAt >= now
        ) {
          return {
            challengeId: previous._id,
            nonce: previous.nonce,
            expiresAt: previous.expiresAt,
          };
        }
        await ctx.db.delete("loginChallenges", previous._id);
      }
    }
    // Unknown usernames get a well-formed "phantom" challenge bound to no
    // user (userId omitted): responses are identical, so registration cannot
    // be used to probe which usernames exist (03 §4.3). Previous phantom
    // challenges cannot be looked up (no userId index) and expire via cron.
    const nonce = randomTokenBase64Url(NONCE_BYTES);
    const expiresAt = now + CHALLENGE_TTL_MS;
    const challengeId = await ctx.db.insert(
      "loginChallenges",
      user
        ? { userId: user._id, nonce, createdAt: now, expiresAt, attempts: 0 }
        : { nonce, createdAt: now, expiresAt, attempts: 0 },
    );
    return { challengeId, nonce, expiresAt };
  },
});

// `login` outcome: success carries the session; rejection carries an error
// code (INVALID_CREDENTIALS / CHALLENGE_EXPIRED, 08 §9). The `returns`
// validator mirrors this: `ok` plus the fields of the winning branch.
export const login = mutation({
  args: { challengeId: v.id("loginChallenges"), signature: v.string() },
  returns: v.object({
    ok: v.boolean(),
    code: v.optional(v.string()),
    sessionToken: v.optional(v.string()),
    user: v.optional(
      v.object({
        userId: v.id("users"),
        username: v.string(),
        balance: v.number(),
      }),
    ),
  }),
  // Rejection is RETURNED with its code, not thrown, because a throwing
  // mutation rolls back: the attempt counter below (and the 5-attempt
  // invalidation, and the expired-challenge delete) would be discarded. The
  // shared client helper `lib/auth.loginWithKeypair` re-throws the same code,
  // so clients keep observing INVALID_CREDENTIALS / CHALLENGE_EXPIRED exactly
  // as 08 §1 and 03 §4.3 specify.
  handler: async (ctx, { challengeId, signature }) => {
    const now = Date.now();
    const challenge = await ctx.db.get("loginChallenges", challengeId);
    if (!challenge) {
      // Used up / never existed: the generic error keeps "no such user" and
      // "bad signature" indistinguishable (03 §4.3).
      return { ok: false, code: INVALID_CREDENTIALS };
    }
    if (challenge.expiresAt < now) {
      await ctx.db.delete("loginChallenges", challenge._id);
      return { ok: false, code: CHALLENGE_EXPIRED };
    }
    const user = challenge.userId
      ? await ctx.db.get("users", challenge.userId)
      : null;
    if (!user) {
      await registerFailedAttempt(ctx, challenge);
      return { ok: false, code: INVALID_CREDENTIALS };
    }
    // 03 §4.1: the signed message binds the challenge id AND the nonce.
    const message = textToBytes(`${LOGIN_MESSAGE_PREFIX}${challengeId}:${challenge.nonce}`);
    if (!verifyBase64UrlSignature(signature, message, user.publicKey)) {
      await registerFailedAttempt(ctx, challenge);
      return { ok: false, code: INVALID_CREDENTIALS };
    }
    // Success: single-use challenge (delete), mint session token.
    await ctx.db.delete("loginChallenges", challenge._id);
    const sessionToken = `nps_${randomTokenBase64Url(SESSION_TOKEN_BYTES)}`;
    const tokenHash = await sha256Hex(sessionToken);
    await ctx.db.insert("sessions", {
      userId: user._id,
      tokenHash,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });
    return {
      ok: true,
      sessionToken,
      user: { userId: user._id, username: user.username, balance: user.balance },
    };
  },
});

export const logout = mutation({
  args: { sessionToken: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { sessionToken }) => {
    const { session } = await requireSession(ctx, sessionToken);
    await ctx.db.delete("sessions", session._id);
    return { ok: true };
  },
});

export const me = query({
  args: { sessionToken: v.string() },
  returns: v.object({
    userId: v.id("users"),
    username: v.string(),
    balance: v.number(),
    publicKeyFingerprint: v.string(),
    createdAt: v.number(),
  }),
  handler: async (ctx, { sessionToken }) => {
    const { user } = await requireSession(ctx, sessionToken);
    // Fingerprint for the UI (03 §2): first 10 hex of SHA-256(publicKey).
    const fingerprint = (await sha256Hex(user.publicKey)).slice(0, 10);
    return {
      userId: user._id,
      username: user.username,
      balance: user.balance,
      publicKeyFingerprint: fingerprint,
      createdAt: user.createdAt,
    };
  },
});
