// Guidance chrome shared by every screen so a first-time player always sees
// what to do next and where to click:
//  - <NextStep>: the "what to do now" banner (one per screen state).
//  - <Tip>: a dismissible first-visit explainer (remembered per browser).
//  - className "attn" (styles.css): a pulsing gold ring on the control the
//    NextStep is talking about. Put it on at most one element at a time.
import { ReactNode, useState } from "react";
import { commonMessages } from "../i18n/common";
import { useT } from "../i18n/core";

export type NextStepTone = "do" | "wait" | "turn";

export function NextStep({ icon, title, detail, action, tone = "do", label }: {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  /** Optional button(s) rendered at the right edge. */
  action?: ReactNode;
  /** "do" = the user should act; "turn" = their poker turn; "wait" = nothing to do yet. */
  tone?: NextStepTone;
  /** Override the small caption; null hides it. Defaults to "What to do now" for do/turn. */
  label?: ReactNode | null;
}) {
  const t = useT(commonMessages);
  const caption = label === undefined ? (tone === "wait" ? null : t("nextStep")) : label;
  return (
    <div className={`next-step tone-${tone}`} role="status" aria-live="polite">
      {icon === undefined ? null : <span className="next-step-icon" aria-hidden="true">{icon}</span>}
      <div className="next-step-body">
        {caption === null ? null : <span className="next-step-label">{caption}</span>}
        <strong className="next-step-title">{title}</strong>
        {detail === undefined || detail === "" ? null : <span className="next-step-detail">{detail}</span>}
      </div>
      {action === undefined ? null : <div className="next-step-action">{action}</div>}
    </div>
  );
}

function tipKey(id: string): string {
  return `nporkerd.tip.${id}`;
}

function tipDismissed(id: string): boolean {
  try {
    return localStorage.getItem(tipKey(id)) === "1";
  } catch {
    return false;
  }
}

/** First-visit explainer; "Got it" hides it for good in this browser. */
export function Tip({ id, icon = "💡", title, children, helpAnchor }: {
  id: string;
  icon?: ReactNode;
  title: ReactNode;
  children: ReactNode;
  /** Section id on the Help page to link to (opens in a new tab). */
  helpAnchor?: string;
}) {
  const t = useT(commonMessages);
  const [hidden, setHidden] = useState(() => tipDismissed(id));
  if (hidden) return null;
  return (
    <aside className="tip" aria-label={typeof title === "string" ? title : undefined}>
      <span className="tip-icon" aria-hidden="true">{icon}</span>
      <div className="tip-body">
        <strong>{title}</strong>
        <div className="tip-text">{children}</div>
        <div className="tip-actions">
          {helpAnchor === undefined ? null : (
            <a className="tip-link" href={`/help#${helpAnchor}`} target="_blank" rel="noopener noreferrer">
              {t("learnMore")} ↗
            </a>
          )}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              try {
                localStorage.setItem(tipKey(id), "1");
              } catch {
                // ignore
              }
              setHidden(true);
            }}
          >
            {t("dismiss")}
          </button>
        </div>
      </div>
    </aside>
  );
}
