// Error codes — the complete list in design/08 §9. The server always throws
// `ConvexError` with a `{ code, data? }` payload; clients map codes to
// user-facing text and must never rely on having done the mapping.
import { ConvexError, Value } from "convex/values";

export const UNAUTHENTICATED = "UNAUTHENTICATED";
export const INVALID_USERNAME = "INVALID_USERNAME";
export const INVALID_PUBLIC_KEY = "INVALID_PUBLIC_KEY";
export const USERNAME_TAKEN = "USERNAME_TAKEN";
export const INVALID_CREDENTIALS = "INVALID_CREDENTIALS";
export const CHALLENGE_EXPIRED = "CHALLENGE_EXPIRED";
export const FAUCET_NOT_ELIGIBLE = "FAUCET_NOT_ELIGIBLE";
export const FAUCET_COOLDOWN = "FAUCET_COOLDOWN";
export const INVALID_ROOM_SETTINGS = "INVALID_ROOM_SETTINGS";
export const JOIN_DENIED = "JOIN_DENIED";
export const NOT_A_MEMBER = "NOT_A_MEMBER";
export const SEAT_TAKEN = "SEAT_TAKEN";
export const ALREADY_SEATED = "ALREADY_SEATED";
export const INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE";
export const ROOM_CLOSED = "ROOM_CLOSED";
export const NOT_HOST = "NOT_HOST";
export const GAME_IN_PROGRESS = "GAME_IN_PROGRESS";
export const BETWEEN_HANDS_ONLY = "BETWEEN_HANDS_ONLY";
export const NOT_ENOUGH_PLAYERS = "NOT_ENOUGH_PLAYERS";
export const ALREADY_PLAYING = "ALREADY_PLAYING";
export const NOT_IN_HAND = "NOT_IN_HAND";
export const NOT_YOUR_TURN = "NOT_YOUR_TURN";
export const ILLEGAL_ACTION = "ILLEGAL_ACTION";
export const INVALID_MESSAGE = "INVALID_MESSAGE";
export const RATE_LIMITED = "RATE_LIMITED";

/** All codes keyed by name — handy for exhaustive switches and tests. */
export const errorCodes = {
  UNAUTHENTICATED,
  INVALID_USERNAME,
  INVALID_PUBLIC_KEY,
  USERNAME_TAKEN,
  INVALID_CREDENTIALS,
  CHALLENGE_EXPIRED,
  FAUCET_NOT_ELIGIBLE,
  FAUCET_COOLDOWN,
  INVALID_ROOM_SETTINGS,
  JOIN_DENIED,
  NOT_A_MEMBER,
  SEAT_TAKEN,
  ALREADY_SEATED,
  INSUFFICIENT_BALANCE,
  ROOM_CLOSED,
  NOT_HOST,
  GAME_IN_PROGRESS,
  BETWEEN_HANDS_ONLY,
  NOT_ENOUGH_PLAYERS,
  ALREADY_PLAYING,
  NOT_IN_HAND,
  NOT_YOUR_TURN,
  ILLEGAL_ACTION,
  INVALID_MESSAGE,
  RATE_LIMITED,
};

/** Throw a server-visible ConvexError carrying `{ code, data }`. */
export function fail(code: string, data: Value | null = null): never {
  throw new ConvexError<{ code: string; data: Value | null }>({ code, data });
}
