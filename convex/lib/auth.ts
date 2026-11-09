// Shared auth helpers used by the SPA (and exercised by backend tests). The
// server mutations return rejection *codes* instead of throwing — see auth.ts
// — so this module is the single place that turns them back into the error
// codes of `08 §1` / `08 §9` (08 §9: clients read `e.data.code`).
import { fail } from "./errors";

/**
 * Perform a keypair login. `login` is a caller-provided *invoker* of
 * `api.auth.login` — in tests this wraps the convextest call; in the SPA it
 * wraps the client's `Convex.callFunction`/generated binding (the reference
 * itself is not directly callable in the test harness, so the helper takes
 * `(args) => invoke(api.auth.login, args)` — 08 §8).
 * Returns `{ sessionToken, user }` on success; otherwise throws a ConvexError
 * payload `{ code: INVALID_CREDENTIALS | CHALLENGE_EXPIRED }` — the same shape
 * the server would have produced, so client error handling (03 §4.3) is
 * unchanged and the two rejection causes stay indistinguishable.
 */
export async function loginWithKeypair(login: any, args: any) {
  const result = await login(args);
  if (result.ok !== true) {
    // INVALID_CREDENTIALS / CHALLENGE_EXPIRED (08 §9).
    fail(result.code);
  }
  return { sessionToken: result.sessionToken, user: result.user };
}
