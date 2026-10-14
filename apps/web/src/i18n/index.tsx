import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { desktop } from "../desktop";
import { LANGUAGES, STRINGS, isLang, type Lang, type StringKey } from "./strings";

type T = (key: StringKey, vars?: Record<string, string | number>) => string;

const Ctx = createContext<{ lang: Lang; locale: string; setLang: (l: Lang) => void; t: T } | null>(null);
const STORAGE_KEY = "ce42.lang";

/** Last language used, or the system language: preselected on the start-up screen. */
export function preferredLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  const sys = navigator.language.toLowerCase().slice(0, 2);
  return isLang(sys) ? sys : "en";
}

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => initial ?? preferredLang());
  useEffect(() => {
    const locale = LANGUAGES.find((l) => l.code === lang)?.locale ?? "en";
    document.documentElement.lang = locale;
    void desktop?.setLanguage?.(lang);
  }, [lang]);
  const value = useMemo(() => {
    const t: T = (key, vars) => {
      let s: string = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
      return s;
    };
    const setLang = (l: Lang) => {
      setLangState(l);
      try {
        localStorage.setItem(STORAGE_KEY, l);
      } catch {
        /* ignore */
      }
    };
    return { lang, locale: LANGUAGES.find((l) => l.code === lang)?.locale ?? "en", setLang, t };
  }, [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside provider");
  return v;
}
