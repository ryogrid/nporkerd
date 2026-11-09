import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Full data model per design/02-data-model.md. Money is integer chips
// everywhere. `hands` is server-secret: no public query ever returns it
// (design/00 §5); only game.* functions read it, and getTableState projects.

export default defineSchema({
  // §1 users — one document per registered account.
  users: defineTable({
    username: v.string(),
    usernameLower: v.string(),
    publicKey: v.string(), // Ed25519 public key, base64url (32 bytes decoded)
    balance: v.number(), // play-money bankroll; never negative
    lastFaucetAt: v.optional(v.number()),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  }).index("by_usernameLower", ["usernameLower"]),

  // §2 sessions — one per live login; ephemeral, cron-deleted after expiry.
  sessions: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(), // SHA-256 hex; raw token lives only on the client
    createdAt: v.number(),
    expiresAt: v.number(), // createdAt + SESSION_TTL_MS (not sliding)
    userAgent: v.optional(v.string()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_user", ["userId"])
    .index("by_expiresAt", ["expiresAt"]),

  // §3 login challenges — short-lived nonces; ephemeral, cron-deleted.
  // NOTE: `userId` is optional per design/03 §4.3: a challenge issued for an
  // unknown username is a "phantom" bound to no user, so registration cannot
  // be used to probe which usernames exist.
  loginChallenges: defineTable({
    userId: v.optional(v.id("users")),
    nonce: v.string(), // 32 random bytes, base64url
    createdAt: v.number(),
    expiresAt: v.number(), // createdAt + CHALLENGE_TTL_MS
    attempts: v.number(), // challenge invalidated at MAX_CHALLENGE_ATTEMPTS
  })
    .index("by_user", ["userId"])
    .index("by_expiresAt", ["expiresAt"]),

  // §4 rooms — lobby + its single table.
  rooms: defineTable({
    name: v.string(),
    hostId: v.id("users"),
    visibility: v.union(v.literal("public"), v.literal("private")),
    passphraseHash: v.optional(v.string()), // present iff private; SHA-256 hex
    status: v.union(
      v.literal("waiting"),
      v.literal("playing"),
      v.literal("closed"),
    ),
    maxSeats: v.number(), // 2..9
    smallBlind: v.number(),
    bigBlind: v.number(), // > smallBlind
    buyIn: v.number(),
    turnSeconds: v.number(), // 0 = off, else 10..120
    currentHandId: v.optional(v.id("hands")),
    lastActivityAt: v.number(),
    createdAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index("by_status_visibility", ["status", "visibility"])
    .index("by_host", ["hostId"])
    .index("by_lastActivityAt", ["lastActivityAt"]),

  // §5 seats — one document per (room, user) membership.
  seats: defineTable({
    roomId: v.id("rooms"),
    userId: v.id("users"),
    seatIndex: v.number(), // 0..maxSeats-1, unique within room
    stack: v.number(),
    state: v.union(
      v.literal("seated"),
      v.literal("sittingOut"),
      v.literal("left"),
    ),
    joinedAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_room_user", ["roomId", "userId"])
    .index("by_room_seat", ["roomId", "seatIndex"]),

  // §6 hands — SERVER-SECRET document (design/00 §5).
  hands: defineTable({
    roomId: v.id("rooms"),
    handNumber: v.number(), // per-room sequence, starts at 1
    stage: v.union(
      v.literal("preflop"),
      v.literal("flop"),
      v.literal("turn"),
      v.literal("river"),
      v.literal("showdown"),
      v.literal("finished"),
    ),
    deck: v.array(v.number()), // remaining cards 0-51, top = last element
    board: v.array(v.number()), // revealed community cards
    players: v.array(
      v.object({
        userId: v.id("users"),
        seatIndex: v.number(),
        holeCards: v.array(v.number()),
        stackStart: v.number(),
        betStreet: v.number(),
        betTotal: v.number(), // drives side pots
        status: v.union(
          v.literal("active"),
          v.literal("folded"),
          v.literal("allIn"),
          v.literal("out"), // reserved by 02; the engine never emits it
        ),
        hasActed: v.boolean(), // engine-internal reducer state
      }),
    ),
    pots: v.array(
      v.object({
        amount: v.number(),
        eligibleUserIds: v.array(v.id("users")),
      }),
    ),
    dealerSeat: v.number(),
    currentTurnSeat: v.optional(v.number()),
    currentBet: v.number(),
    minRaise: v.number(),
    turnSeq: v.number(), // bumps on EVERY state change; guards callbacks
    turnDeadline: v.optional(v.number()), // epoch ms, absent iff turnSeconds=0
    lastAction: v.optional(
      v.object({
        seatIndex: v.number(),
        kind: v.union(
          v.literal("fold"),
          v.literal("check"),
          v.literal("call"),
          v.literal("raiseTo"),
          v.literal("allIn"),
          v.literal("timeout-check"), // 04 §8: auto-timeout labels
          v.literal("timeout-fold"),
        ),
        amount: v.optional(v.number()),
        at: v.number(),
      }),
    ),
    // Per-player action/timeout tallies for the auto-sit-out rule (04 §9):
    // a player whose every action of a hand timed out sits out next hand.
    timeoutStats: v.array(
      v.object({
        userId: v.id("users"),
        timeouts: v.number(),
        actions: v.number(),
      }),
    ),
    result: v.optional(
      v.object({
        winners: v.array(
          v.object({
            userId: v.id("users"),
            amount: v.number(),
            handRankLabel: v.optional(v.string()),
          }),
        ),
        revealedUserIds: v.array(v.id("users")),
      }),
    ),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_room", ["roomId"])
    .index("by_room_handNumber", ["roomId", "handNumber"]),

  // §7 chat messages.
  chatMessages: defineTable({
    roomId: v.id("rooms"),
    userId: v.id("users"),
    body: v.string(), // 1..500 chars after trimming; rendered as text, never HTML
    createdAt: v.number(),
  }).index("by_room_createdAt", ["roomId", "createdAt"]),
});
