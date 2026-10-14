import { readBits, writeBits } from "../bits.js";
import { createDefaultImage, decodeFirmwareVersion, sanitizeImage, type SanitizeIssue } from "../image.js";
import {
  BLOCK_COUNT, BLOCK_SIZE, CHANNEL_COUNT, CHANNEL_STATUS_PROGRAMMED, MODEL_ID, blockOffset, channelOffset, region,
  type Region,
} from "../layout.js";
import { FACTORY_OPTION_IDS, settingById } from "../settings.js";
import {
  ACK, BLOCK_FRAME_SIZE, CHANNEL_FRAME_SIZE, CMD, END_KIND, IDENT_RESPONSE_SIZE, NAK, WRITE_MASK, isFrameValid,
  parseChannelFrame,
} from "./frames.js";
import { AbortError, TimeoutError, sleep, type ByteTransport, type TransportFactory } from "./transport.js";

export type CloneErrorCode = "no-response" | "wrong-model" | "timeout" | "checksum" | "refused" | "cancelled";

export class CloneError extends Error {
  override name = "CloneError";
  constructor(readonly code: CloneErrorCode, message: string, override readonly cause?: unknown) {
    super(message);
  }
}

export interface RadioInfo {
  /** e.g. "0108" (two bytes printed as hex, like CE42's FW Version panel). */
  firmware: string;
  /** Raw 16-byte identification answer. */
  raw: Uint8Array;
}

export type ClonePhase = "identify" | "read" | "write" | "verify" | "factory";

export interface CloneProgress {
  phase: ClonePhase;
  done: number;
  total: number;
}

export interface CloneOptions {
  signal?: AbortSignal;
  onProgress?: (p: CloneProgress) => void;
  log?: (message: string) => void;
  /** Per-frame answer timeout, CE42 uses 1000 ms. */
  timeoutMs?: number;
  /** Delay before the first command after opening the port (CE42: 100 ms + 100 ms). */
  settleMs?: number;
  /** Pause after the end-of-write command (CE42: 2000 ms). */
  endWriteDelayMs?: number;
}

const DEFAULTS = { timeoutMs: 1000, settleMs: 200, endWriteDelayMs: 2000 };

function opts(o: CloneOptions) {
  return { ...DEFAULTS, ...o };
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CloneError) throw e;
    if (e instanceof AbortError) throw new CloneError("cancelled", "operation cancelled", e);
    if (e instanceof TimeoutError) throw new CloneError("timeout", "no answer from the radio", e);
    throw e;
  }
}

/** Identification handshake: up to 3 attempts, like FUN_004ae28c. */
export async function identify(t: ByteTransport, o: CloneOptions = {}): Promise<RadioInfo> {
  const { timeoutMs, signal, log } = opts(o);
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (signal?.aborted) throw new CloneError("cancelled", "operation cancelled");
    t.discardInput();
    await t.write(CMD.identify());
    try {
      const raw = await t.read(IDENT_RESPONSE_SIZE, timeoutMs, signal);
      const model = String.fromCharCode(...raw.subarray(2, 8));
      if (model !== MODEL_ID) {
        last = new CloneError("wrong-model", `radio model "${model}" is not a VX-1210 (${MODEL_ID})`);
      } else {
        const info = { firmware: decodeFirmwareVersion(raw[0] ?? 0, raw[1] ?? 0), raw };
        log?.(`radio identified, firmware ${info.firmware}`);
        return info;
      }
    } catch (e) {
      if (e instanceof AbortError) throw new CloneError("cancelled", "operation cancelled", e);
      if (!(e instanceof TimeoutError)) throw e;
      last = e;
    }
    log?.(`no valid identification (attempt ${attempt}/3)`);
    await sleep(10, signal).catch(() => undefined);
  }
  if (last instanceof CloneError) throw last;
  throw new CloneError("no-response", "the radio did not answer the identification request", last);
}

export interface ReadResult {
  bytes: Uint8Array;
  info: RadioInfo;
  issues: SanitizeIssue[];
  /** Channel numbers (1-based) the radio sent. */
  receivedChannels: number[];
}

/** Radio -> PC ("Upload" in CE42 terms), FUN_004ae410 / FUN_004ae5e4. */
export async function readRadio(open: TransportFactory, o: CloneOptions = {}): Promise<ReadResult> {
  const { timeoutMs, settleMs, signal, onProgress, log } = opts(o);
  const t = await open();
  try {
    return await guarded(async () => {
      await sleep(settleMs, signal);
      onProgress?.({ phase: "identify", done: 0, total: 1 });
      const info = await identify(t, o);
      const bytes = createDefaultImage();
      const total = BLOCK_COUNT - 1;
      const receivedChannels: number[] = [];
      t.discardInput();
      await t.write(CMD.read());
      // channel records, terminated by a record whose number is >= 500
      for (;;) {
        const f = await t.read(CHANNEL_FRAME_SIZE, timeoutMs, signal);
        if (!isFrameValid(f)) throw new CloneError("checksum", "checksum error in channel record");
        const { channel, data } = parseChannelFrame(f);
        if (channel < CHANNEL_COUNT) {
          bytes.set(data, channelOffset(channel));
          receivedChannels.push(channel + 1);
          onProgress?.({ phase: "read", done: channel + 1, total });
        }
        await t.write(Uint8Array.of(ACK));
        if (channel >= CHANNEL_COUNT) break;
      }
      log?.(`received ${receivedChannels.length} channel records`);
      // general, tuner0, tuner1, factory: 12 + 16 + 16 + 16 blocks (blocks 500..559)
      for (let block = CHANNEL_COUNT; block < BLOCK_COUNT; block++) {
        const f = await t.read(BLOCK_FRAME_SIZE, timeoutMs, signal);
        if (!isFrameValid(f)) throw new CloneError("checksum", `checksum error in block ${block}`);
        bytes.set(f.subarray(0, BLOCK_SIZE), blockOffset(block));
        onProgress?.({ phase: "read", done: block, total });
        await t.write(Uint8Array.of(ACK));
      }
      const issues = sanitizeImage(bytes);
      return { bytes, info, issues, receivedChannels };
    });
  } finally {
    await t.close();
  }
}

