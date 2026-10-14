import { KEY_FUNCTIONS, SETTINGS, getSetting, setSetting, type Setting, type SettingGroup } from "@ce42/core";
import { useState } from "react";
import { useI18n } from "../i18n";
import { isHelpKey } from "../i18n/help";
import type { StringKey } from "../i18n/strings";
import { HelpTip } from "./HelpTip";
import type { Edit } from "../state";

export function SettingField({ s, bytes, edit }: { s: Setting; bytes: Uint8Array; edit: Edit }) {
  const { t } = useI18n();
  const value = getSetting(bytes, s.id);
  const id = `set-${s.id}`;
  const disabled = s.factoryLocked === true;
  const [draft, setDraft] = useState<string | null>(null);
  let control;
  if (s.kind === "enum") {
    control = (
      <select id={id} value={value} disabled={disabled} onChange={(e) => edit((d) => setSetting(d, s.id, Number(e.target.value)))}>
        {s.options.map((o, i) => <option key={i} value={i}>{o}</option>)}
        {value >= s.options.length && <option value={value}>? ({value})</option>}
      </select>
    );
  } else if (s.kind === "key") {
    control = (
      <select id={id} value={value} onChange={(e) => edit((d) => setSetting(d, s.id, Number(e.target.value)))}>
        {KEY_FUNCTIONS.map((k) => <option key={k.code} value={k.code}>{k.name}</option>)}
      </select>
    );
  } else {
    const shown = String(value * s.scale);
    control = (
      <span className="with-unit">
        <input id={id} inputMode="numeric" value={draft ?? shown}
          onFocus={() => setDraft(shown)} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={() => {
            const v = Math.round(Number(draft) / s.scale);
            if (Number.isFinite(v)) edit((d) => setSetting(d, s.id, Math.min(s.max, Math.max(s.min, v))));
            setDraft(null);
          }} />
        <span className="unit">{s.unit}</span>
      </span>
    );
  }
  return (
    <div className="field">
      <div className="field-label">
        <label htmlFor={id}>{t(`s_${s.id}` as StringKey)}</label>
        {disabled && <span className="lock" title={t("factoryLocked")} aria-label={t("factoryLocked")}>🔒</span>}
        {isHelpKey(s.id) && <HelpTip id={s.id} />}
      </div>
      {control}
    </div>
  );
}

export function SettingsGroups({ groups, bytes, edit }: { groups: SettingGroup[]; bytes: Uint8Array; edit: Edit }) {
  const { t } = useI18n();
  return (
    <div className="groups">
      {groups.map((g) => (
        <fieldset key={g} className="group">
          <legend>{t(`group_${g}` as StringKey)}</legend>
          {SETTINGS.filter((s) => s.group === g).map((s) => <SettingField key={s.id} s={s} bytes={bytes} edit={edit} />)}
        </fieldset>
      ))}
    </div>
  );
}

export function SettingsPanel({ bytes, edit }: { bytes: Uint8Array; edit: Edit }) {
  return (
    <section className="panel scroll">
      <SettingsGroups groups={["option", "system", "cw", "misc", "powerSave", "keys", "hardware"]} bytes={bytes} edit={edit} />
    </section>
  );
}
