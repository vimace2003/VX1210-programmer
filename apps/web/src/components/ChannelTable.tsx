import {
  T, clampFrequency, decodeChannels, encodeChannel, formatMHz, frequencyLimits, getSetting, normaliseTag,
  type Channel, type FrequencyLimits,
} from "@ce42/core";
import { memo, useMemo, useState, type KeyboardEvent } from "react";
import { useI18n } from "../i18n";
import type { HelpKey } from "../i18n/help";
import type { StringKey } from "../i18n/strings";
import type { Edit } from "../state";
import { HelpTip } from "./HelpTip";

const COLUMNS: [StringKey, HelpKey][] = [
  ["colCh", "col_ch"], ["colEnabled", "col_enabled"], ["colTag", "col_tag"], ["colRx", "col_rx"], ["colTx", "col_tx"],
  ["colTxAllowed", "col_txAllowed"], ["colMode", "col_mode"], ["colPower", "col_power"], ["colSelcall", "col_selcall"],
  ["colEncryption", "col_encryption"], ["colTune", "col_tune"], ["colShift", "col_shift"],
];

interface Props {
  bytes: Uint8Array;
  rev: number;
  edit: Edit;
}

function commitOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") e.currentTarget.blur();
  if (e.key === "Escape") {
    e.currentTarget.dataset.revert = "1";
    e.currentTarget.blur();
  }
}

function TextCell({ value, onCommit, className, maxLength, ariaLabel }: {
  value: string; onCommit: (v: string) => void; className?: string; maxLength?: number; ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={className}
      aria-label={ariaLabel}
      value={draft ?? value}
      maxLength={maxLength}
      spellCheck={false}
      onFocus={() => setDraft(value)}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={commitOnEnter}
      onBlur={(e) => {
        const revert = e.currentTarget.dataset.revert === "1";
        delete e.currentTarget.dataset.revert;
        if (!revert && draft !== null && draft !== value) onCommit(draft);
        setDraft(null);
      }}
    />
  );
}

function parseMHz(s: string): number | null {
  const v = Number(s.trim().replace(",", "."));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 1e5) * 10 : null;
}

const Row = memo(function Row({ ch, limits, onChange, t }: {
  ch: Channel; limits: FrequencyLimits; onChange: (c: Channel) => void; t: ReturnType<typeof useI18n>["t"];
}) {
  const set = (patch: Partial<Channel>) => onChange({ ...ch, ...patch });
  const label = (k: string) => `${k} ${String(ch.number).padStart(3, "0")}`;
  return (
    <tr className={ch.enabled ? "on" : "off"}>
      <td className="num">{String(ch.number).padStart(3, "0")}</td>
      <td className="c">
        <input type="checkbox" aria-label={label(t("colEnabled"))} checked={ch.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
      </td>
      <td>
        <TextCell className="tag" ariaLabel={label(t("colTag"))} maxLength={8} value={ch.tag.trimEnd()}
          onCommit={(v) => set({ tag: normaliseTag(v) })} />
      </td>
      <td>
        <TextCell className="freq" ariaLabel={label(t("colRx"))} value={formatMHz(ch.rxHz)} onCommit={(v) => {
          const hz = parseMHz(v);
          if (hz === null) return;
          const rx = clampFrequency(hz, limits.rxMinHz, limits.maxHz);
          // CE42: entering RX also sets TX to the same frequency
          set({ rxHz: rx, txHz: ch.txHz === ch.rxHz ? clampFrequency(rx, limits.txMinHz, limits.maxHz) : ch.txHz, enabled: true });
        }} />
      </td>
      <td>
        {ch.txInhibit ? <span className="muted">{t("rxOnly")}</span> : (
          <TextCell className="freq" ariaLabel={label(t("colTx"))} value={formatMHz(ch.txHz)} onCommit={(v) => {
            const hz = parseMHz(v);
            if (hz !== null) set({ txHz: clampFrequency(hz, limits.txMinHz, limits.maxHz) });
          }} />
        )}
      </td>
      <td className="c">
        <input type="checkbox" aria-label={label(t("colTxAllowed"))} checked={!ch.txInhibit} onChange={(e) => set({ txInhibit: !e.target.checked })} />
      </td>
      <td>
        <select aria-label={label(t("colMode"))} value={ch.mode} onChange={(e) => set({ mode: Number(e.target.value) })}>
          {T.mode.map((m, i) => <option key={m} value={i} title={T.modeItu[i]}>{m}</option>)}
        </select>
      </td>
      <td>
        <select aria-label={label(t("colPower"))} value={ch.power} onChange={(e) => set({ power: Number(e.target.value) })}>
          {T.power.map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
      </td>
      <td className="c">
        <input type="checkbox" aria-label={label(t("colSelcall"))} checked={ch.selcall} onChange={(e) => set({ selcall: e.target.checked })} />
      </td>
      <td>
        <select aria-label={label(t("colEncryption"))} value={ch.encryption ? ch.encryptionCode : -1}
          onChange={(e) => {
            const v = Number(e.target.value);
            set(v < 0 ? { encryption: false } : { encryption: true, encryptionCode: v });
          }}>
          <option value={-1}>OFF</option>
          {T.encryptionCode.map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
      </td>
      <td className="c">
        <input type="checkbox" aria-label={label(t("colTune"))} checked={ch.tuneMode} onChange={(e) => set({ tuneMode: e.target.checked })} />
      </td>
      <td className="c">
        <input type="checkbox" aria-label={label(t("colShift"))} checked={ch.clockShift} onChange={(e) => set({ clockShift: e.target.checked })} />
      </td>
    </tr>
  );
}, (a, b) => a.limits === b.limits && a.t === b.t && JSON.stringify(a.ch) === JSON.stringify(b.ch));

export function ChannelTable({ bytes, rev, edit }: Props) {
  const { t } = useI18n();
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const [query, setQuery] = useState("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const channels = useMemo(() => decodeChannels(bytes), [rev]);
  const rxRange = getSetting(bytes, "rxRange"), txRange = getSetting(bytes, "txRange");
  const limits = useMemo(() => frequencyLimits(rxRange, txRange), [rxRange, txRange]);
  const enabledCount = channels.filter((c) => c.enabled).length;
  const q = query.trim().toUpperCase();
  const visible = channels.filter((c) => (!onlyEnabled || c.enabled) &&
    (!q || c.tag.toUpperCase().includes(q) || formatMHz(c.rxHz).includes(q) || String(c.number).padStart(3, "0").includes(q)));
  const onChange = useMemo(() => (c: Channel) => edit((d) => encodeChannel(d, c)), [edit]);

  return (
    <section className="panel">
      <div className="panel-bar">
        <strong>{t("channelsSummary", { n: enabledCount })}</strong>
        <label className="inline"><input type="checkbox" checked={onlyEnabled} onChange={(e) => setOnlyEnabled(e.target.checked)} /> {t("onlyEnabled")}</label>
        <input className="search" type="search" placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table className="channels">
          <thead>
            <tr>
              {COLUMNS.map(([label, help]) => (
                <th key={help}><span className="th">{t(label)}<HelpTip id={help} /></span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => <Row key={c.number} ch={c} limits={limits} onChange={onChange} t={t} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}
