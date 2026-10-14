import { TEL_MAX_DIGITS, getSetting, isValidSelfId, readSelcall, writeSelcall, type SelcallData } from "@ce42/core";
import { useState } from "react";
import { useI18n } from "../i18n";
import type { Edit } from "../state";
import { HelpTip } from "./HelpTip";
import { SettingsGroups } from "./SettingsPanel";

function DigitInput({ id, value, length, onCommit, invalid }: {
  id: string; value: string; length: number; onCommit: (v: string) => void; invalid?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input id={id} className={`digits${invalid ? " invalid" : ""}`} inputMode="numeric" maxLength={length} spellCheck={false}
      value={draft ?? value.trimEnd()}
      onFocus={() => setDraft(value.trimEnd())}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      onBlur={() => { if (draft !== null && draft !== value.trimEnd()) onCommit(draft); setDraft(null); }} />
  );
}

export function SelcallPanel({ bytes, edit }: { bytes: Uint8Array; edit: Edit }) {
  const { t } = useI18n();
  const data = readSelcall(bytes);
  const update = (fn: (d: SelcallData) => void) => edit((b) => { const d = readSelcall(b); fn(d); writeSelcall(b, d); });
  const telMax = TEL_MAX_DIGITS[getSetting(bytes, "telCallType")] ?? 16;
  return (
    <section className="panel scroll">
      <div className="groups">
        <fieldset className="group">
          <legend>IDs</legend>
          <div className="field">
            <div className="field-label"><label htmlFor="selfId">{t("selfId")} <small className="muted">({t("selfIdHint")})</small></label><HelpTip id="selfId" /></div>
            <DigitInput id="selfId" value={data.selfId} length={4} invalid={!isValidSelfId(data.selfId)} onCommit={(v) => update((d) => (d.selfId = v))} />
          </div>
          <div className="field">
            <div className="field-label"><label htmlFor="killId">{t("killId")}</label><HelpTip id="killId" /></div>
            <DigitInput id="killId" value={data.killId} length={8} onCommit={(v) => update((d) => (d.killId = v))} />
          </div>
          {data.txIds.map((v, i) => (
            <div className="field" key={i}>
              <div className="field-label"><label htmlFor={`txid${i}`}>{t("txId", { n: (i + 1) % 10 })}</label><HelpTip id="txId" /></div>
              <DigitInput id={`txid${i}`} value={v} length={4} onCommit={(x) => update((d) => (d.txIds[i] = x))} />
            </div>
          ))}
        </fieldset>
        <fieldset className="group">
          <legend>{t("group_telephone")}</legend>
          {data.telephones.map((v, i) => (
            <div className="field" key={i}>
              <div className="field-label"><label htmlFor={`tel${i}`}>{t("telNumber", { n: i + 1 })}</label><HelpTip id="telNumber" /></div>
              <DigitInput id={`tel${i}`} value={v} length={telMax} onCommit={(x) => update((d) => (d.telephones[i] = x))} />
            </div>
          ))}
        </fieldset>
      </div>
      <SettingsGroups groups={["selcall", "telephone"]} bytes={bytes} edit={edit} />
    </section>
  );
}
