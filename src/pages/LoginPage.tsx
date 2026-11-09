// Login: username + the private key (pasted, or the key file dropped/picked).
// Every failure shows the same sentence (no username oracle, design/03 §4.3).
import { DragEvent, FormEvent, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { USERNAME_REGEX } from "../../convex/lib/constants";
import { describeSecretKey, parseKeyFile } from "../lib/keys";
import { loginWithKeypair, useSession } from "../lib/auth";
import { Navigate } from "../lib/router";

const GENERIC_FAILURE = "Login failed: unknown username or wrong key.";

/** The key file starts with a line naming the account; pick it up if present. */
function usernameFromFile(text: string): string | undefined {
  const m = /username\s*[:=]\s*([A-Za-z0-9_]{3,20})/i.exec(text);
  return m === null ? undefined : m[1];
}

export function LoginPage({ navigate, afterAuth }: { navigate: Navigate; afterAuth: string }) {
  const requestChallenge = useMutation(api.auth.requestLoginChallenge);
  const login = useMutation(api.auth.login);
  const session = useSession();
  const [username, setUsername] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const parsed = parseKeyFile(key);
  let fingerprint: string | undefined = undefined;
  if (parsed !== undefined) {
    try {
      fingerprint = describeSecretKey(parsed).fingerprint;
    } catch {
      fingerprint = undefined;
    }
  }

  async function loadFile(file: File): Promise<void> {
    const text = await file.text();
    if (parseKeyFile(text) === undefined) {
      setError("That file doesn't contain a nporkerd key.");
      return;
    }
    setError(undefined);
    setKey(text);
    const name = usernameFromFile(text);
    if (name !== undefined && username === "") setUsername(name);
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    const name = username.trim();
    if (!USERNAME_REGEX.test(name)) {
      setError("Enter your username (3–20 letters, digits or underscores).");
      return;
    }
    if (parsed === undefined || fingerprint === undefined) {
      setError("Paste your npk_… key or drop the key file you downloaded.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const { token } = await loginWithKeypair(name, parsed, requestChallenge, login);
      session.signIn(token);
      navigate(afterAuth, { replace: true });
    } catch {
      setError(GENERIC_FAILURE);
      setBusy(false);
    }
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file !== undefined) void loadFile(file);
  }

  return (
    <div className="auth-wrap">
      <form className="panel panel-pad stack" onSubmit={(e) => void submit(e)}>
        <h1 className="panel-title">Welcome back</h1>
        <label className="field">
          <span>Username</span>
          <input className="input" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="field">
          <span>Private key</span>
          <textarea
            className="textarea"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="npk_…"
            spellCheck={false}
            autoComplete="off"
          />
          {fingerprint !== undefined ? (
            <small>Key fingerprint <span className="fingerprint">{fingerprint}</span></small>
          ) : key.trim() !== "" ? <small className="error-text">This doesn't look like a nporkerd key yet.</small> : null}
        </label>
        <div
          className={`dropzone${over ? " over" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInput.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <span>📄 Drop your key file here, or click to choose it</span>
          <span className="faint">nporkerd-key-&lt;name&gt;.txt</span>
          <input
            ref={fileInput}
            type="file"
            accept=".txt,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f !== undefined) void loadFile(f);
              e.target.value = "";
            }}
          />
        </div>
        {error === undefined ? null : <div className="error-text" role="alert">{error}</div>}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? "Verifying…" : "Log in"}
        </button>
        <div className="auth-switch">
          New here? <button type="button" className="link-btn" onClick={() => navigate("/register")}>Create an account</button>
        </div>
      </form>
    </div>
  );
}
