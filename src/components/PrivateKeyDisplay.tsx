// The registration key-reveal screen (design/07 §2.1, 03 §3 step 5): the
// private key shown once in a read-only area, Copy + Download buttons, the
// fingerprint so the user can match it at login, the loss warning, and a
// mandatory acknowledgement that gates Continue. The key is component state
// only — the app never writes it to storage (03 §3, D-04).
import { useRef, useState } from "react";
import { buildKeyFile } from "../lib/keys";

/** The loss warning — verbatim in meaning (03 §3 / 07 §2.1). */
const LOSS_WARNING = "This key is your password. It is shown only now. If you lose it, this account can never be accessed again and nobody can restore it.";

const KEY_FILE_SUFFIX = ".txt";
const KEY_FILE_PREFIX = "nporkerd-key-";

export function PrivateKeyDisplay({ username, secretKey, fingerprint, acknowledged, onAcknowledge, onContinue }: {
  username: string;
  secretKey: string;
  fingerprint: string;
  /** Parent's acknowledgement state; Continue stays disabled until true. */
  acknowledged: boolean;
  /** Receives the checkbox's new value so the parent can store it. */
  onAcknowledge: (checked: boolean) => void;
  onContinue: () => void;
}) {
  const [copied, setCopied] = useState<string | undefined>(undefined);
  const ackRef = useRef<HTMLInputElement>(null);
  const file = buildKeyFile(username, secretKey, fingerprint);

  function copyKey(): void {
    void navigator.clipboard.writeText(secretKey).then(
      () => setCopied("Copied to your clipboard."),
      (e) => setCopied(`Clipboard blocked — select the key manually: ${String(e)}`),
    );
  }

  const downloadHref = `data:text/plain;charset=utf-8,${encodeURIComponent(file)}`;

  return (
    <div className="np-card">
      <h2 className="np-title">Your account key — shown once</h2>
      <div className="np-key-area" role="textbox" aria-readonly="true" aria-label="private key">
        {secretKey}
      </div>
      <button type="button" onClick={() => copyKey()}>Copy key</button>
      <a
        className="np-actions"
        download={`${KEY_FILE_PREFIX}${username}${KEY_FILE_SUFFIX}`}
        href={downloadHref}
      >
        Download key file
      </a>
      <div className="np-muted">
        Key file: {KEY_FILE_PREFIX}{username}{KEY_FILE_SUFFIX} · contains username, key, fingerprint, warning
      </div>
      <div className="np-field">
        <label>Key fingerprint (write this down or keep the file)</label>
        {fingerprint}
      </div>
      <div className="np-error">{LOSS_WARNING}</div>
      {copied === undefined ? null : <div className="np-muted">{copied}</div>}
      <div className="np-field">
        <label>
          I understand this key is shown only once and cannot be recovered if lost.
          <input ref={ackRef} type="checkbox" onChange={() => onAcknowledge(ackRef.current?.checked === true)} />
        </label>
      </div>
      {!acknowledged ? (
        <div className="np-chat-hint">Tick the box above to enable Continue.</div>
      ) : null}
      <button type="button" disabled={!acknowledged} onClick={() => onContinue()}>
        Continue
      </button>
    </div>
  );
}
