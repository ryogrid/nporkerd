// /register — design/07 §2.1 (steps of 03 §3): username → local keypair →
// `auth.register` → the key reveal screen (mandatory acknowledgement) →
// automatic login through the challenge round-trip → lobby. The private key
// lives in this component's memory only: shown once, copyable, downloadable,
// and dropped after login (03 §3 final paragraph; D-04 records the alternative).
import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { USERNAME_MAX, USERNAME_MIN, USERNAME_REGEX } from "../../convex/lib/constants";
import { PrivateKeyDisplay } from "../components/PrivateKeyDisplay";
import { generateKeyPair } from "../lib/keys";
import { writeSessionToken } from "../lib/session";
import { LobbyPage } from "./LobbyPage";
import { errorCodeOf, errorCopyFor } from "../lib/errorCopy";
import { loginWithKeypair } from "../lib/auth";

export function RegisterPage({ navigate }: { navigate: (path: string) => void }) {
  const register = useMutation(api.auth.register);
  const requestChallenge = useMutation(api.auth.requestLoginChallenge);
  const login = useMutation(api.auth.login);
  const usernameField = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<"form" | "reveal" | "done">("form");
  const [keys, setKeys] = useState<{ username: string; publicKey: string; secretKey: string; fingerprint: string } | undefined>(undefined);
  const [acknowledged, setAcknowledged] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [signedIn, setSignedIn] = useState<{ token: string; username: string; balance: number } | undefined>(undefined);

  async function registerNow(): Promise<void> {
    setNotice(undefined);
    const username = (usernameField.current?.value ?? "").trim();
    const problems = localUsernameProblems(username);
    if (problems.length > 0) {
      setNotice(problems.join(", "));
      return;
    }
    const pair = generateKeyPair();
    try {
      await register({ username, publicKey: pair.publicKey });
      setKeys({ username, publicKey: pair.publicKey, secretKey: pair.secretKey, fingerprint: pair.fingerprint });
      setStage("reveal");
    } catch (e) {
      setNotice(
        errorCodeOf(e) === "USERNAME_TAKEN"
          ? "That name is taken — pick another (names are matched case-insensitively)."
          : errorCopyFor(e),
      );
    }
  }

  // 03 §3 step 6: registration implies possession, so log straight in and
  // drop the key from memory once the session exists.
  async function finishLogin(): Promise<void> {
    if (keys === undefined) {
      return;
    }
    try {
      const signed = await loginWithKeypair(keys.username, keys.secretKey, requestChallenge, login);
      const token = signed.sessionToken;
      const user = signed.user;
      if (token === undefined || token === null || user === undefined || user === null) {
        setNotice("The server logged you in but returned no session — try again.");
        return;
      }
      writeSessionToken(token);
      setSignedIn({ token, username: user.username, balance: user.balance });
      // The key itself is dropped: only the downloaded file keeps it (03 §3).
      setKeys(undefined);
      setStage("done");
    } catch (e) {
      setNotice(errorCopyFor(e));
    }
  }

  if (stage === "done" && signedIn !== undefined) {
    // State-based hand-off (07 §1: routing is state-based).
    return (
      <LobbyPage
        token={signedIn.token}
        username={signedIn.username}
        balance={signedIn.balance}
        navigate={() => navigate("/lobby")}
      />
    );
  }

  if (keys === undefined) {
    return (
      <div className="np-card">
        <h2 className="np-title">Create an account</h2>
        <div className="np-field">
          <label>
            Username ({USERNAME_MIN}–{USERNAME_MAX} characters: letters, digits,
            underscore)
          </label>
          <input ref={usernameField} type="text" />
        </div>
        <div className="np-muted">
          An Ed25519 key pair is generated in your browser; the private half is
          shown exactly once after this and never stored by the app.
        </div>
        {notice === undefined ? null : <div className="np-error">{notice}</div>}
        <button type="button" onClick={() => void registerNow()}>Create account</button>
      </div>
    );
  }

  return (
    <PrivateKeyDisplay
      username={keys.username}
      secretKey={keys.secretKey}
      fingerprint={keys.fingerprint}
      acknowledged={acknowledged}
      onAcknowledge={(checked) => setAcknowledged(checked)}
      onContinue={() => void finishLogin()}
    />
  );
}

function localUsernameProblems(username: string): string[] {
  const problems: string[] = [];
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    problems.push(`usernames are ${USERNAME_MIN}–${USERNAME_MAX} characters`);
  }
  if (!USERNAME_REGEX.test(username)) {
    problems.push("only letters, digits and underscore are allowed");
  }
  return problems;
}
