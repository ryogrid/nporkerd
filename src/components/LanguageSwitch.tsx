// Always-visible EN / 日本語 switch in the top bar. Both options are shown so
// it is obvious the site can be switched (and to what).
import { commonMessages } from "../i18n/common";
import { Lang, useLang, useT } from "../i18n/core";

const OPTIONS: { lang: Lang; label: string; long: string }[] = [
  { lang: "en", label: "EN", long: "English" },
  { lang: "ja", label: "日本語", long: "日本語" },
];

export function LanguageSwitch() {
  const { lang, setLang } = useLang();
  const t = useT(commonMessages);
  return (
    <div className="lang-switch" role="group" aria-label={t("languageLabel")} title={t("languageTitle")}>
      <span className="lang-globe" aria-hidden="true">🌐</span>
      {OPTIONS.map((o) => (
        <button
          key={o.lang}
          type="button"
          lang={o.lang}
          className={lang === o.lang ? "on" : undefined}
          aria-pressed={lang === o.lang}
          aria-label={o.long}
          onClick={() => setLang(o.lang)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
