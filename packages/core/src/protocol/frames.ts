import { checksum, readU16BE, writeU16BE } from "../bits.js";
import { BLOCK_SIZE } from "../layout.js";

/**
 * VX-1210 clone protocol frames (CE42Win.exe, unit of TfrmRadio).
 *
 * PC -> radio commands are 37 bytes: [0][cmd][param hi][param lo][32 data bytes][sum],
 * sum = 8-bit sum of bytes 0..35. The command constants live in DATA at 0x004D83F4.. .
 * The radio answers writes with a single byte: 'Y' (0x59) accepted, 'N' (0x4E) refused.
 */
export const ACK = 0x59;
export const NAK = 0x4e;
export const COMMAND_SIZE = 37;
export const IDENT_RESPONSE_SIZE = 16;
/** Upload channel frame: [channel hi][channel lo][32 data][sum of bytes 0..33]. */
export const CHANNEL_FRAME_SIZE = 35;
/** Upload data frame: [32 data][sum of bytes 0..31]. */
export const BLOCK_FRAME_SIZE = 33;

/** Region mask sent with the write request (byte 3). */
export const WRITE_MASK = {
  /** channels (0x80) + general (0x40) + tuner banks (0x04 | 0x02) */
  normal: 0xc6,
  /** factory / alignment block */
  factory: 0x08,
  /** antenna tuner banks only */
  tuner: 0x06,
} as const;

export const END_KIND = { normal: 0x02, service: 0x01 } as const;

export function commandFrame(head: readonly number[], data?: Uint8Array): Uint8Array {
  const f = new Uint8Array(COMMAND_SIZE);
  f.set(head.slice(0, 4));
  if (data) f.set(data.subarray(0, BLOCK_SIZE), 4);
  f[COMMAND_SIZE - 1] = checksum(f, 0, COMMAND_SIZE - 1);
  return f;
}

export const CMD = {
  /** Identify; radio answers 16 bytes [fw hi][fw lo]"ac027h"[8 bytes]. */
  identify: () => commandFrame([0x00, 0x00, 0x10, 0x00]),
  /** Start upload (radio -> PC). */
  read: () => commandFrame([0x00, 0x01, 0x00, 0x00]),
  writeBegin: (mask: number) => commandFrame([0x00, 0x02, 0x00, mask]),
  writeBlock: (address: number, data: Uint8Array) => commandFrame([0x00, 0x03, (address >> 8) & 0xff, address & 0xff], data),
  writeEnd: (kind: number) => commandFrame([0x00, 0x04, 0x00, kind]),
  /** Serial number query used by the Serial Writer dialog; answer is 8 bytes. */
  readSerial: () => commandFrame([0x01, 0x09, 0x00, 0x00]),
} as const;

export function isFrameValid(frame: Uint8Array): boolean {
  return checksum(frame, 0, frame.length - 1) === frame[frame.length - 1];
}

export interface ChannelFrame {
  channel: number;
  data: Uint8Array;
}

export function parseChannelFrame(f: Uint8Array): ChannelFrame {
  return { channel: readU16BE(f, 0), data: f.slice(2, 2 + BLOCK_SIZE) };
}

export function buildChannelFrame(channel: number, data: Uint8Array): Uint8Array {
  const f = new Uint8Array(CHANNEL_FRAME_SIZE);
  writeU16BE(f, 0, channel);
  f.set(data.subarray(0, BLOCK_SIZE), 2);
  f[CHANNEL_FRAME_SIZE - 1] = checksum(f, 0, CHANNEL_FRAME_SIZE - 1);
  return f;
}

export function buildBlockFrame(data: Uint8Array): Uint8Array {
  const f = new Uint8Array(BLOCK_FRAME_SIZE);
  f.set(data.subarray(0, BLOCK_SIZE));
  f[BLOCK_SIZE] = checksum(f, 0, BLOCK_SIZE);
  return f;
}
