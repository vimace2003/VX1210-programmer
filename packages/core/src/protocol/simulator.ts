import { CHANNEL_COUNT, CHANNEL_STATUS_PROGRAMMED, MODEL_ID, REGIONS, BLOCK_SIZE, region } from "../layout.js";
import { ACK, COMMAND_SIZE, NAK, buildBlockFrame, buildChannelFrame, isFrameValid } from "./frames.js";
import { ByteQueue, type ByteTransport } from "./transport.js";

/**
 * Behavioural model of the radio side of the clone protocol, derived from what CE42
 * sends and expects. Used for tests and for the web app's demo mode. Unknowns are
 * modelled conservatively and listed in docs/PROTOCOL.md:
 *  - the radio sends only programmed channels on read (CE42 accepts any subset);
 *  - a write request that includes channels (mask 0x80) erases all channels first.
 */
export interface SimulatorFaults {
  /** Ignore the first N identification requests. */
  ignoreIdentify?: number;
  /** Corrupt the checksum of the Nth frame sent during a read (0-based). */
  corruptReadFrame?: number;
  /** Answer 'N' to the Nth written block (0-based). */
  refuseBlock?: number;
  /** Stop answering after the Nth written block (0-based). */
  hangAfterBlock?: number;
}

export class VirtualVX1210 {
  /** 64 KiB radio address space. */
  readonly memory = new Uint8Array(0x10000).fill(0xff);
  firmware: [number, number] = [0x01, 0x08];
  faults: SimulatorFaults = {};
  readonly log: string[] = [];
  private identifyCount = 0;
  private writtenBlocks = 0;

  /** Load radio memory from a clone image (as if programmed by CE42). */
  loadImage(image: Uint8Array): void {
    for (const r of REGIONS) {
      for (let k = 0; k < r.blocks; k++) {
        this.memory.set(image.subarray(r.offset + k * BLOCK_SIZE, r.offset + (k + 1) * BLOCK_SIZE), r.radioAddress + k * BLOCK_SIZE);
      }
    }
  }

  regionBytes(name: (typeof REGIONS)[number]["name"]): Uint8Array {
    const r = region(name);
    return this.memory.slice(r.radioAddress, r.radioAddress + r.blocks * BLOCK_SIZE);
  }

  /** A new PC-side connection (one per CE42 phase). */
  connect(): ByteTransport {
    const toPc = new ByteQueue();
    const fromPc = new ByteQueue();
    const stop = new AbortController();
    const run = this.session(fromPc, (b) => { if (!stop.signal.aborted) toPc.push(b); }, stop.signal).catch((e: unknown) => {
      if (!stop.signal.aborted) this.log.push(`session ended: ${String(e)}`);
    });
    return {
      write: async (data) => { if (!stop.signal.aborted) fromPc.push(data.slice()); },
      read: (n, timeoutMs, signal) => toPc.read(n, timeoutMs, signal),
      discardInput: () => toPc.clear(),
      close: async () => { stop.abort(); await run; },
    };
  }

  private async session(rx: ByteQueue, send: (b: Uint8Array) => void, signal: AbortSignal): Promise<void> {
    const forever = 24 * 3600 * 1000;
    for (;;) {
      const cmd = await rx.read(COMMAND_SIZE, forever, signal);
      if (!isFrameValid(cmd)) { this.log.push("bad command checksum"); continue; }
      const op = `${cmd[0]}:${cmd[1]}`;
      if (op === "0:0") {
        if ((this.faults.ignoreIdentify ?? 0) > this.identifyCount++) continue;
        const r = new Uint8Array(16);
        r[0] = this.firmware[0];
        r[1] = this.firmware[1];
        for (let i = 0; i < MODEL_ID.length; i++) r[2 + i] = MODEL_ID.charCodeAt(i);
        send(r);
      } else if (op === "0:1") {
        await this.sendAll(rx, send, signal);
      } else if (op === "0:2") {
        const mask = cmd[3] ?? 0;
        this.log.push(`write begin mask=0x${mask.toString(16)}`);
        if (mask & 0x80) {
          const ch = region("channels");
          this.memory.fill(0xff, ch.radioAddress, ch.radioAddress + ch.blocks * BLOCK_SIZE);
        }
        send(Uint8Array.of(ACK));
      } else if (op === "0:3") {
        const n = this.writtenBlocks++;
        if (this.faults.hangAfterBlock !== undefined && n > this.faults.hangAfterBlock) continue;
        if (this.faults.refuseBlock === n) { send(Uint8Array.of(NAK)); continue; }
        const address = ((cmd[2] ?? 0) << 8) | (cmd[3] ?? 0);
        this.memory.set(cmd.subarray(4, 4 + BLOCK_SIZE), address);
        send(Uint8Array.of(ACK));
      } else if (op === "0:4") {
        this.log.push(`write end kind=${cmd[3]}`);
      } else if (op === "1:9") {
        send(this.memory.slice(0x0c00, 0x0c08));
      } else {
        this.log.push(`unknown command ${op}`);
      }
    }
  }

  private async sendAll(rx: ByteQueue, send: (b: Uint8Array) => void, signal: AbortSignal) {
    let frameNo = 0;
    const emit = async (frame: Uint8Array) => {
      if (this.faults.corruptReadFrame === frameNo++) frame[frame.length - 1] = ((frame[frame.length - 1] ?? 0) + 1) & 0xff;
      send(frame);
      const [ack] = await rx.read(1, 5000, signal);
      if (ack !== ACK) throw new Error(`expected ACK, got ${ack}`);
    };
    const ch = region("channels");
    for (let i = 0; i < CHANNEL_COUNT; i++) {
      const a = ch.radioAddress + i * BLOCK_SIZE;
      if (this.memory[a] !== CHANNEL_STATUS_PROGRAMMED) continue;
      await emit(buildChannelFrame(i, this.memory.subarray(a, a + BLOCK_SIZE)));
    }
    await emit(buildChannelFrame(0xffff, new Uint8Array(BLOCK_SIZE).fill(0xff)));
    for (const name of ["general", "tuner0", "tuner1", "factory"] as const) {
      const r = region(name);
      for (let k = 0; k < r.blocks; k++) {
        const a = r.radioAddress + k * BLOCK_SIZE;
        await emit(buildBlockFrame(this.memory.subarray(a, a + BLOCK_SIZE)));
      }
    }
  }
}
