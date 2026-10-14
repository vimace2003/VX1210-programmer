import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CMD, CloneError, VirtualVX1210, WRITE_MASK, END_KIND, createDefaultImage, decodeChannel, encodeChannel, getSetting,
  normalWriteJob, parseC42, readRadio, region, setSetting, writeRadio, type CloneOptions,
} from "../src/index.js";

const fixture = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
const alignment = parseC42(fixture("alignment.c42")).bytes;
const fast: CloneOptions = { timeoutMs: 100, settleMs: 0, endWriteDelayMs: 0 };

/** Non-zero bytes of a frame as "index:hex", matching how the constants appear in CE42Win.exe DATA. */
const sparse = (f: Uint8Array) => Array.from(f).flatMap((v, i) => (v ? [`${i}:${v.toString(16)}`] : [])).join(" ");

describe("command frames (byte-exact with CE42Win.exe)", () => {
  it.each([
    ["identify", CMD.identify(), "2:10 36:10"],
    ["read", CMD.read(), "1:1 36:1"],
    ["write begin normal", CMD.writeBegin(WRITE_MASK.normal), "1:2 3:c6 36:c8"],
    ["write begin factory", CMD.writeBegin(WRITE_MASK.factory), "1:2 3:8 36:a"],
    ["write begin tuner", CMD.writeBegin(WRITE_MASK.tuner), "1:2 3:6 36:8"],
    ["write end normal", CMD.writeEnd(END_KIND.normal), "1:4 3:2 36:6"],
    ["write end service", CMD.writeEnd(END_KIND.service), "1:4 3:1 36:5"],
    ["read serial", CMD.readSerial(), "0:1 1:9 36:a"],
  ])("%s", (_, frame, expected) => {
    expect(frame).toHaveLength(37);
    expect(sparse(frame)).toBe(expected);
  });

  it("builds write-block frames with big-endian address and checksum", () => {
    const data = new Uint8Array(32).fill(1);
    const f = CMD.writeBlock(0xc020, data);
    expect(Array.from(f.subarray(0, 4))).toEqual([0x00, 0x03, 0xc0, 0x20]);
    expect(f[36]).toBe((0x03 + 0xc0 + 0x20 + 32) & 0xff);
  });

  it("sends only programmed channels, then general and tuner banks", () => {
    const job = normalWriteJob(alignment);
    const programmed = Array.from({ length: 500 }, (_, i) => alignment[6 + i * 32] === 0xa5).filter(Boolean).length;
    expect(job.blocks).toHaveLength(programmed + 12 + 16 + 16);
    expect(job.blocks[programmed]?.address).toBe(0xfe80);
    expect(job.blocks.at(-1)?.address).toBe(0x09e0);
  });
});

describe("reading the radio (Upload)", () => {
  it("reads back the whole memory", async () => {
    const radio = new VirtualVX1210();
    radio.loadImage(alignment);
    const progress: number[] = [];
    const r = await readRadio(async () => radio.connect(), { ...fast, onProgress: (p) => progress.push(p.done) });
    expect(r.info.firmware).toBe("0108");
    expect(Buffer.from(r.bytes).equals(Buffer.from(alignment))).toBe(true);
    expect(progress.at(-1)).toBe(559);
  });

  it("retries the identification three times", async () => {
    const radio = new VirtualVX1210();
    radio.faults.ignoreIdentify = 2;
    await expect(readRadio(async () => radio.connect(), fast)).resolves.toBeTruthy();
    const dead = new VirtualVX1210();
    dead.faults.ignoreIdentify = 3;
    await expect(readRadio(async () => dead.connect(), fast)).rejects.toMatchObject({ code: "no-response" });
  });

  it("detects checksum errors", async () => {
    const radio = new VirtualVX1210();
    radio.loadImage(alignment);
    radio.faults.corruptReadFrame = 3;
    await expect(readRadio(async () => radio.connect(), fast)).rejects.toMatchObject({ code: "checksum" });
  });

  it("can be cancelled", async () => {
    const radio = new VirtualVX1210();
    const ac = new AbortController();
    ac.abort();
    await expect(readRadio(async () => radio.connect(), { ...fast, signal: ac.signal })).rejects.toBeInstanceOf(CloneError);
  });
});

describe("writing the radio (Download)", () => {
  it("writes channels, keeps the radio's alignment data and patches factory options", async () => {
    const radio = new VirtualVX1210();
    radio.loadImage(alignment);
    const radioFactoryBefore = radio.regionBytes("factory");

    const image = createDefaultImage();
    const c = decodeChannel(image, 4);
    Object.assign(c, { enabled: true, tag: "PY2 NET", rxHz: 7_100_000, txHz: 7_100_000, mode: 0 });
    encodeChannel(image, c);
    setSetting(image, "lamp", 4);
    setSetting(image, "cwPitch", 2);
    setSetting(image, "keyA", 4);

    const phases = new Set<string>();
    const r = await writeRadio(async () => radio.connect(), image, { ...fast, onProgress: (p) => phases.add(p.phase) });
    expect([...phases]).toEqual(["write", "verify", "factory"]);

    // channels: only CH-005 programmed now
    expect(decodeChannel(r.bytes, 4)).toMatchObject({ enabled: true, tag: "PY2 NET ", rxHz: 7_100_000 });
    expect(decodeChannel(r.bytes, 0).enabled).toBe(false);
    expect(getSetting(r.bytes, "lamp")).toBe(4);
    // factory block: radio's own data except the user options
    const factoryAfter = radio.regionBytes("factory");
    const f = region("factory");
    const changed = Array.from(factoryAfter).flatMap((v, i) => (v !== radioFactoryBefore[i] ? [(f.offset + i).toString(16)] : []));
    expect(changed).toEqual(["45ce", "45d7", "45d8", "45d9"]);
    expect(getSetting(r.bytes, "cwPitch")).toBe(2);
    expect(getSetting(r.bytes, "keyA")).toBe(4);
    expect(r.bytes.subarray(0x440e, 0x443e)).toEqual(alignment.subarray(0x440e, 0x443e));
  });

  it("stops when the radio refuses a block", async () => {
    const radio = new VirtualVX1210();
    radio.faults.refuseBlock = 5;
    await expect(writeRadio(async () => radio.connect(), alignment, fast)).rejects.toMatchObject({ code: "refused" });
  });

  it("times out when the radio stops answering", async () => {
    const radio = new VirtualVX1210();
    radio.faults.hangAfterBlock = 2;
    await expect(writeRadio(async () => radio.connect(), alignment, fast)).rejects.toMatchObject({ code: "timeout" });
  });
});
