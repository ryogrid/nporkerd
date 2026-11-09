// Session context. The raw token lives in sessionStorage (dies with the tab);
// `auth.me` validates it and supplies the live profile (balance is reactive).
// `loginWithKeypair` performs the challenge round-trip of design/03 §4.1.
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery_experimental } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { clearSessionToken, readSessionToken, writeSessionToken } from "./session";
import { signChallenge } from "./keys";
import { ChallengeResult, LoginResult } from "./projection";

/** Heartbeat cadence; presence is cosmetic (design/05 §8). */
const HEARTBEAT_MS = 30_000;

export type MeProfile = FunctionReturnType<typeof api.auth.me>;

export type SessionStatus = "anonymous" | "pending" | "signed-in";

type SessionValue = {
  status: SessionStatus;
  token: string | undefined;
  me: MeProfile | undefined;
  /** True when a stored token was rejected (expired / logged out elsewhere). */
  expired: boolean;
  signIn: (token: string) => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | undefined>(() => readSessionToken());
  const [expired, setExpired] = useState(false);
  const logout = useMutation(api.auth.logout);
  const me = useQuery_experimental({
    query: api.auth.me,
    args: token === undefined ? "skip" : { sessionToken: token },
    throwOnError: false,
  });

  // A rejected token is dropped (outside render, so no state update loops).
  useEffect(() => {
    if (token !== undefined && me.status === "error") {
      clearSessionToken();
      setToken(undefined);
      setExpired(true);
    }
  }, [token, me.status]);

  const signIn = useCallback((next: string) => {
    writeSessionToken(next);
    setExpired(false);
    setToken(next);
  }, []);

  const signOut = useCallback(async () => {
    const current = token;
    clearSessionToken();
    setToken(undefined);
    if (current !== undefined) {
      try {
        await logout({ sessionToken: current });
      } catch {
        // the token is gone locally either way
      }
    }
  }, [token, logout]);

  const value = useMemo<SessionValue>(() => {
    const status: SessionStatus =
      token === undefined ? "anonymous" : me.status === "success" ? "signed-in" : "pending";
    return {
      status,
      token,
      me: me.status === "success" ? me.data : undefined,
      expired,
      signIn,
      signOut,
    };
  }, [token, me, expired, signIn, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === undefined) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return value;
}

/** Challenge → sign → login. Throws `{ code }` on rejection (errorCopy reads it). */
export async function loginWithKeypair(
  username: string,
  secretKey: string,
  requestChallenge: (args: { username: string }) => Promise<ChallengeResult>,
  login: (args: { challengeId: Id<"loginChallenges">; signature: string }) => Promise<LoginResult>,
): Promise<{ token: string }> {
  const challenge = await requestChallenge({ username });
  const signature = signChallenge(challenge.challengeId, challenge.nonce, secretKey);
  const outcome = await login({ challengeId: challenge.challengeId, signature });
  if (outcome.ok !== true || outcome.sessionToken === undefined) {
    throw { code: outcome.code ?? "INVALID_CREDENTIALS", data: null };
  }
  return { token: outcome.sessionToken };
}

/** Keeps `lastSeenAt` fresh: one beat immediately, then every 30 s. */
export function usePresence(token: string | undefined, roomId?: Id<"rooms">): void {
  const beat = useMutation(api.users.heartbeat);
  useEffect(() => {
    if (token === undefined) {
      return;
    }
    const send = () => {
      const args = roomId === undefined ? { sessionToken: token } : { sessionToken: token, roomId };
      beat(args).catch(() => undefined);
    };
    send();
    const timer = window.setInterval(send, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [token, roomId, beat]);
}