async function expectAck(t: ByteTransport, timeoutMs: number, signal: AbortSignal | undefined, what: string) {
  const [b] = await t.read(1, timeoutMs, signal);
  if (b === ACK) return;
  if (b === NAK) throw new CloneError("refused", `the radio refused ${what}`);
  throw new CloneError("refused", `unexpected answer 0x${(b ?? 0).toString(16)} to ${what}`);
}

interface WriteJob {
  mask: number;
  end: number;
  blocks: { address: number; data: Uint8Array; label: string }[];
}

function regionBlocks(bytes: Uint8Array, r: Region) {
  return Array.from({ length: r.blocks }, (_, k) => ({
    address: (r.radioAddress + k * BLOCK_SIZE) & 0xffff,
    data: bytes.slice(r.offset + k * BLOCK_SIZE, r.offset + (k + 1) * BLOCK_SIZE),
    label: `${r.name}[${k}]`,
  }));
}

/** Normal write (DAT_004dd54c = 1, FUN_004aef80): programmed channels, general, tuners. */
export function normalWriteJob(bytes: Uint8Array): WriteJob {
  const ch = region("channels");
  const blocks = [];
  for (let i = 0; i < CHANNEL_COUNT; i++) {
    const o = channelOffset(i);
    if (bytes[o] !== CHANNEL_STATUS_PROGRAMMED) continue; // empty channels are not sent
    blocks.push({ address: ch.radioAddress + i * BLOCK_SIZE, data: bytes.slice(o, o + BLOCK_SIZE), label: `CH-${i + 1}` });
  }
  blocks.push(...regionBlocks(bytes, region("general")), ...regionBlocks(bytes, region("tuner0")), ...regionBlocks(bytes, region("tuner1")));
  return { mask: WRITE_MASK.normal, end: END_KIND.normal, blocks };
}

/** Factory block write (DAT_004dd54c = 2, FUN_004af76c). */
export function factoryWriteJob(bytes: Uint8Array): WriteJob {
  return { mask: WRITE_MASK.factory, end: END_KIND.service, blocks: regionBlocks(bytes, region("factory")) };
}

async function runWriteJob(open: TransportFactory, job: WriteJob, phase: ClonePhase, o: CloneOptions, endDelay: number) {
  const { timeoutMs, settleMs, signal, onProgress, log } = opts(o);
  const t = await open();
  try {
    await guarded(async () => {
      await sleep(settleMs, signal);
      await identify(t, o);
      t.discardInput();
      await t.write(CMD.writeBegin(job.mask));
      await expectAck(t, timeoutMs, signal, "the write request");
      let done = 0;
      for (const b of job.blocks) {
        await t.write(CMD.writeBlock(b.address, b.data));
        await expectAck(t, timeoutMs, signal, b.label);
        onProgress?.({ phase, done: ++done, total: job.blocks.length });
      }
      await t.write(CMD.writeEnd(job.end));
      log?.(`${phase}: ${job.blocks.length} blocks written`);
      await sleep(endDelay, signal);
    });
  } finally {
    await t.close();
  }
}

/** Copy the user-editable option bytes that live in the factory block. */
export function applyFactoryOptions(target: Uint8Array, source: Uint8Array): void {
  for (const id of FACTORY_OPTION_IDS) {
    const f = settingById(id).field;
    writeBits(target, f, readBits(source, f));
  }
}

export interface WriteResult {
  /** What the radio holds after the transfer (read back + factory options). */
  bytes: Uint8Array;
  info: RadioInfo;
}

export interface WriteOptions extends CloneOptions {
  /**
   * Also write the option bytes kept in the factory block (CW pitch, data mode, keys...),
   * using CE42's safe sequence: read the radio back, patch only those bytes onto the
   * radio's own factory/alignment data, write the factory block. Default true.
   */
  factoryOptions?: boolean;
}

/** PC -> radio ("Download" in CE42 terms), TfrmMain.miDownloadClick. */
export async function writeRadio(open: TransportFactory, image: Uint8Array, o: WriteOptions = {}): Promise<WriteResult> {
  const { endWriteDelayMs } = opts(o);
  await runWriteJob(open, normalWriteJob(image), "write", o, endWriteDelayMs);
  const back = await readRadio(open, { ...o, onProgress: (p) => o.onProgress?.({ ...p, phase: "verify" }) });
  if (o.factoryOptions === false) return { bytes: back.bytes, info: back.info };
  const merged = back.bytes.slice();
  applyFactoryOptions(merged, image);
  await runWriteJob(open, factoryWriteJob(merged), "factory", o, 200);
  return { bytes: merged, info: back.info };
}

/** Compare the regions a normal write sends; returns human-readable differences. */
export function diffWritable(a: Uint8Array, b: Uint8Array): string[] {
  const out: string[] = [];
  const ja = normalWriteJob(a).blocks, jb = new Map(normalWriteJob(b).blocks.map((x) => [x.address, x]));
  for (const x of ja) {
    const y = jb.get(x.address);
    if (!y) out.push(`${x.label} missing`);
    else if (x.data.some((v, i) => v !== y.data[i])) out.push(`${x.label} differs`);
  }
  return out;
}
