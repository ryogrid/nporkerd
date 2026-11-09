// The client's view of the server's public projections (design/07 §3). The
// types are *derived from the function references*, never hand-copied, so the
// SPA cannot drift from what `getTableState`/`getRoom` actually return — and
// anything the server does not project is simply not present in these types.
import { api } from "../../convex/_generated/api";
import { FunctionReturnType } from "convex/server";

/** `game.getTableState` — the one query that drives the whole table screen. */
export type TableState = FunctionReturnType<typeof api.game.getTableState>;

/** `rooms.getRoom` — room metadata, membership, presence, host powers. */
export type RoomProfile = FunctionReturnType<typeof api.rooms.getRoom>;

/** One row of `rooms.listPublicRooms`. */
export type LobbyRow = FunctionReturnType<typeof api.rooms.listPublicRooms>[0];

/** One message of `chat.listMessages`. */
export type ChatRow = FunctionReturnType<typeof api.chat.listMessages>[0];

/** `auth.login` payload (the raw session token, returned exactly once). */
export type LoginResult = FunctionReturnType<typeof api.auth.login>;

/** `auth.requestLoginChallenge` payload. */
export type ChallengeResult = FunctionReturnType<typeof api.auth.requestLoginChallenge>;

/** `rooms.createRoom` / `rooms.joinRoom` payloads. */
export type CreateRoomResult = FunctionReturnType<typeof api.rooms.createRoom>;
export type SitDownResult = FunctionReturnType<typeof api.rooms.sitDown>;
export type TopUpResult = FunctionReturnType<typeof api.rooms.topUp>;
export type StandUpResult = FunctionReturnType<typeof api.rooms.standUp>;
export type BalanceResult = FunctionReturnType<typeof api.users.claimFaucet>;
