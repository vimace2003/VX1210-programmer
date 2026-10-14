import {
  C42FormatError, VirtualVX1210, channelsToCsv, createDefaultImage, decodeChannel, decodeChannels, encodeChannel,
  frequencyLimits, getSetting, importChannelsCsv, isValidSelfId, parseC42, readSelcall, serializeC42,
} from "@ce42/core";
import { useEffect, useRef, useState } from "react";
import logoUrl from "./assets/logo.png";
import { byline } from "./buildInfo";
import { ChannelTable } from "./components/ChannelTable";
import { InfoPanel } from "./components/InfoPanel";
import { RadioDialog, type RadioJob } from "./components/RadioDialog";
import { SelcallPanel } from "./components/SelcallPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { TunerPanel } from "./components/TunerPanel";
import { useI18n } from "./i18n";
import { LANGUAGES, type Lang, type StringKey } from "./i18n/strings";
import { isWebSerialSupported, portLabel, requestPort, webSerialFactory } from "./serial/webSerial";
import { useDocument } from "./state";

type Tab = "channels" | "settings" | "selcall" | "tuner" | "info";
const TABS: [Tab, StringKey][] = [["channels", "tabChannels"], ["settings", "tabSettings"], ["selcall", "tabSelcall"], ["tuner", "tabTuner"], ["info", "tabInfo"]];

function demoRadio(): VirtualVX1210 {
  const img = createDefaultImage();
  const sample: [number, string, number][] = [[1, "PY CALL", 7_065_000], [2, "40M NET", 7_100_000], [3, "20M DX", 14_200_000], [4, "MARINE", 8_291_000], [5, "WWV 10", 10_000_000]];
  for (const [n, tag, hz] of sample) {
    const c = decodeChannel(img, n - 1);
    encodeChannel(img, { ...c, enabled: true, tag, rxHz: hz, txHz: hz, mode: hz < 10e6 ? 0 : 1, txInhibit: tag.startsWith("WWV") });
  }
  const radio = new VirtualVX1210();
  radio.loadImage(img);
  return radio;
}

async function saveFile(bytes: Uint8Array, suggested: string, mime: string, ext: string): Promise<string | null> {
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> };
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: suggested, types: [{ description: ext.toUpperCase(), accept: { [mime]: [`.${ext}`] } }] });
      const stream = await handle.createWritable();
      await stream.write(bytes as unknown as FileSystemWriteChunkType);
      await stream.close();
      return handle.name;
    } catch (e) {
      if ((e as Error).name === "AbortError") return null;
    }
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = Object.assign(document.createElement("a"), { href: url, download: suggested });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return suggested;
}

