import { readU32BE, writeU32BE } from "./bits.js";
import { CHANNEL_STATUS_EMPTY, CHANNEL_STATUS_PROGRAMMED, CHANNEL_COUNT, channelOffset } from "./layout.js";
import { T } from "./tables.js";

/**
 * Channel record, 32 bytes (descriptor table at 0x004D9920 in CE42Win.exe):
 *
 *  0      status        0xA5 programmed, 0xFF empty
 *  1      mode          index into T.mode (0=LSB 1=USB 2=CW 3=AM 4=DATA; ITU: J3E, J3E, A1A, A3E, J2B)
 *  2..5   RX frequency  uint32 BE, 10 Hz units
 *  6..9   TX frequency  uint32 BE, 10 Hz units
 *  10..17 tag           8 ASCII chars, 0x00 padded
 *  18     power         0=High 1=Low
 *  19     (unused by CE42, preserved)
 *  20     selcall       0=OFF 1=ON
 *  21     encryption    0=OFF 1=ON
 *  22     encryption code 0..15 (shown as 01..16)
 *  23     tune mode     0=OFF 1=ON   (antenna tuner)
 *  24     clock shift   0=OFF 1=ON
 *  25     TX inhibit    0=TX allowed, otherwise RX only
 *  26..31 (0xFF, preserved)
 */
export interface Channel {
  /** 1-based channel number (001..500). */
  readonly number: number;
  enabled: boolean;
  tag: string;
  /** Frequencies in Hz (always multiples of 10). */
  rxHz: number;
  txHz: number;
  txInhibit: boolean;
  mode: number;
  power: number;
  selcall: boolean;
  encryption: boolean;
  encryptionCode: number;
  tuneMode: boolean;
  clockShift: boolean;
}

export const TAG_LENGTH = 8;
export const FREQ_UNIT_HZ = 10;
export const FREQ_MAX_HZ = 30_000_000;

const OFF = {
  status: 0, mode: 1, rx: 2, tx: 6, tag: 10, power: 18, selcall: 20, encryption: 21,
  encryptionCode: 22, tuneMode: 23, clockShift: 24, txInhibit: 25,
} as const;

/** Decode the tag like CE42 (FUN_004929fc): 0x00 and non-printable bytes become spaces. */
export function decodeTag(raw: Uint8Array): string {
  let s = "";
  for (const b of raw) s += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : " ";
  return s;
}

/** Tags are upper-cased printable ASCII, max 8 chars (CE42 key filter FUN_004985b0). */
export function normaliseTag(tag: string): string {
  return tag.toUpperCase().replace(/[^\x20-\x7e]/g, " ").slice(0, TAG_LENGTH);
}

export function defaultTag(number: number): string {
  return `  CH-${String(number).padStart(3, "0")}`;
}

export function decodeChannel(bytes: Uint8Array, index: number): Channel {
  const o = channelOffset(index);
  const b = (k: number) => bytes[o + k] ?? 0;
  return {
    number: index + 1,
    enabled: b(OFF.status) === CHANNEL_STATUS_PROGRAMMED,
    tag: decodeTag(bytes.subarray(o + OFF.tag, o + OFF.tag + TAG_LENGTH)),
    rxHz: readU32BE(bytes, o + OFF.rx) * FREQ_UNIT_HZ,
    txHz: readU32BE(bytes, o + OFF.tx) * FREQ_UNIT_HZ,
    txInhibit: b(OFF.txInhibit) !== 0,
    mode: b(OFF.mode),
    power: b(OFF.power),
    selcall: b(OFF.selcall) !== 0,
    encryption: b(OFF.encryption) !== 0,
    encryptionCode: b(OFF.encryptionCode),
    tuneMode: b(OFF.tuneMode) !== 0,
    clockShift: b(OFF.clockShift) !== 0,
  };
}

function setBool(bytes: Uint8Array, at: number, v: boolean) {
  // keep the stored non-zero value when the boolean meaning did not change
  if (((bytes[at] ?? 0) !== 0) !== v) bytes[at] = v ? 1 : 0;
}

