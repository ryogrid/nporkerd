// Single source of truth for game/account constants — design/02 §8.
// These are shared by server code and (via import) the SPA where needed.

// Play-money bankroll every user starts with (chips).
export const STARTING_BALANCE = 10_000;

// Faucet: broke users may top up. Global rule (design/02 §8 note): a claim is
// allowed only when balance < FAUCET_AMOUNT, once per cooldown.
export const FAUCET_AMOUNT = 1_000;
export const FAUCET_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 h

// Auth lifetimes.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, not sliding
export const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 min
export const CHALLENGE_RECHALLENGE_WINDOW_MS = 5_000; // <5s: same nonce returned
export const MAX_CHALLENGE_ATTEMPTS = 5; // challenge invalidated at 5
export const NONCE_BYTES = 32; // base64url, 32 random bytes
export const SESSION_TOKEN_BYTES = 32; // base64url, 32 random bytes

// Username format (also checked client-side before the call).
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_REGEX = /^[A-Za-z0-9_]{3,20}$/;

// Room settings bounds (design/02 §4).
export const ROOM_NAME_MAX = 40;
export const MAX_SEATS_MIN = 2;
export const MAX_SEATS_MAX = 9;
export const TURN_SECONDS_MIN = 10;
export const TURN_SECONDS_MAX = 120; // 0 = clock off

// Chat (design/02 §7, design/06 §3).
export const CHAT_MAX_LENGTH = 500;
export const CHAT_MIN_INTERVAL_MS = 800; // rate limit
export const CHAT_WINDOW = 100; // newest 100 shown

// Engine pacing (design/04 §8).
export const NEXT_HAND_DELAY_MS = 5_000;
export const STREET_DEAL_DELAY_MS = 1_200; // all-in runout pacing

// Cleanup policy (design/05 §8, cron hourly).
export const ROOM_STALE_MS = 30 * 60 * 1000; // no activity -> auto-close
export const ROOM_CLOSED_DELETE_MS = 7 * 24 * 60 * 60 * 1000; // delete after
export const EMPTY_LOBBY_KEEP_MS = 10 * 60 * 1000; // lobby shows <10min-only
