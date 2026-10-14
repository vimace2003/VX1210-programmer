import { CloneError, readRadio, writeRadio, type CloneProgress, type RadioInfo, type TransportFactory } from "@ce42/core";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { StringKey } from "../i18n/strings";

export type RadioJob =
  | { kind: "read"; open: TransportFactory; demo: boolean }
  | { kind: "write"; open: TransportFactory; demo: boolean; image: Uint8Array };

export interface RadioOutcome {
  bytes: Uint8Array;
  info: RadioInfo;
}

export function RadioDialog({ job, onClose }: { job: RadioJob; onClose: (result: RadioOutcome | null) => void }) {
  const { t } = useI18n();
  const [progress, setProgress] = useState<CloneProgress | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<"running" | "ok" | "error">("running");
  const [message, setMessage] = useState("");
  const result = useRef<RadioOutcome | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    abort.current = ac;
    let live = true;
    const fast = job.demo ? { settleMs: 0, endWriteDelayMs: 50 } : {};
    const options = { signal: ac.signal, onProgress: setProgress, log: (m: string) => setLog((l) => [...l, m]), ...fast };
    const run = job.kind === "read" ? readRadio(job.open, options) : writeRadio(job.open, job.image, options);
    run.then((r) => {
      if (!live) return;
      result.current = { bytes: r.bytes, info: r.info };
      setStatus("ok");
      setMessage(t(job.kind === "read" ? "readDone" : "writeDone", { fw: r.info.firmware }));
    }).catch((e: unknown) => {
      if (!live) return;
      if (e instanceof CloneError) setMessage(t(`err_${e.code.replace("-", "_")}` as StringKey));
      else setMessage(String(e instanceof Error ? e.message : e));
      setLog((l) => [...l, String(e instanceof Error ? e.message : e)]);
      setStatus("error");
    });
    return () => {
      live = false;
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="backdrop" role="dialog" aria-modal="true" aria-labelledby="radio-title">
      <div className="dialog">
        <h2 id="radio-title">{t(job.kind === "read" ? "radioTitleRead" : "radioTitleWrite")}{job.demo && <span className="badge">{t("demoRadio")}</span>}</h2>
        {status === "running" && <p className="muted">{t("radioInstructions")}</p>}
        <div className="phase">{progress ? t(`phase_${progress.phase}` as StringKey) : t("phase_identify")}</div>
        <progress max={100} value={status === "ok" ? 100 : pct} />
        {message && <p className={status === "error" ? "error" : "success"}>{message}</p>}
        {log.length > 0 && <pre className="log">{log.join("\n")}</pre>}
        <div className="actions">
          {status === "running"
            ? <button onClick={() => abort.current?.abort()}>{t("cancel")}</button>
            : <button className="primary" autoFocus onClick={() => onClose(result.current)}>{status === "ok" ? t("done") : t("close")}</button>}
        </div>
      </div>
    </div>
  );
}
