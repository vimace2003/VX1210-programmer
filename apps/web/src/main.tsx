import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LanguageGate } from "./components/LanguageGate";
import { I18nProvider } from "./i18n";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <LanguageGate>
      <App />
    </LanguageGate>
  </I18nProvider>,
);