export function App() {
  const { t, lang, locale, setLang } = useI18n();
  const { state: doc, dispatch, edit } = useDocument();
  const [tab, setTab] = useState<Tab>("channels");
  const [port, setPort] = useState<SerialPort | null>(null);
  const [portName, setPortName] = useState("");
  const [useDemo, setUseDemo] = useState(!isWebSerialSupported());
  const [job, setJob] = useState<RadioJob | null>(null);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string; details?: string[] } | null>(null);
  const demo = useRef<VirtualVX1210 | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (doc.dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [doc.dirty]);

  useEffect(() => {
    if (!isWebSerialSupported()) return;
    navigator.serial.getPorts().then(async (ports) => {
      const first = ports[0];
      if (!first) return;
      setPort((p) => p ?? first);
      setPortName(await portLabel(first));
    }).catch(() => undefined);
  }, []);

  const discardOk = () => !doc.dirty || window.confirm(t("confirmDiscard"));
  const baseName = (doc.fileName ?? "vx1210").replace(/\.(c42|csv)$/i, "");

  async function openFile(f: File) {
    try {
      const { bytes, issues } = parseC42(new Uint8Array(await f.arrayBuffer()));
      dispatch({ type: "load", bytes, fileName: f.name, dirty: false });
      setNotice(issues.length ? { kind: "info", text: t("fileFixed", { n: issues.length }), details: issues.map((i) => `${i.where}: ${i.message}`) } : null);
    } catch (e) {
      setNotice({ kind: "error", text: t("fileError", { msg: e instanceof C42FormatError ? e.message : String(e) }) });
    }
  }

  async function save(as: boolean) {
    const name = !as && doc.fileName?.toLowerCase().endsWith(".c42") ? doc.fileName : `${baseName}.c42`;
    const saved = await saveFile(serializeC42(doc.bytes), name, "application/octet-stream", "c42");
    if (saved) dispatch({ type: "saved", fileName: saved });
  }

  async function importCsv(f: File) {
    const text = await f.text();
    const draft = doc.bytes.slice();
    const result = importChannelsCsv(draft, text);
    if (result.updated > 0) dispatch({ type: "load", bytes: draft, fileName: doc.fileName, dirty: true });
    setNotice({ kind: result.errors.length ? "error" : "info", text: t("csvResult", { n: result.updated }), ...(result.errors.length ? { details: [t("csvErrors"), ...result.errors] } : {}) });
  }

  function transport() {
    if (useDemo) {
      demo.current ??= demoRadio();
      const radio = demo.current;
      return { open: async () => radio.connect(), demo: true };
    }
    if (!port) return null;
    return { open: webSerialFactory(port), demo: false };
  }

  async function pickPort() {
    try {
      const chosen = await requestPort();
      setPort(chosen);
      setPortName(await portLabel(chosen));
      setUseDemo(false);
    } catch {
      /* user dismissed the chooser */
    }
  }

  async function startRead() {
    if (!discardOk()) return;
    if (!useDemo && !port) await pickPort();
    const tr = transport();
    if (tr) setJob({ kind: "read", ...tr });
  }

  function validate(): string[] {
    const problems: string[] = [];
    const lim = frequencyLimits(getSetting(doc.bytes, "rxRange"), getSetting(doc.bytes, "txRange"));
    for (const c of decodeChannels(doc.bytes)) {
      if (!c.enabled) continue;
      const n = `CH-${String(c.number).padStart(3, "0")}`;
      if (c.rxHz < lim.rxMinHz || c.rxHz > lim.maxHz) problems.push(`${n}: RX ${(c.rxHz / 1e6).toFixed(5)} MHz`);
      if (!c.txInhibit && (c.txHz < lim.txMinHz || c.txHz > lim.maxHz)) problems.push(`${n}: TX ${(c.txHz / 1e6).toFixed(5)} MHz`);
    }
    if (getSetting(doc.bytes, "selcallUnit") === 1 && !isValidSelfId(readSelcall(doc.bytes).selfId)) problems.push(`Selcall ${t("selfId")}: ${t("selfIdHint")}`);
    return problems;
  }

  async function startWrite() {
    const problems = validate();
    if (problems.length) {
      setNotice({ kind: "error", text: t("validationTitle"), details: problems });
      return;
    }
    const n = decodeChannels(doc.bytes).filter((c) => c.enabled).length;
    if (!window.confirm(t("confirmWrite", { n }))) return;
    if (!useDemo && !port) await pickPort();
    const tr = transport();
    if (tr) setJob({ kind: "write", ...tr, image: doc.bytes });
  }

  const title = `${doc.fileName ?? t("untitled")}${doc.dirty ? " •" : ""}`;
  useEffect(() => { document.title = `${title} · CE42 Next`; }, [title]);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img className="logo" src={logoUrl} alt="" width={44} height={44} />
          <div><h1>{t("appTitle")}</h1><p>{t("appSubtitle")}</p></div>
        </div>
        <nav className="toolbar" aria-label="toolbar">
          <div className="tool-group">
            <button onClick={() => discardOk() && dispatch({ type: "load", bytes: createDefaultImage(), fileName: null, dirty: false })}>{t("new")}</button>
            <button onClick={() => discardOk() && fileInput.current?.click()}>{t("open")}</button>
            <button onClick={() => void save(false)}>{t("save")}</button>
            <button onClick={() => void save(true)}>{t("saveAs")}</button>
          </div>
          <div className="tool-group">
            <button onClick={() => csvInput.current?.click()}>{t("importCsv")}</button>
            <button onClick={() => void saveFile(new TextEncoder().encode(channelsToCsv(doc.bytes)), `${baseName}.csv`, "text/csv", "csv")}>{t("exportCsv")}</button>
          </div>
          <div className="tool-group radio">
            <select aria-label={t("selectPort")} value={useDemo ? "demo" : port ? "port" : ""} onChange={(e) => {
              if (e.target.value === "demo") setUseDemo(true);
              else if (e.target.value === "pick") void pickPort();
              else setUseDemo(false);
            }}>
              {port && <option value="port">{portName}</option>}
              {!port && <option value="" disabled>{t("noPort")}</option>}
              {isWebSerialSupported() && <option value="pick">{t("selectPort")}…</option>}
              <option value="demo">{t("demoRadio")}</option>
            </select>
            <button className="primary" onClick={() => void startRead()}>{t("readRadio")}</button>
            <button className="primary" onClick={() => void startWrite()}>{t("writeRadio")}</button>
          </div>
          <select className="lang" aria-label={t("language")} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.code.toUpperCase()} · {l.name}</option>)}
          </select>
        </nav>
      </header>

      <input ref={fileInput} type="file" accept=".c42,.C42" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = ""; }} />
      <input ref={csvInput} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = ""; }} />

      {!isWebSerialSupported() && <div className="notice info">{t("webSerialMissing")}</div>}
      {notice && (
        <div className={`notice ${notice.kind}`} role="status">
          <span>{notice.text}</span>
          {notice.details && <details><summary>{notice.details.length}</summary><ul>{notice.details.map((d, i) => <li key={i}>{d}</li>)}</ul></details>}
          <button className="link" aria-label={t("close")} onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      <div className="tabs" role="tablist">
        {TABS.map(([id, key]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{t(key)}</button>
        ))}
        <span className="doc-title">{title}{doc.dirty && <small className="muted"> — {t("unsaved")}</small>}</span>
      </div>

      <main>
        {tab === "channels" && <ChannelTable bytes={doc.bytes} rev={doc.rev} edit={edit} />}
        {tab === "settings" && <SettingsPanel bytes={doc.bytes} edit={edit} />}
        {tab === "selcall" && <SelcallPanel bytes={doc.bytes} edit={edit} />}
        {tab === "tuner" && <TunerPanel bytes={doc.bytes} rev={doc.rev} edit={edit} />}
        {tab === "info" && <InfoPanel doc={doc} />}
      </main>

      <footer className="app-footer">
        <span>CE42 Next · VX-1210</span>
        <span className="byline">{byline(locale)}</span>
      </footer>

      {job && (
        <RadioDialog job={job} onClose={(r) => {
          setJob(null);
          if (r) {
            dispatch({ type: "radio", info: r.info });
            dispatch({ type: "load", bytes: r.bytes, fileName: doc.fileName, dirty: job.kind === "read" || doc.dirty });
          }
        }} />
      )}
    </div>
  );
}
