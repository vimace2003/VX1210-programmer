import { MODEL_ID, decodeSerial } from "@ce42/core";
import logoUrl from "../assets/logo.png";
import { byline } from "../buildInfo";
import { useI18n } from "../i18n";
import type { DocState } from "../state";

export function InfoPanel({ doc }: { doc: DocState }) {
  const { t, locale } = useI18n();
  return (
    <section className="panel scroll">
      <header className="info-title">
        <img src={logoUrl} alt="" width={72} height={72} />
        <div>
          <h2>CE42 Next</h2>
          <p className="byline">{byline(locale)}</p>
        </div>
      </header>
      <dl className="info">
        <dt>{t("model")}</dt><dd>VX-1210 <span className="muted mono">({MODEL_ID})</span></dd>
        <dt>{t("firmware")}</dt><dd className="mono">{doc.radio?.info.firmware ?? "—"}</dd>
        <dt>{t("serial")}</dt><dd className="mono">{decodeSerial(doc.bytes)}</dd>
        <dt>{t("lastRead")}</dt><dd>{doc.radio ? doc.radio.at.toLocaleString(locale) : t("never")}</dd>
      </dl>
      <p className="note">{t("infoText")}</p>
    </section>
  );
}
