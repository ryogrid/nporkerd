// User-facing copy for every code in design/08 §9 (the server never relies on
// the client having done this, but every surfaced failure must read like
// English here). Codes are matched from a ConvexError payload (`error.data`
// = `{ code, data }`) or, as a fallback, from the message text.
//
// The table below is typed as a homomorphic copy of the server's own list
// (`convex/lib/errors.ts`), so the typechecker *is* the Phase 8 error-surface
// sweep: a code the server can produce without copy is a compile error, and so
// is copy for a code the server can never produce.

import {
  CHAT_MIN_INTERVAL_MS,
  FAUCET_AMOUNT,
  FAUCET_COOLDOWN_MS,
} from "../../convex/lib/constants";
import { errorCodes } from "../../convex/lib/errors";

export const ERROR_COPY: { [K in keyof typeof errorCodes]: string } = {
  UNAUTHENTICATED: "Your session is no longer valid — please log in again.",
  INVALID_USERNAME: "That username is not allowed: 3–20 characters, letters, digits and underscore only.",
  INVALID_PUBLIC_KEY: "The key you pasted is not a well-formed nporkerd key.",
  USERNAME_TAKEN: "That name is already taken — try another one (it is matched case-insensitively).",
  INVALID_CREDENTIALS: "Login failed: unknown username or wrong key. Try again, or register if you have no account yet.",
  CHALLENGE_EXPIRED: "That login attempt timed out (5 minutes) — start again from the login page.",
  FAUCET_NOT_ELIGIBLE: `The faucet is only for players under ${FAUCET_AMOUNT.toLocaleString("en-US")} chips.`,
  FAUCET_COOLDOWN: `You already claimed the faucet recently: wait ${FAUCET_COOLDOWN_MS / 3_600_000} hours before claiming again.`,
  INVALID_ROOM_SETTINGS: "The room settings were rejected — check the table limits.",
  JOIN_DENIED: "You cannot join this room: it may be closed, the passphrase may be wrong, or it may not exist.",
  NOT_A_MEMBER: "This belongs to the table: only players who joined can see the table state or use its chat.",
  SEAT_TAKEN: "That seat is already occupied — pick another empty seat.",
  ALREADY_SEATED: "You are already sitting at this table.",
  INSUFFICIENT_BALANCE: "You do not have enough chips in your bankroll to buy in here.",
  ROOM_CLOSED: "That room has closed. Its hand history and chat stay put, but it is no longer playable.",
  NOT_HOST: "Only the room's host may do that.",
  GAME_IN_PROGRESS: "A hand is still in progress — wait until the hand ends.",
  BETWEEN_HANDS_ONLY: "You can only do that between hands.",
  NOT_ENOUGH_PLAYERS: "At least two seated players with chips are needed to start.",
  ALREADY_PLAYING: "This table is already running a game.",
  NOT_IN_HAND: "There is no hand to act in right now.",
  NOT_YOUR_TURN: "It is not your turn — the seat to your left acts first.",
  ILLEGAL_ACTION: "The table rejected that action.",
  INVALID_MESSAGE: "A message must be 1–500 characters once trimmed.",
  RATE_LIMITED: `You are typing too fast: one message per ${CHAT_MIN_INTERVAL_MS / 1000} seconds.`,
};

/** The same table, widened for the runtime lookups by code name. */
const COPY_BY_NAME: Record<string, string> = ERROR_COPY;

/** Every code in 08 §9 — used by the error-surface sweep (Phase 8). */
export function errorCodesHandled(): string[] {
  return Object.keys(errorCodes);
}

export function errorCodeOf(error: unknown): string | undefined {
  const value = error as { code?: unknown; data?: unknown };
  if (typeof value.code === "string") {
    return value.code;
  }
  const data = value.data;
  if (typeof data === "object") {
    const code = (data as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }
  }
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string") {
    for (const code in COPY_BY_NAME) {
      if (message.includes(code)) {
        return code;
      }
    }
  }
  return undefined;
}

/** Sentence to show the user for a failed call. */
export function errorCopyFor(error: unknown): string {
  const code = errorCodeOf(error);
  if (code === undefined) {
    return "The server rejected that request.";
  }
  const copy = COPY_BY_NAME[code];
  return copy === undefined ? "The server rejected that request." : copy;
}

/** Extra hint for the faucet cooldown (the server returns `nextClaimAt`). */
export function faucetHint(error: unknown): string | undefined {
  const data = (error as { data?: unknown }).data;
  if (typeof data !== "object") {
    return undefined;
  }
  const nextClaimAt = (data as { data?: unknown }).data;
  if (typeof nextClaimAt !== "object") {
    return undefined;
  }
  const at = (nextClaimAt as { nextClaimAt?: unknown }).nextClaimAt;
  if (typeof at !== "number") {
    return undefined;
  }
  const minutes = Math.max(0, Math.ceil((at - Date.now()) / 60_000));
  return `Next faucet claim: about ${minutes} minute(s) away.`;
}
