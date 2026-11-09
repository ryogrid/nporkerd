// /login — design/07 §2.2 (protocol in 03 §4.1/§4.2): username + private key
// pasted or uploaded as the key file saved at registration; the local
// fingerprint of the pasted key is displayed so the user can compare it with
// the registration screen; every failure shows the same sentence (03 §4.3).
import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { USERNAME_MAX, USERNAME_MIN, USERNAME_REGEX } from "../../convex/lib/constants";
import { describeSecretKey, parseKeyFile } from "../lib/keys";
import { loginWithKeypair } from "../lib/auth";
import { writeSessionToken } from "../lib/session";
import { LobbyPage } from "./LobbyPage";

/** 03 §4.3: one sentence for every failure mode. */
const GENERIC_FAILURE = "Login failed: unknown username or wrong key.";

export function LoginPage({ navigate }: { navigate: (path: string) => void }) {
  const requestChallenge = useMutation(api.auth.requestLoginChallenge);
  const login = useMutation(api.auth.login);
  const usernameField = useRef<HTMLInputElement>(null);
  const keyField = useRef<HTMLInputElement>(null);
  const fileField = useRef<HTMLInputElement>(null);
  const [fingerprint, setFingerprint] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [signedIn, setSignedIn] = useState<{ token: string; username: string; balance: number } | undefined>(undefined);

  // `keyOverride` lets an uploaded key file feed the same path as a paste.
  async function submit(keyOverride: string | undefined): Promise<void> {
    setNotice(undefined);
    const username = (usernameField.current?.value ?? "").trim();
    if (username.length < USERNAME_MIN || username.length > USERNAME_MAX || !USERNAME_REGEX.test(username)) {
      setNotice(`usernames are ${USERNAME_MIN}–${USERNAME_MAX} characters of letters, digits and underscore`);
      return;
    }
    const typed = keyOverride ?? parseKeyFile(keyField.current?.value ?? "");
    if (typed === undefined) {
      setNotice("Paste the npk_… key, or choose the key file you downloaded at registration.");
      return;
    }
    try {
      // 03 §4.2: the fingerprint of the pasted key is shown before the server
      // is involved, which catches most wrong-key pastes locally.
      const described = describeSecretKey(typed);
      setFingerprint(described.fingerprint);
      const signed = await loginWithKeypair(username, typed, requestChallenge, login);
      const token = signed.sessionToken;
      const user = signed.user;
      if (token === undefined || token === null || user === undefined || user === null) {
        setNotice(GENERIC_FAILURE);
        return;
      }
      writeSessionToken(token);
      setSignedIn({ token, username: user.username, balance: user.balance });
    } catch (e) {
      // never distinguish "no such user" from "bad signature" (03 §4.3)
      setNotice(GENERIC_FAILURE);
    }
  }

  async function useUploadedFile(file: File): Promise<void> {
    const body = await file.text();
    const parsed = parseKeyFile(body);
    if (parsed === undefined) {
      setNotice("That file does not contain a nporkerd key — use the one you downloaded at registration.");
      return;
    }
    await submit(parsed);
  }

  if (signedIn !== undefined) {
    // On success the lobby takes over (07 §2.2).
    return (
      <LobbyPage
        token={signedIn.token}
        username={signedIn.username}
        balance={signedIn.balance}
        navigate={() => navigate("/lobby")}
      />
    );
  }

  return (
    <div className="np-card">
      <h2 className="np-title">Log in</h2>
      <div className="np-field">
        <label>Username</label>
        <input ref={usernameField} type="text" />
      </div>
      <div className="np-field">
        <label>Private key (paste it — it starts with npk_)</label>
        <input ref={keyField} type="text" />
      </div>
      <div className="np-field">
        <label>Or choose the key file from registration</label>
        <input
          ref={fileField}
          type="file"
          onChange={(event) => {
            const picked = (event.target as HTMLInputElement).files;
            if (picked === null || picked === undefined) {
              return;
            }
            if (picked.length > 0) {
              void useUploadedFile(picked[0]);
            }
          }}
        />
      </div>
      {fingerprint === undefined ? null : (
        <div className="np-muted">Key fingerprint: {fingerprint} — compare it with the one shown at registration.</div>
      )}
      {notice === undefined ? null : <div className="np-error">{notice}</div>}
      <button type="button" onClick={() => void submit(undefined)}>Log in</button>
      <div className="np-muted">
        No account yet? <span className="np-muted">open /register to create one.</span>
      </div>
    </div>
  );
}
