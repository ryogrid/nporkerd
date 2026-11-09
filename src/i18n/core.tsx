// Minimal i18n: English (default) and Japanese.
//
// Messages live next to the area that uses them (`src/i18n/<area>.ts`), each
// built with `defineMessages(en, ja)`: the Japanese table must have exactly the
// English keys, so a missing translation is a compile error.
//
// Components read them with `const t = useT(areaMessages)`; `t("key", {n: 3})`
// fills `{n}` placeholders, `t.rich("key", {name: <b>x</b>})` does the same
// with React nodes. Non-React code (error copy, toasts built outside render)
// uses `tr(areaMessages, "key")`, which reads the current language directly.
//
// The choice is stored in localStorage and synced across tabs (the Help page
// opens in a new tab). `?lang=ja` / `?lang=en` in the URL overrides it once.
import { createContext, Fragment, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "en" | "ja";
export const LANGS: readonly Lang[] = ["en", "ja"];
const STORAGE_KEY = "nporkerd.lang";

export type Vars = Record<string, string | number>;
export type Messages<K extends string> = { en: Record<K, string>; ja: Record<K, string> };

export function defineMessages<const E extends Record<string, string>>(
  en: E,
  ja: { [K in keyof E]: string },
): Messages<keyof E & string> {
  return { en, ja } as Messages<keyof E & string>;
}

function isLang(value: unknown): value is Lang {
  return value === "en" || value === "ja";
}

function initialLang(): Lang {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("lang");
    if (isLang(fromUrl)) {
      localStorage.setItem(STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // storage blocked: fall through to the default
  }
  return "en";
}

let current: Lang = initialLang();

/** The language in effect right now (for non-React callers). */
export function getLang(): Lang {
  return current;
}

export function fill(template: string, vars?: Vars): string {
  if (vars === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** Translate outside React (reads the current language). */
export function tr<K extends string>(messages: Messages<K>, key: K, vars?: Vars): string {
  return fill(messages[current][key], vars);
}

function richFill(template: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = template.split(/(\{\w+\})/g);
  return parts.map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    if (m !== null && m[1] in vars) return <Fragment key={i}>{vars[m[1]]}</Fragment>;
    return part === "" ? null : <Fragment key={i}>{part}</Fragment>;
  });
}

type LangApi = { lang: Lang; setLang: (lang: Lang) => void };
const LangContext = createContext<LangApi>({ lang: "en", setLang: () => undefined });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(current);

  const setLang = useCallback((next: Lang) => {
    current = next;
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  // another tab (e.g. Help) switched language
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && isLang(e.newValue)) {
        current = e.newValue;
        setLangState(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangApi {
  return useContext(LangContext);
}

export type T<K extends string> = ((key: K, vars?: Vars) => string) & {
  rich: (key: K, vars: Record<string, ReactNode>) => ReactNode;
  lang: Lang;
};

/** Translator for one message area, re-rendering on language change. */
export function useT<K extends string>(messages: Messages<K>): T<K> {
  const { lang } = useLang();
  return useMemo(() => {
    const table = messages[lang];
    const t = ((key: K, vars?: Vars) => fill(table[key], vars)) as T<K>;
    t.rich = (key, vars) => richFill(table[key], vars);
    t.lang = lang;
    return t;
  }, [messages, lang]);
}
