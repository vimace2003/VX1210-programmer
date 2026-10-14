/**
 * Bit-field access with the exact semantics of the CE42 descriptor tables.
 *
 * A descriptor names a big-endian bit range: it starts at bit `startBit` (MSB side) of
 * byte `offset` and ends at bit `endBit` (LSB side) of byte `endOffset`. The value is the
 * masked big-endian number shifted right by `endBit` (FUN_00492924 / FUN_00493f70).
 */
export interface BitField {
  readonly offset: number;
  readonly endOffset?: number;
  /** 7 = MSB of the first byte (default). */
  readonly startBit?: number;
  /** 0 = LSB of the last byte (default). */
  readonly endBit?: number;
  /** Two's complement interpretation (FUN_0049284c). Only for whole 8/16-bit fields. */
  readonly signed?: boolean;
}

function span(f: BitField) {
  const end = f.endOffset ?? f.offset;
  const startBit = f.startBit ?? 7;
  const endBit = f.endBit ?? 0;
  return { start: f.offset, end, startBit, endBit, width: (end - f.offset) * 8 + startBit - endBit + 1 };
}

function maskFor(i: number, s: ReturnType<typeof span>): number {
  let m = 0xff;
  if (i === s.start) m &= (2 << s.startBit) - 1;
  if (i === s.end) m &= ~((1 << s.endBit) - 1) & 0xff;
  return m;
}

export function readBits(bytes: Uint8Array, f: BitField): number {
  const s = span(f);
  let v = 0;
  for (let i = s.start; i <= s.end; i++) v = v * 256 + ((bytes[i] ?? 0) & maskFor(i, s));
  v = Math.floor(v / 2 ** s.endBit);
  if (f.signed && v >= 2 ** (s.width - 1)) v -= 2 ** s.width;
  return v;
}

export function writeBits(bytes: Uint8Array, f: BitField, value: number): void {
  const s = span(f);
  const max = 2 ** s.width;
  let v = Math.trunc(value);
  if (v < 0) v += max;
  v = ((v % max) + max) % max;
  v *= 2 ** s.endBit;
  for (let i = s.end; i >= s.start; i--) {
    const m = maskFor(i, s);
    const b = v % 256;
    v = Math.floor(v / 256);
    bytes[i] = ((bytes[i] ?? 0) & ~m & 0xff) | (b & m);
  }
}

export function readU16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

export function writeU16BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

export function readU32BE(bytes: Uint8Array, offset: number): number {
  return readU16BE(bytes, offset) * 0x10000 + readU16BE(bytes, offset + 2);
}

export function writeU32BE(bytes: Uint8Array, offset: number, value: number): void {
  writeU16BE(bytes, offset, Math.floor(value / 0x10000) & 0xffff);
  writeU16BE(bytes, offset + 2, value & 0xffff);
}

/** 8-bit additive checksum used by every clone frame (FUN_0049785c). */
export function checksum(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let s = 0;
  for (let i = start; i < end; i++) s = (s + (bytes[i] ?? 0)) & 0xff;
  return s;
}
