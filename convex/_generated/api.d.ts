/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as chat from "../chat.js";
import type * as crons from "../crons.js";
import type * as game from "../game.js";
import type * as game_cards from "../game/cards.js";
import type * as game_engine from "../game/engine.js";
import type * as game_evaluator from "../game/evaluator.js";
import type * as game_pots from "../game/pots.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_base64url from "../lib/base64url.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_ed5519 from "../lib/ed5519.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_rng from "../lib/rng.js";
import type * as lib_session from "../lib/session.js";
import type * as rooms from "../rooms.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  chat: typeof chat;
  crons: typeof crons;
  game: typeof game;
  "game/cards": typeof game_cards;
  "game/engine": typeof game_engine;
  "game/evaluator": typeof game_evaluator;
  "game/pots": typeof game_pots;
  "lib/auth": typeof lib_auth;
  "lib/base64url": typeof lib_base64url;
  "lib/constants": typeof lib_constants;
  "lib/ed5519": typeof lib_ed5519;
  "lib/errors": typeof lib_errors;
  "lib/hash": typeof lib_hash;
  "lib/rng": typeof lib_rng;
  "lib/session": typeof lib_session;
  rooms: typeof rooms;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
