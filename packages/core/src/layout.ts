/**
 * Physical layout of the VX-1210 clone image ("Text" in the original CE42 sources).
 *
 * A .C42 file is a byte-for-byte dump of this image (CE42 class TText, data at +4):
 *   [0x0000..0x0005]  model id "ac027h"
 *   [0x0006 + 32*n]   560 blocks of 32 bytes (the radio memory as exchanged on the wire)
 *   [0x4606]          one PC-side byte (not exchanged with the radio)
 *
 * Block numbering is the one used by the upload loop in CE42Win.exe (FUN_004ae5e4):
 * blocks 0..499 are channels, 500..511 general settings, 512..527 / 528..543 antenna
 * tuner banks, 544..559 factory/alignment data.
 */

export const IMAGE_SIZE = 0x4607; // 17927, size checked by CE42 when opening a file
export const MODEL_ID = "ac027h";
export const BLOCK_SIZE = 32;
export const BLOCK_BASE = 0x0006;
export const BLOCK_COUNT = 560;

export const CHANNEL_COUNT = 500;
export const CHANNEL_BASE = BLOCK_BASE;
export const CHANNEL_SIZE = BLOCK_SIZE;

/** Status byte of a channel record. Anything else is normalised to EMPTY. */
export const CHANNEL_STATUS_PROGRAMMED = 0xa5;
export const CHANNEL_STATUS_EMPTY = 0xff;

/** Integrity markers that CE42 always writes back (0xA569). */
export const MARKER_VALUE = 0xa569;
export const MARKER_OFFSETS = [0x4004, 0x4604] as const;

export interface Region {
  readonly name: "channels" | "general" | "tuner0" | "tuner1" | "factory";
  /** Offset inside the image. */
  readonly offset: number;
  /** Number of 32-byte blocks. */
  readonly blocks: number;
  /** Address of the first block in radio memory (used by the write command). */
  readonly radioAddress: number;
}

export const REGIONS: readonly Region[] = [
  { name: "channels", offset: 0x0006, blocks: 500, radioAddress: 0xc000 },
  { name: "general", offset: 0x3e86, blocks: 12, radioAddress: 0xfe80 },
  { name: "tuner0", offset: 0x4006, blocks: 16, radioAddress: 0x0400 },
  { name: "tuner1", offset: 0x4206, blocks: 16, radioAddress: 0x0800 },
  { name: "factory", offset: 0x4406, blocks: 16, radioAddress: 0x0c00 },
];

export function region(name: Region["name"]): Region {
  const r = REGIONS.find((x) => x.name === name);
  if (!r) throw new Error(`unknown region ${name}`);
  return r;
}

export function blockOffset(block: number): number {
  if (block < 0 || block >= BLOCK_COUNT) throw new RangeError(`block ${block} out of range`);
  return BLOCK_BASE + block * BLOCK_SIZE;
}

export function channelOffset(index: number): number {
  if (index < 0 || index >= CHANNEL_COUNT) throw new RangeError(`channel index ${index} out of range`);
  return CHANNEL_BASE + index * CHANNEL_SIZE;
}
