// /help — how to play, with real screenshots. Opened in a new tab from the top
// bar (and from <Tip> links, with #section anchors). Public: no session needed.
// Text comes from src/i18n/help.ts; screenshots live in public/help-img/<lang>/.
import { useEffect } from "react";
import { useLang } from "../i18n/core";
import { HELP, HelpBlock, HelpSection } from "../i18n/help";
import "../styles-help.css";

function Block({ block }: { block: HelpBlock }) {
  switch (block.kind) {
    case "p":
      return <p>{block.text}</p>;
    case "steps":
      return <ol className="help-steps">{block.items.map((item, i) => <li key={i}>{item}</li>)}</ol>;
    case "list":
      return <ul className="help-list">{block.items.map((item, i) => <li key={i}>{item}</li>)}</ul>;
    case "terms":
      return (
        <dl className="help-terms">
          {block.items.map(([term, def], i) => (
            <div key={i}><dt>{term}</dt><dd>{def}</dd></div>
          ))}
        </dl>
      );
    case "note":
      return <div className="help-note">💡 {block.text}</div>;
    case "shot":
      return <Shot file={block.file} caption={block.caption} />;
    case "shots":
      return (
        <div className="help-shots">
          {block.items.map((s) => <Shot key={s.file} file={s.file} caption={s.caption} />)}
        </div>
      );
  }
}

function Shot({ file, caption }: { file: string; caption: string }) {
  const { lang } = useLang();
  const src = `/help-img/${lang}/${file}`;
  return (
    <figure className="help-shot">
      <a href={src} target="_blank" rel="noopener noreferrer" title={caption}>
        <img src={src} alt={caption} loading="lazy" />
      </a>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function Section({ section }: { section: HelpSection }) {
  return (
    <section id={section.id} className="help-section panel panel-pad">
      <h2><span aria-hidden="true">{section.icon}</span> {section.title}</h2>
      {section.blocks.map((b, i) => <Block key={i} block={b} />)}
    </section>
  );
}

export function HelpPage() {
  const { lang } = useLang();
  const content = HELP[lang];

  // Honour #anchor once the sections exist (the page renders client-side).
  // Screenshots above the target load later and push it down, so keep it in
  // place while the layout settles — until the reader scrolls or 4 s pass.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const target = id === "" ? null : document.getElementById(id);
    if (target === null) return;
    target.scrollIntoView();
    const body = target.parentElement;
    let done = false;
    const stop = () => {
      done = true;
      observer?.disconnect();
    };
    const observer = typeof ResizeObserver === "undefined" || body === null
      ? undefined
      : new ResizeObserver(() => {
          if (!done) target.scrollIntoView();
        });
    if (body !== null) observer?.observe(body);
    const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    events.forEach((e) => window.addEventListener(e, stop, { once: true, passive: true }));
    const timer = window.setTimeout(stop, 4000);
    return () => {
      stop();
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, stop));
    };
  }, []);

  return (
    <div className="help-page">
      <header className="help-hero">
        <h1>{content.title}</h1>
        <p className="muted">{content.intro}</p>
      </header>
      <div className="help-layout">
        <nav className="help-toc panel" aria-label={content.tocLabel}>
          <strong>{content.tocLabel}</strong>
          <ol>
            {content.sections.map((s) => (
              <li key={s.id}><a href={`#${s.id}`}>{s.icon} {s.title}</a></li>
            ))}
          </ol>
        </nav>
        <div className="help-body">
          {content.sections.map((s) => <Section key={s.id} section={s} />)}
        </div>
      </div>
    </div>
  );
}