/**
 * Write a channel back. Bytes whose meaning did not change are left untouched, so a
 * decode/encode round trip is lossless (unlike CE42, which rewrites 0x00 tag padding).
 */
export function encodeChannel(bytes: Uint8Array, ch: Channel): void {
  const o = channelOffset(ch.number - 1);
  const status = bytes[o + OFF.status];
  const programmed = status === CHANNEL_STATUS_PROGRAMMED;
  if (programmed !== ch.enabled) bytes[o + OFF.status] = ch.enabled ? CHANNEL_STATUS_PROGRAMMED : CHANNEL_STATUS_EMPTY;
  bytes[o + OFF.mode] = ch.mode & 0xff;
  writeU32BE(bytes, o + OFF.rx, Math.round(ch.rxHz / FREQ_UNIT_HZ));
  writeU32BE(bytes, o + OFF.tx, Math.round(ch.txHz / FREQ_UNIT_HZ));
  const rawTag = bytes.subarray(o + OFF.tag, o + OFF.tag + TAG_LENGTH);
  if (decodeTag(rawTag) !== ch.tag.padEnd(TAG_LENGTH, " ").slice(0, TAG_LENGTH)) {
    rawTag.fill(0);
    const t = normaliseTag(ch.tag);
    for (let i = 0; i < t.length; i++) rawTag[i] = t.charCodeAt(i);
  }
  bytes[o + OFF.power] = ch.power & 0xff;
  setBool(bytes, o + OFF.selcall, ch.selcall);
  setBool(bytes, o + OFF.encryption, ch.encryption);
  bytes[o + OFF.encryptionCode] = ch.encryptionCode & 0xff;
  setBool(bytes, o + OFF.tuneMode, ch.tuneMode);
  setBool(bytes, o + OFF.clockShift, ch.clockShift);
  setBool(bytes, o + OFF.txInhibit, ch.txInhibit);
}

export function decodeChannels(bytes: Uint8Array): Channel[] {
  return Array.from({ length: CHANNEL_COUNT }, (_, i) => decodeChannel(bytes, i));
}

/** Reset a record to the state CE42 gives an empty channel (sanitiser, FUN_00496d1c). */
export function clearChannelRecord(bytes: Uint8Array, index: number): void {
  const o = channelOffset(index);
  bytes[o + OFF.status] = CHANNEL_STATUS_EMPTY;
  bytes[o + OFF.mode] = 1;
  writeU32BE(bytes, o + OFF.rx, 300_000);
  writeU32BE(bytes, o + OFF.tx, 300_000);
  const tag = defaultTag(index + 1);
  for (let i = 0; i < TAG_LENGTH; i++) bytes[o + OFF.tag + i] = tag.charCodeAt(i);
  bytes.fill(0, o + 18, o + 26);
  bytes.fill(0xff, o + 26, o + 32);
}

export interface FrequencyLimits {
  rxMinHz: number;
  txMinHz: number;
  maxHz: number;
}

/**
 * Limits applied by the CE42 grid editor (FUN_0049892c): RX >= 0.5 MHz (or 3 MHz when the
 * hardware RX range option is "3-30 MHz"), TX >= 1.6 MHz, everything <= 30 MHz.
 */
export function frequencyLimits(rxRangeOption: number, txRangeOption: number): FrequencyLimits {
  return {
    rxMinHz: rxRangeOption === 0 ? 500_000 : 3_000_000,
    txMinHz: txRangeOption === 0 ? 1_600_000 : 3_000_000,
    maxHz: FREQ_MAX_HZ,
  };
}

export function clampFrequency(hz: number, minHz: number, maxHz = FREQ_MAX_HZ): number {
  const rounded = Math.round(hz / FREQ_UNIT_HZ) * FREQ_UNIT_HZ;
  return Math.min(maxHz, Math.max(minHz, rounded));
}

export function formatMHz(hz: number): string {
  return (hz / 1e6).toFixed(5);
}

export function modeName(mode: number): string {
  return T.mode[mode] ?? `? (${mode})`;
}
