import { decodeChannel, encodeChannel, formatMHz, normaliseTag, type Channel } from "./channel.js";
import { CHANNEL_COUNT } from "./layout.js";
import { T } from "./tables.js";

export const CSV_COLUMNS = [
  "Channel", "Enabled", "Tag", "RxMHz", "TxMHz", "TxInhibit", "Mode", "Power", "Selcall", "Encryption", "EncryptionCode", "TuneMode", "ClockShift",
] as const;

const yesNo = (b: boolean) => (b ? "Y" : "N");
const parseYesNo = (s: string) => /^(y|yes|s|sim|1|true|on)$/i.test(s.trim());

function quote(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function channelsToCsv(bytes: Uint8Array, onlyEnabled = false): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    const c = decodeChannel(bytes, i);
    if (onlyEnabled && !c.enabled) continue;
    lines.push([
      String(c.number), yesNo(c.enabled), quote(c.tag), formatMHz(c.rxHz), formatMHz(c.txHz), yesNo(c.txInhibit),
      T.mode[c.mode] ?? String(c.mode), T.power[c.power] ?? String(c.power), yesNo(c.selcall), yesNo(c.encryption),
      T.encryptionCode[c.encryptionCode] ?? String(c.encryptionCode + 1), yesNo(c.tuneMode), yesNo(c.clockShift),
    ].join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === ";") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export interface CsvImportResult {
  updated: number;
  errors: string[];
}

function parseMHz(s: string): number {
  const v = Number(s.trim().replace(",", "."));
  if (!Number.isFinite(v)) throw new Error(`invalid frequency "${s}"`);
  return Math.round(v * 1e5) * 10;
}

function lookup(table: readonly string[], s: string, what: string): number {
  const v = s.trim().toUpperCase();
  const i = table.findIndex((x) => x.toUpperCase() === v);
  if (i < 0) throw new Error(`invalid ${what} "${s}"`);
  return i;
}

/** Accepts ham names (USB, CW...), the ITU designators used by CE42 (J3E(USB), A1A...) and common aliases. */
const MODE_ALIASES: Record<string, number> = { SSB: 1, A1A: 2, A3E: 3, J2B: 4, DIG: 4, DIGI: 4, RTTY: 4, PKT: 4, "J3E(LSB)": 0, "J3E(USB)": 1 };
function lookupMode(s: string): number {
  const v = s.trim().toUpperCase();
  const i = T.mode.findIndex((x) => x === v);
  if (i >= 0) return i;
  const alias = MODE_ALIASES[v];
  if (alias !== undefined) return alias;
  throw new Error(`invalid mode "${s}"`);
}

/** Merge channels from CSV (same columns as export; header required, order free). */
export function importChannelsCsv(bytes: Uint8Array, text: string): CsvImportResult {
  const rows = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const errors: string[] = [];
  if (rows.length === 0) return { updated: 0, errors: ["empty file"] };
  const header = splitCsvLine(rows[0] ?? "").map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  if (col("Channel") < 0) return { updated: 0, errors: ['missing "Channel" column'] };
  let updated = 0;
  rows.slice(1).forEach((line, idx) => {
    const cells = splitCsvLine(line);
    const get = (name: string) => { const k = col(name); return k >= 0 ? cells[k] : undefined; };
    try {
      const n = Number(get("Channel"));
      if (!Number.isInteger(n) || n < 1 || n > CHANNEL_COUNT) throw new Error(`invalid channel "${get("Channel")}"`);
      const c: Channel = decodeChannel(bytes, n - 1);
      const v = (name: string, apply: (s: string) => void) => { const s = get(name); if (s !== undefined && s.trim() !== "") apply(s); };
      v("Enabled", (s) => (c.enabled = parseYesNo(s)));
      v("Tag", (s) => (c.tag = normaliseTag(s)));
      v("RxMHz", (s) => (c.rxHz = parseMHz(s)));
      v("TxMHz", (s) => (c.txHz = parseMHz(s)));
      v("TxInhibit", (s) => (c.txInhibit = parseYesNo(s)));
      v("Mode", (s) => (c.mode = lookupMode(s)));
      v("Power", (s) => (c.power = lookup(T.power, s, "power")));
      v("Selcall", (s) => (c.selcall = parseYesNo(s)));
      v("Encryption", (s) => (c.encryption = parseYesNo(s)));
      v("EncryptionCode", (s) => (c.encryptionCode = lookup(T.encryptionCode, s.padStart(2, "0"), "encryption code")));
      v("TuneMode", (s) => (c.tuneMode = parseYesNo(s)));
      v("ClockShift", (s) => (c.clockShift = parseYesNo(s)));
      for (const hz of [c.rxHz, c.txHz]) if (hz < 500_000 || hz > 30_000_000) throw new Error(`frequency ${hz / 1e6} MHz out of 0.5-30 MHz`);
      encodeChannel(bytes, c);
      updated++;
    } catch (e) {
      errors.push(`line ${idx + 2}: ${(e as Error).message}`);
    }
  });
  return { updated, errors };
}
