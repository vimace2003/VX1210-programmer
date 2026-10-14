import { TUNER_LIMITS, decodeChannels, readTuner, writeTuner, type TunerData } from "@ce42/core";
import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { Edit } from "../state";
import { HelpTip } from "./HelpTip";

const COLS: [keyof TunerData, string][] = [["reset", "Reset"], ["thru", "Thru"], ["trans", "Trans"], ["midC", "Mid-C"], ["topC", "Top-C"], ["l", "L"]];

export function TunerPanel({ bytes, rev, edit }: { bytes: Uint8Array; rev: number; edit: Edit }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const channels = useMemo(() => decodeChannels(bytes).filter((c) => all || c.enabled), [rev, all]);
  return (
    <section className="panel">
      <div className="panel-bar">
        <span className="th">{t("tunerIntro")}<HelpTip id="tuner" /></span>
        <label className="inline"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t("showAllChannels")}</label>
      </div>
      <div className="table-wrap">
        <table className="channels tuner">
          <thead><tr><th>{t("colCh")}</th><th>{t("colTag")}</th>{COLS.map(([, n]) => <th key={n}>{n}</th>)}</tr></thead>
          <tbody>
            {channels.map((c) => {
              const d = readTuner(bytes, c.number - 1);
              return (
                <tr key={c.number}>
                  <td className="num">{String(c.number).padStart(3, "0")}</td>
                  <td className="mono">{c.tag}</td>
                  {COLS.map(([k, n]) => (
                    <td key={k}>
                      <input type="number" aria-label={`${n} ${c.number}`} min={0} max={TUNER_LIMITS[k]} value={d[k]}
                        onChange={(e) => {
                          const v = Math.min(TUNER_LIMITS[k], Math.max(0, Math.trunc(Number(e.target.value) || 0)));
                          edit((b) => writeTuner(b, c.number - 1, { ...readTuner(b, c.number - 1), [k]: v }));
                        }} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
