// Registration: pick a name → a keypair is generated locally → the private key
// is shown once (copy / download, mandatory acknowledgement) → automatic login.
// A step indicator (Name → Save your key → Play) and a NextStep banner say what
// to do at each point; the attention ring walks download → tick → continue.
import { FormEvent, useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { USERNAME_MAX, USERNAME_MIN, USERNAME_REGEX } from "../../convex/lib/constants";
import { buildKeyFile, generateKeyPair } from "../lib/keys";
import { errorCodeOf, errorCopyFor } from "../lib/errorCopy";
import { loginWithKeypair, useSession } from "../lib/auth";
import { Navigate } from "../lib/router";
import { NextStep } from "../components/Guide";
import { useT } from "../i18n/core";
import { authMessages } from "../i18n/auth";
import "../styles-entry.css";

type Keys = { username: string; publicKey: string; secretKey: string; fingerprint: string };

/** 1 Name → 2 Save your key → 3 Play; `current` is 1-based. */
export function SignupSteps({ current }: { current: 1 | 2 | 3 }) {
  const t = useT(authMessages);
  const labels = [t("step1"), t("step2"), t("step3")];
  return (
    <ol className="signup-steps" aria-label={t("stepsLabel")}>
      {labels.map((label, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "current" : "todo";
        return (
          <li key={label} className={`signup-step ${state}`} aria-current={state === "current" ? "step" : undefined}>
            <span className="signup-num" aria-hidden="true">{state === "done" ? "✓" : n}</span>
            <span className="signup-label">{label}</span>
            {state === "done" ? <span className="entry-sr"> ({t("stepDone")})</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function RegisterPage({ navigate, afterAuth }: { navigate: Navigate; afterAuth: string }) {
  const t = useT(authMessages);
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
  // the message was written in the old language: drop it on a switch
  useEffect(() => setError(undefined), [t.lang]);
  const [busy, setBusy] = useState(false);

  const lengthOk = username.length >= USERNAME_MIN && username.length <= USERNAME_MAX;
  const charsOk = username !== "" && /^[A-Za-z0-9_]*$/.test(username);
  const nameProblem = username === "" ? undefined
    : !lengthOk ? t("nameProblemLength", { min: USERNAME_MIN, max: USERNAME_MAX })
    : !USERNAME_REGEX.test(username) ? t("nameProblemChars") : undefined;

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault();
    const name = username.trim();
    if (name === "" || nameProblem !== undefined || busy) {
      setError(nameProblem === undefined ? t("pickNameFirst") : t("usernameProblem", { problem: nameProblem }));
      return;
    }
    setError(undefined);
    setBusy(true);
    const pair = generateKeyPair();
    try {
      await register({ username: name, publicKey: pair.publicKey });
      setKeys({ username: name, ...pair });
    } catch (err) {
      setError(errorCodeOf(err) === "USERNAME_TAKEN" ? t("nameTaken") : errorCopyFor(err));
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
    const ruleClass = (ok: boolean) => `rule${username === "" ? "" : ok ? " ok" : " bad"}`;
    const ruleMark = (ok: boolean) => (username === "" ? "•" : ok ? "✓" : "✗");
    return (
      <div className="auth-wrap">
        <SignupSteps current={1} />
        <form className="panel panel-pad stack" onSubmit={(e) => void create(e)}>
          <h1 className="panel-title">{t("registerTitle")}</h1>
          <NextStep icon="✍️" title={t("nameNextTitle")} detail={t("nameNextDetail")} />
          <label className="field">
            <span>{t("usernameLabel")}</span>
            <input
              className={`input${nameProblem !== undefined ? " invalid" : ""}`}
              autoFocus
              autoComplete="username"
              value={username}
              maxLength={USERNAME_MAX}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("usernamePlaceholder")}
              aria-describedby="username-rules"
            />
          </label>
          <ul className="rules" id="username-rules">
            <li className={ruleClass(lengthOk)}><span aria-hidden="true">{ruleMark(lengthOk)}</span>{t("ruleLength", { min: USERNAME_MIN, max: USERNAME_MAX })}</li>
            <li className={ruleClass(charsOk)}><span aria-hidden="true">{ruleMark(charsOk)}</span>{t("ruleChars")}</li>
            <li className="rule"><span aria-hidden="true">•</span>{t("ruleUnique")}</li>
          </ul>
          <p className="faint" style={{ margin: 0 }}>🔑 {t("keyIntro")}</p>
          {error === undefined ? null : <div className="error-text" role="alert">{error}</div>}
          <button
            type="submit"
            className={`btn btn-primary btn-lg btn-block${USERNAME_REGEX.test(username) && !busy ? " attn" : ""}`}
            disabled={busy}
          >
            {busy ? t("creating") : t("createAccount")}
          </button>
          <div className="auth-switch">
            {t("haveKey")} <button type="button" className="link-btn" onClick={() => navigate("/login")}>{t("logInLink")}</button>
          </div>
        </form>
      </div>
    );
  }

  const file = buildKeyFile(keys.username, keys.secretKey, keys.fingerprint);
  const href = `data:text/plain;charset=utf-8,${encodeURIComponent(file)}`;
  const phase = !saved ? "download" : !acknowledged ? "confirm" : "continue";
  const next = phase === "download"
    ? { icon: "⬇", title: t("saveNextDownload"), detail: t("saveNextDownloadDetail") }
    : phase === "confirm"
      ? { icon: "☑", title: t("saveNextConfirm"), detail: t("saveNextConfirmDetail") }
      : { icon: "🎉", title: t("saveNextContinue"), detail: t("saveNextContinueDetail") };

  return (
    <div className="auth-wrap">
      <SignupSteps current={acknowledged ? 3 : 2} />
      <div className="panel panel-pad stack">
        <h1 className="panel-title">{t("saveTitle", { name: keys.username })}</h1>
        <NextStep icon={next.icon} title={next.title} detail={next.detail} />
        <div className="warning">
          <span aria-hidden="true">⚠️</span>
          <span>{t.rich("warning", { once: <b>{t("warningOnce")}</b> })}</span>
        </div>
        <div className="key-box" aria-label={t("keyBoxLabel")}>{keys.secretKey}</div>
        <div className="row">
          <a
            className={`btn btn-primary${phase === "download" ? " attn" : ""}`}
            href={href}
            download={`nporkerd-key-${keys.username}.txt`}
            onClick={() => setSaved(true)}
          >
            {t("download")}
          </a>
          <button
            type="button"
            className="btn"
            onClick={() => {
              navigator.clipboard.writeText(keys.secretKey).then(
                () => { setCopied(true); setSaved(true); },
                () => setError(t("clipboardBlocked")),
              );
            }}
          >
            {copied ? t("copied") : t("copy")}
          </button>
        </div>
        <div className="faint">
          {t.rich("fingerprintLine", { fp: <span className="fingerprint">{keys.fingerprint}</span> })}
        </div>
        <label className={`checkbox ack-box${phase === "confirm" ? " attn" : ""}`}>
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          <span>{t("acknowledge")}</span>
        </label>
        {error === undefined ? null : <div className="error-text" role="alert">{error}</div>}
        <button
          type="button"
          className={`btn btn-primary btn-lg btn-block${phase === "continue" && !busy ? " attn" : ""}`}
          disabled={!acknowledged || busy}
          onClick={() => void finish()}
        >
          {busy ? t("signingIn") : saved ? t("continueLobby") : t("continue")}
        </button>
        <details className="why-key">
          <summary>{t("whyKeyTitle")}</summary>
          <p>{t("whyKey")}</p>
        </details>
      </div>
    </div>
  );
}
