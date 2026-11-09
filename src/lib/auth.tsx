// Auth context — design/07 §1 (session token in sessionStorage) plus 03 §5:
// `auth.me` doubles as the profile header and the session-validity check on
// load. `loginWithKeypair` is the client helper the backend comments name
// (`lib/auth.loginWithKeypair`): it performs the 03 §4.1 challenge round-trip
// and re-raises `auth.login`'s returned code as a thrown value, so callers
// observe INVALID_CREDENTIALS / CHALLENGE_EXPIRED exactly as 08 §1 documents.
import { useEffect } from "react";
import { useMutation, useQuery_experimental } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { readSessionToken, clearSessionToken } from "./session";
import { signChallenge } from "./keys";
import { ChallengeResult, LoginResult } from "./projection";
import { PRESENCE_ONLINE_MS } from "../../convex/lib/constants";

/** 08 §2: the client beats `users.heartbeat` every 30 s (presence is cosmetic,
 * 05 §8) — the only client timer that is not presentational. */
const HEARTBEAT_MS = 30_000;

export type MeProfile = {
  userId: Id<"users">;
  username: string;
  balance: number;
  publicKeyFingerprint: string;
  createdAt: number;
};

export type SessionState = {
  status: "anonymous" | "pending" | "signed-in" | "invalid";
  token: string | undefined;
  profile: MeProfile | undefined;
};

/**
 * React hook: read the stored token and validate it with `auth.me`.
 * A rejected `me` clears the stale token so the app offers register/login.
 */
export function useSession(): SessionState {
  const token = readSessionToken();
  if (token === undefined) {
    return { status: "anonymous", token: undefined, profile: undefined };
  }
  const loaded = useQuery_experimental({
    query: api.auth.me,
    args: { sessionToken: token },
    throwOnError: false,
  });
  if (loaded.status === "pending") {
    return { status: "pending", token, profile: undefined };
  }
  if (loaded.status === "error") {
    clearSessionToken();
    return { status: "invalid", token: undefined, profile: undefined };
  }
  return { status: "signed-in", token, profile: loaded.data };
}

/**
 * The 03 §4.1 round-trip in one place (registration reuses it: 03 §3 step 6).
 * The two mutation references are created by the calling page — `useMutation`
 * is a React hook — and are passed in so this helper stays pure logic.
 */
export async function loginWithKeypair(
  username: string,
  secretKey: string,
  requestChallenge: (args: { username: string }) => Promise<ChallengeResult>,
  login: (args: { challengeId: Id<"loginChallenges">; signature: string }) => Promise<LoginResult>,
): Promise<LoginResult> {
  const challenge = await requestChallenge({ username });
  const signature = signChallenge(challenge.challengeId, challenge.nonce, secretKey);
  const outcome = await login({ challengeId: challenge.challengeId, signature });
  if (outcome.ok !== true || outcome.sessionToken === undefined || outcome.user === undefined) {
    // `login` returns rejections with a code (a throw would roll back the
    // attempt counter); re-raise it as a `{ code, data }` payload, the same
    // shape a ConvexError carries, so `errorCopyFor` reads it.
    throw { code: outcome.code ?? "INVALID_CREDENTIALS", data: null };
  }
  return outcome;
}

/** Keeps `lastSeenAt` fresh so presence dots stay honest (05 §8, 08 §2). */
export function PresenceTicker({ token, roomId }: { token: string; roomId?: Id<"rooms"> }) {
  const beat = useMutation(api.users.heartbeat);
  useEffect(() => {
    const timer = setInterval(() => {
      if (roomId === undefined) {
        void beat({ sessionToken: token });
      } else {
        void beat({ sessionToken: token, roomId });
      }
    }, HEARTBEAT_MS);
    return () => {
      void clearInterval(timer);
    };
  }, [token, roomId]);
  return <span className="np-muted">online within {Math.round(PRESENCE_ONLINE_MS / 1000)}s · refreshed every {HEARTBEAT_MS / 1000}s</span>;
}
