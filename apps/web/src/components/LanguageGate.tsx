import { useState, type ReactNode } from "react";
import { byline } from "../buildInfo";
import { useI18n } from "../i18n";
import { LANGUAGES } from "../i18n/strings";

import LOGO from "../assets/logo.png";

/** Asks for the interface language every time the program starts (last choice preselected). */
export function LanguageGate({ children }: { children: ReactNode }) {
  const { lang, locale, setLang, t } = useI18n();
  const [chosen, setChosen] = useState(false);
  if (chosen) return <>{children}</>;
  return (
    <div className="lang-screen">
      <div className="lang-card" role="dialog" aria-modal="true" aria-labelledby="lang-title">
        <img src={LOGO} alt="" width={128} height={128} />
        <h1 id="lang-title">CE42 Next</h1>
        <p className="byline">{byline(locale)}</p>
        <p className="lang-question">Escolha o idioma · Choose your language · Elija el idioma · Выберите язык</p>
        <div className="lang-options">
          {LANGUAGES.map((l) => (
            <button key={l.code} data-lang={l.code} lang={l.locale} autoFocus={l.code === lang}
              className={`lang-option${l.code === lang ? " last" : ""}`}
              onClick={() => { setLang(l.code); setChosen(true); }}>
              {l.name}
            </button>
          ))}
        </div>
        <p className="muted small">{t("languageHint")}</p>
      </div>
    </div>
  );
}
