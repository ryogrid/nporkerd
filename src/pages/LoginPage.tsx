// Login: username + the private key (pasted, or the key file dropped/picked).
// Every failure shows the same sentence (no username oracle, design/03 §4.3).
// A NextStep banner and the attention ring walk key → username → Log in, and a
// "Lost your key?" note says the only way forward is a new account.
import { DragEvent, FormEvent, useRef, useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { STARTING_BALANCE, USERNAME_MAX, USERNAME_MIN, USERNAME_REGEX } from "../../convex/lib/constants";
import { describeSecretKey, parseKeyFile } from "../lib/keys";
import { loginWithKeypair, useSession } from "../lib/auth";
import { formatChips } from "../lib/format";
import { Navigate } from "../lib/router";
import { NextStep } from "../components/Guide";
import { useT } from "../i18n/core";
import { authMessages } from "../i18n/auth";
import "../styles-entry.css";

/** The key file starts with a line naming the account; pick it up if present. */
function usernameFromFile(text: string): string | undefined {
  const m = /username\s*[:=]\s*([A-Za-z0-9_]{3,20})/i.exec(text);
  return m === null ? undefined : m[1];
}

export function LoginPage({ navigate, afterAuth }: { navigate: Navigate; afterAuth: string }) {
  const t = useT(authMessages);
  const requestChallenge = useMutation(api.auth.requestLoginChallenge);
  const login = useMutation(api.auth.login);
  const session = useSession();
  const [username, setUsername] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  // the message was written in the old language: drop it on a switch
  useEffect(() => setError(undefined), [t.lang]);
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
      setError(t("fileNotKey"));
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
      setError(t("enterUsername", { min: USERNAME_MIN, max: USERNAME_MAX }));
      return;
    }
    if (parsed === undefined || fingerprint === undefined) {
      setError(t("needKey"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const { token } = await loginWithKeypair(name, parsed, requestChallenge, login);
      session.signIn(token);
      navigate(afterAuth, { replace: true });
    } catch {
      setError(t("genericFailure"));
      setBusy(false);
    }
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file !== undefined) void loadFile(file);
  }

  const haveKey = fingerprint !== undefined;
  const haveName = USERNAME_REGEX.test(username.trim());
  const phase = !haveKey ? "key" : !haveName ? "name" : "go";
  const next = phase === "key"
    ? { icon: "🔑", title: t("loginNextKey"), detail: t("loginNextKeyDetail") }
    : phase === "name"
      ? { icon: "✍️", title: t("loginNextName"), detail: t("loginNextNameDetail") }
      : { icon: "✅", title: t("loginNextGo"), detail: t("loginNextGoDetail") };

  return (
    <div className="auth-wrap">
      <form className="panel panel-pad stack" onSubmit={(e) => void submit(e)}>
        <h1 className="panel-title">{t("loginTitle")}</h1>
        <NextStep icon={next.icon} title={next.title} detail={next.detail} />
        <div className="login-ways">
          <span>{t("waysTitle")}</span>
          <ul>
            <li>📄 {t("wayFile")}</li>
            <li>📋 {t("wayPaste")}</li>
          </ul>
        </div>
        <div
          className={`dropzone${over ? " over" : ""}${phase === "key" ? " attn" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInput.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <span>{t("dropzone")}</span>
          <span className="faint">{t("dropzoneHint")}</span>
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
        <label className="field">
          <span>{t("privateKeyLabel")}</span>
          <textarea
            className="textarea"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("keyPlaceholder")}
            spellCheck={false}
            autoComplete="off"
          />
          {fingerprint !== undefined ? (
            <small>{t.rich("keyFingerprint", { fp: <span className="fingerprint">{fingerprint}</span> })}</small>
          ) : key.trim() !== "" ? <small className="error-text">{t("notAKeyYet")}</small> : null}
        </label>
        <label className="field">
          <span>{t("usernameLabel")}</span>
          <input
            className={`input${phase === "name" ? " attn" : ""}`}
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        {error === undefined ? null : <div className="error-text" role="alert">{error}</div>}
        <button type="submit" className={`btn btn-primary btn-lg btn-block${phase === "go" && !busy ? " attn" : ""}`} disabled={busy}>
          {busy ? t("verifying") : t("logIn")}
        </button>
        <div className="lost-key">
          <strong>{t("lostTitle")}</strong>{" "}
          <span>{t("lostText", { chips: formatChips(STARTING_BALANCE) })}</span>
        </div>
        <div className="auth-switch">
          {t("newHere")} <button type="button" className="link-btn" onClick={() => navigate("/register")}>{t("createLink")}</button>
        </div>
      </form>
    </div>
  );
}
