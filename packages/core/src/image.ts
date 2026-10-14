import { readU16BE, writeU16BE } from "./bits.js";
import { clearChannelRecord, decodeChannel, FREQ_MAX_HZ } from "./channel.js";
import {
  CHANNEL_COUNT, CHANNEL_STATUS_EMPTY, CHANNEL_STATUS_PROGRAMMED, IMAGE_SIZE, MARKER_OFFSETS, MARKER_VALUE,
  MODEL_ID, channelOffset,
} from "./layout.js";
import { isValidSetting, SETTINGS, getSetting, setSetting } from "./settings.js";
import { T } from "./tables.js";

/**
 * Factory/alignment defaults of a new file (non-zero bytes of the factory block of the
 * default.c42 shipped with CE42 1.08). Alignment values are only meaningful for a real
 * radio; writes to the radio always keep the radio's own factory block (see clone.ts).
 */
const FACTORY_DEFAULTS: readonly [number, readonly number[]][] = [
  [0x440e, [0xb4, 0x78, 0x00, 0x20, 0x80, 0x00, 0x7f, 0xc8, 0xf0, 0x00, 0xc8, 0xdc, 0xf0, 0x64, 0x78, 0x8c, 0x32,
    0x46, 0x5a, 0x0a, 0x14, 0x1e, 0xfa, ...Array<number>(24).fill(0x7f), 0xc8]],
  [0x45ce, [0x06, 0x00, 0x00, 0x00, 0xff, 0x2c, 0x02]],
];

export function createDefaultImage(): Uint8Array {
  const bytes = new Uint8Array(IMAGE_SIZE);
  for (let i = 0; i < MODEL_ID.length; i++) bytes[i] = MODEL_ID.charCodeAt(i);
  for (let i = 0; i < CHANNEL_COUNT; i++) clearChannelRecord(bytes, i);
  // general block: zeros except the settings whose default is not 0
  bytes.fill(0, 0x3e86, 0x4006);
  for (const s of SETTINGS) if (s.field.offset < 0x4006 && s.default !== 0) setSetting(bytes, s.id, s.default);
  for (const [at, values] of FACTORY_DEFAULTS) bytes.set(values, at);
  for (const m of MARKER_OFFSETS) writeU16BE(bytes, m, MARKER_VALUE);
  return bytes;
}

export function isModelIdValid(bytes: Uint8Array): boolean {
  return String.fromCharCode(...bytes.subarray(0, MODEL_ID.length)) === MODEL_ID;
}

export interface SanitizeIssue {
  where: string;
  message: string;
}

/**
 * Normalise an image the way CE42 does after reading a file or the radio (FUN_00496d1c):
 * unknown channel status -> empty, empty channels reset to defaults, frequencies outside
 * 0.5..30 MHz reset, out-of-table values reset to defaults. Returns what was changed.
 */
export function sanitizeImage(bytes: Uint8Array): SanitizeIssue[] {
  const issues: SanitizeIssue[] = [];
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    const o = channelOffset(i);
    const where = `CH-${String(i + 1).padStart(3, "0")}`;
    const status = bytes[o];
    if (status !== CHANNEL_STATUS_PROGRAMMED) {
      if (status !== CHANNEL_STATUS_EMPTY) {
        bytes[o] = CHANNEL_STATUS_EMPTY;
        issues.push({ where, message: `status 0x${status?.toString(16)} -> empty` });
      }
      // Unlike CE42 we keep the other bytes of empty channels (they are never sent to the radio)
      continue;
    }
    const ch = decodeChannel(bytes, i);
    const fix = (cond: boolean, k: number, v: number, msg: string) => {
      if (cond) { bytes[o + k] = v; issues.push({ where, message: msg }); }
    };
    if (ch.rxHz < 500_000 || ch.rxHz > FREQ_MAX_HZ) issues.push({ where, message: `RX ${ch.rxHz} Hz out of range` });
    if (!ch.txInhibit && (ch.txHz < 500_000 || ch.txHz > FREQ_MAX_HZ)) issues.push({ where, message: `TX ${ch.txHz} Hz out of range` });
    fix(ch.mode >= T.mode.length, 1, 1, "mode reset to J3E(USB)");
    fix(ch.power >= T.power.length, 18, 0, "power reset to High");
    fix(ch.encryptionCode >= 16, 22, 0, "encryption code reset to 01");
  }
  for (const s of SETTINGS) {
    const v = getSetting(bytes, s.id);
    if (!isValidSetting(s, v)) {
      setSetting(bytes, s.id, s.default);
      issues.push({ where: s.id, message: `${v} invalid, reset to default` });
    }
  }
  for (const m of MARKER_OFFSETS) {
    if (readU16BE(bytes, m) !== MARKER_VALUE) {
      writeU16BE(bytes, m, MARKER_VALUE);
      issues.push({ where: `0x${m.toString(16)}`, message: "integrity marker restored" });
    }
  }
  return issues;
}

/** Serial number as displayed by CE42 (FUN_00492ad0), e.g. "0B000000". */
export function decodeSerial(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < 8; i++) {
    const v = bytes[0x4406 + i] ?? 0;
    if (i === 1) {
      if (v === 0) s += "B";
      else if (v <= 12) s += String.fromCharCode(v + 0x42);
      else if (v >= 13 && v <= 15) s += String.fromCharCode(v + 0x44);
      else if (v === 0x41 || v === 0x4f || v === 0x50 || (v > 0x53 && v < 0x5b)) s += String.fromCharCode(v);
      else s += "*";
    } else s += v < 10 ? String(v) : v <= 15 ? String.fromCharCode(v + 0x37) : "0";
  }
  return s;
}

export function decodeFirmwareVersion(hi: number, lo: number): string {
  return hi.toString(16).padStart(2, "0") + lo.toString(16).padStart(2, "0");
}
