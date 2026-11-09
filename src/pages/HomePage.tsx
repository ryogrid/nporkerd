// Landing screen for visitors without a session: the pitch, one obvious call
// to action, a three-step "how it works", and a NextStep when the visitor came
// from an invite link or their session expired.
import { Card } from "../components/Card";
import { Chip } from "../components/Chips";
import { NextStep } from "../components/Guide";
import { useT } from "../i18n/core";
import { homeMessages } from "../i18n/home";
import { formatChips } from "../lib/format";
import { Navigate } from "../lib/router";
import { STARTING_BALANCE } from "../../convex/lib/constants";
import "../styles-entry.css";

export function HomePage({ navigate, expired, invited }: { navigate: Navigate; expired: boolean; invited: boolean }) {
  const t = useT(homeMessages);
  // one pulsing control: "log in" after an expired session, else "create account"
  const attnLogin = expired && !invited;
  const steps = [
    { n: 1, title: t("how1Title"), text: t("how1Text") },
    { n: 2, title: t("how2Title"), text: t("how2Text") },
    { n: 3, title: t("how3Title"), text: t("how3Text") },
  ];
  return (
    <div className="landing-page">
      <div className="landing landing-entry">
        <div className="landing-copy">
          <h1>
            {t("heroLine1")}<br /><em>{t("heroEm")}</em>{t("heroLine2")}
          </h1>
          <p>{t("lead")}</p>
          {invited ? (
            <div className="landing-next">
              <NextStep icon="♠" title={t("invitedTitle")} detail={t("invitedDetail")} />
            </div>
          ) : expired ? (
            <div className="landing-next">
              <NextStep icon="⏳" title={t("expiredTitle")} detail={t("expiredDetail")} />
            </div>
          ) : null}
          <div className="row">
            <button
              type="button"
              className={`btn btn-primary btn-lg${attnLogin ? "" : " attn"}`}
              onClick={() => navigate("/register")}
            >
              {t("ctaCreate")}
            </button>
            <button
              type="button"
              className={`btn btn-lg${attnLogin ? " attn" : ""}`}
              onClick={() => navigate("/login")}
            >
              {t("ctaLogin")}
            </button>
          </div>
          <p className="faint landing-note">{t("startingChips", { chips: formatChips(STARTING_BALANCE) })}</p>
        </div>
        <div className="landing-cards" aria-hidden="true">
          <Card card={12} anim="deal" />
          <Card card={13 + 12} anim="deal" delayMs={120} />
          <Card card={26 + 11} anim="deal" delayMs={240} />
          <div className="landing-chips">
            <Chip color="c-red" large /><Chip color="c-black" large /><Chip color="c-gold" large /><Chip color="c-blue" large />
          </div>
        </div>
      </div>

      <section className="how-it-works" aria-labelledby="how-title">
        <h2 id="how-title" className="section-title">{t("howTitle")}</h2>
        <ol className="how-steps">
          {steps.map((s) => (
            <li key={s.n} className="how-step">
              <span className="how-num" aria-hidden="true">{s.n}</span>
              <div>
                <strong>{s.title}</strong>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <a className="how-help" href="/help#hand" target="_blank" rel="noopener noreferrer">{t("howHelp")} ↗</a>
      </section>
    </div>
  );
}
