// Registration: pick a name → a keypair is generated locally → the private key
// is shown once (copy / download, mandatory acknowledgement) → automatic login.
import { FormEvent, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { USERNAME_MAX, USERNAME_MIN, USERNAME_REGEX } from "../../convex/lib/constants";
import { buildKeyFile, generateKeyPair } from "../lib/keys";
import { errorCodeOf, errorCopyFor } from "../lib/errorCopy";
import { loginWithKeypair, useSession } from "../lib/auth";
import { Navigate } from "../lib/router";

type Keys = { username: string; publicKey: string; secretKey: string; fingerprint: string };

export function RegisterPage({ navigate, afterAuth }: { navigate: Navigate; afterAuth: string }) {
  const register = useMutation(api.auth.register);
  const requestChallenge = useMutation(api.auth.requestLoginChallenge);
  const login = useMutation(api.auth.login);
  const session = useSession();
  const [username, setUsername] = useState("");
  const [keys, setKeys] = useState<Keys | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const nameProblem = username === "" ? undefined
    : username.length < USERNAME_MIN || username.length > USERNAME_MAX ? `${USERNAME_MIN}–${USERNAME_MAX} characters`
    : !USERNAME_REGEX.test(username) ? "letters, digits and underscore only" : undefined;

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault();
    const name = username.trim();
    if (name === "" || nameProblem !== undefined || busy) {
      setError(nameProblem === undefined ? "Pick a username first." : `Username: ${nameProblem}.`);
      return;
    }
    setError(undefined);
    setBusy(true);
    const pair = generateKeyPair();
    try {
      await register({ username: name, publicKey: pair.publicKey });
      setKeys({ username: name, ...pair });
    } catch (err) {
      setError(errorCodeOf(err) === "USERNAME_TAKEN" ? "That name is taken — try another." : errorCopyFor(err));
    } finally {
      setBusy(false);
    }
  }

  async function finish(): Promise<void> {
    if (keys === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const { token } = await loginWithKeypair(keys.username, keys.secretKey, requestChallenge, login);
      setKeys(undefined); // the key is dropped; only the user's copy remains
      session.signIn(token);
      navigate(afterAuth, { replace: true });
    } catch (err) {
      setError(errorCopyFor(err));
      setBusy(false);
    }
  }

  if (keys === undefined) {
    return (
      <div className="auth-wrap">
        <form className="panel panel-pad stack" onSubmit={(e) => void create(e)}>
          <h1 className="panel-title">Create your account</h1>
          <label className="field">
            <span>Username</span>
            <input
              className={`input${nameProblem !== undefined ? " invalid" : ""}`}
              autoFocus
              autoComplete="username"
              value={username}
              maxLength={USERNAME_MAX}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. river_rat"
            />
            <small>{nameProblem ?? `${USERNAME_MIN}–${USERNAME_MAX} letters, digits or underscores.`}</small>
          </label>
          <p className="faint" style={{ margin: 0 }}>
            A cryptographic key is generated right here in your browser. It is your password: you'll
            save it on the next step, and nobody (including us) can recover it.
          </p>
          {error === undefined ? null : <div className="error-text" role="alert">{error}</div>}
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </button>
          <div className="auth-switch">
            Already have a key? <button type="button" className="link-btn" onClick={() => navigate("/login")}>Log in</button>
          </div>
        </form>
      </div>
    );
  }

  const file = buildKeyFile(keys.username, keys.secretKey, keys.fingerprint);
  const href = `data:text/plain;charset=utf-8,${encodeURIComponent(file)}`;

  return (
    <div className="auth-wrap">
      <div className="panel panel-pad stack">
        <h1 className="panel-title">Save your key, {keys.username}</h1>
        <div className="warning">
          <span aria-hidden="true">⚠️</span>
          <span>This key is your password. It is shown <b>only once</b>. Lose it and the account is gone for good.</span>
        </div>
        <div className="key-box" aria-label="Your private key">{keys.secretKey}</div>
        <div className="row">
          <a
            className="btn btn-primary"
            href={href}
            download={`nporkerd-key-${keys.username}.txt`}
            onClick={() => setSaved(true)}
          >
            ⬇ Download key file
          </a>
          <button
            type="button"
            className="btn"
            onClick={() => {
              navigator.clipboard.writeText(keys.secretKey).then(
                () => { setCopied(true); setSaved(true); },
                () => setError("Clipboard is blocked — select the key and copy it manually."),
              );
            }}
          >
            {copied ? "✓ Copied" : "Copy key"}
          </button>
        </div>
        <div className="faint">
          Fingerprint <span className="fingerprint">{keys.fingerprint}</span> — you'll see it again when you log in.
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          <span>I saved my key somewhere safe. I understand it can't be recovered.</span>
        </label>
        {error === undefined ? null : <div className="error-text" role="alert">{error}</div>}
        <button type="button" className="btn btn-primary btn-lg btn-block" disabled={!acknowledged || busy} onClick={() => void finish()}>
          {busy ? "Signing in…" : saved ? "Continue to the lobby" : "Continue"}
        </button>
      </div>
    </div>
  );
}
