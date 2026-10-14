import { ByteQueue, SERIAL_SETTINGS, type ByteTransport, type TransportFactory } from "@ce42/core";
import { desktop } from "../desktop";

export const isWebSerialSupported = () => typeof navigator !== "undefined" && "serial" in navigator;

/** Ask the user to pick the programming cable's port (must run inside a click handler). */
export async function requestPort(): Promise<SerialPort> {
  return navigator.serial.requestPort();
}

export function describePort(port: SerialPort): string {
  const info = port.getInfo();
  if (info.usbVendorId === undefined) return "porta serial";
  const hex = (n?: number) => (n ?? 0).toString(16).padStart(4, "0");
  return `USB ${hex(info.usbVendorId)}:${hex(info.usbProductId)}`;
}

/** "COM3" in the desktop app (the shell remembers the chosen port), USB ids in a browser. */
export async function portLabel(port: SerialPort): Promise<string> {
  const name = await desktop?.lastPortName().catch(() => null);
  return name || describePort(port);
}

/**
 * A TransportFactory over one Web Serial port. Each call opens the port with CE42's line
 * settings (9600 8N2, no flow control, DTR+RTS on) and returns a transport that closes it.
 */
export function webSerialFactory(port: SerialPort): TransportFactory {
  return async () => {
    await port.open({
      baudRate: SERIAL_SETTINGS.baudRate,
      dataBits: SERIAL_SETTINGS.dataBits,
      stopBits: SERIAL_SETTINGS.stopBits,
      parity: SERIAL_SETTINGS.parity,
      flowControl: SERIAL_SETTINGS.flowControl,
      bufferSize: 4096,
    });
    await port.setSignals({ dataTerminalReady: SERIAL_SETTINGS.dtr, requestToSend: SERIAL_SETTINGS.rts });
    const queue = new ByteQueue();
    const reader = port.readable!.getReader();
    let closed = false;
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) queue.push(value);
        }
      } catch {
        /* port closed or device unplugged */
      } finally {
        reader.releaseLock();
      }
    })();

    const transport: ByteTransport = {
      async write(data) {
        const w = port.writable!.getWriter();
        try {
          await w.write(data);
        } finally {
          w.releaseLock();
        }
      },
      read: (n, timeoutMs, signal) => queue.read(n, timeoutMs, signal),
      discardInput: () => queue.clear(),
      async close() {
        if (closed) return;
        closed = true;
        await reader.cancel().catch(() => undefined);
        await pump;
        await port.close().catch(() => undefined);
      },
    };
    return transport;
  };
}
