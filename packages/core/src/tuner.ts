import { readBits, writeBits, type BitField } from "./bits.js";
import { CHANNEL_COUNT, region } from "./layout.js";

/**
 * Antenna tuner memory per channel, 2 bytes per channel (descriptor table at 0x004D99B8).
 * Channels 1..250 live in bank tuner0, 251..500 in bank tuner1 (250 entries each, the
 * last 12 bytes of each 512-byte bank are unused).
 *
 *   byte0 b7     Reset   (0/1)
 *   byte0 b6     Thru    (0/1)
 *   byte0 b5..4  Trans   (0..3)
 *   byte0 b3..2  Mid-C   (0..3)
 *   byte0 b1     Top-C   (0/1)
 *   byte0 b0 + byte1  L  (9 bits, 0..511)
 */
export interface TunerData {
  reset: number;
  thru: number;
  trans: number;
  midC: number;
  topC: number;
  l: number;
}

const FIELDS: Record<keyof TunerData, BitField> = {
  reset: { offset: 0, startBit: 7, endBit: 7 },
  thru: { offset: 0, startBit: 6, endBit: 6 },
  trans: { offset: 0, startBit: 5, endBit: 4 },
  midC: { offset: 0, startBit: 3, endBit: 2 },
  topC: { offset: 0, startBit: 1, endBit: 1 },
  l: { offset: 0, endOffset: 1, startBit: 0, endBit: 0 },
};

export const TUNER_LIMITS: Record<keyof TunerData, number> = { reset: 1, thru: 1, trans: 3, midC: 3, topC: 1, l: 511 };

export function tunerOffset(channelIndex: number): number {
  if (channelIndex < 0 || channelIndex >= CHANNEL_COUNT) throw new RangeError(`channel index ${channelIndex}`);
  const bank = channelIndex < 250 ? region("tuner0") : region("tuner1");
  return bank.offset + (channelIndex % 250) * 2;
}

function shifted(f: BitField, base: number): BitField {
  return { ...f, offset: f.offset + base, endOffset: (f.endOffset ?? f.offset) + base };
}

export function readTuner(bytes: Uint8Array, channelIndex: number): TunerData {
  const base = tunerOffset(channelIndex);
  const out = {} as TunerData;
  for (const k of Object.keys(FIELDS) as (keyof TunerData)[]) out[k] = readBits(bytes, shifted(FIELDS[k], base));
  return out;
}

export function writeTuner(bytes: Uint8Array, channelIndex: number, data: TunerData): void {
  const base = tunerOffset(channelIndex);
  for (const k of Object.keys(FIELDS) as (keyof TunerData)[]) {
    const v = data[k];
    if (!Number.isInteger(v) || v < 0 || v > TUNER_LIMITS[k]) throw new RangeError(`tuner ${k}=${v}`);
    writeBits(bytes, shifted(FIELDS[k], base), v);
  }
}
