/**
 * Minimal byte transport the clone protocol runs on. Implementations: Web Serial
 * (apps/web), node-serialport (future desktop shell) and the in-memory radio simulator.
 */
export interface ByteTransport {
  write(data: Uint8Array): Promise<void>;
  /** Resolve with exactly `n` bytes or reject with TimeoutError / AbortError. */
  read(n: number, timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array>;
  /** Drop bytes received but not read yet. */
  discardInput(): void;
  close(): Promise<void>;
}

/** Opens a fresh connection; CE42 re-opens the port for every phase of a transfer. */
export type TransportFactory = () => Promise<ByteTransport>;

/**
 * Serial line settings used by CE42 (FUN_004ae1fc / TCommX.Open): 9600 baud, 8 data bits,
 * no parity, 2 stop bits, no flow control, DTR and RTS asserted (DCB flags 0x1010).
 */
export const SERIAL_SETTINGS = {
  baudRate: 9600,
  dataBits: 8,
  parity: "none",
  stopBits: 2,
  flowControl: "none",
  dtr: true,
  rts: true,
} as const;

export class TimeoutError extends Error {
  override name = "TimeoutError";
}

export class AbortError extends Error {
  override name = "AbortError";
}

/** FIFO used by transports to turn pushed chunks into exact-length reads. */
export class ByteQueue {
  private buf = new Uint8Array(0);
  private wake: (() => void) | null = null;

  get length(): number {
    return this.buf.length;
  }

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    const next = new Uint8Array(this.buf.length + chunk.length);
    next.set(this.buf);
    next.set(chunk, this.buf.length);
    this.buf = next;
    this.wake?.();
  }

  clear(): void {
    this.buf = new Uint8Array(0);
  }

  async read(n: number, timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array> {
    const deadline = Date.now() + timeoutMs;
    while (this.buf.length < n) {
      if (signal?.aborted) throw new AbortError("aborted");
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new TimeoutError(`timeout waiting for ${n} bytes (got ${this.buf.length})`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, remaining);
        const onAbort = () => done();
        signal?.addEventListener("abort", onAbort, { once: true });
        function done() {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }
        this.wake = () => {
          this.wake = null;
          done();
        };
      });
    }
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new AbortError("aborted"));
    }, { once: true });
  });
