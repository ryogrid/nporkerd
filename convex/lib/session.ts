// Session gate for all authenticated functions — design/03 §5.
// Throws UNAUTHENTICATED for missing/expired sessions. Raw session tokens live
// only on the client; at rest we store SHA-256 hex (schema §2).
import { Doc } from "../_generated/dataModel";
import { QueryCtx, MutationCtx } from "../_generated/server";
import { fail, UNAUTHENTICATED } from "./errors";
import { sha256Hex } from "./hash";

export async function requireSession(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<{ session: Doc<"sessions">; user: Doc<"users"> }> {
  // Cheap shape check first so obviously-junk tokens never hit the database.
  if (!token || token.length > 64) {
    fail(UNAUTHENTICATED);
  }
  const tokenHash = await sha256Hex(token);
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!session) {
    fail(UNAUTHENTICATED);
  }
  const now = Date.now();
  if (session.expiresAt < now) {
    fail(UNAUTHENTICATED);
  }
  const user = await ctx.db.get("users", session.userId);
  if (!user) {
    fail(UNAUTHENTICATED);
  }
  return { session, user };
}
