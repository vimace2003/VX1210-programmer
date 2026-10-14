import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  C42FormatError, IMAGE_SIZE, KEY_FUNCTIONS, channelsToCsv, createDefaultImage, decodeChannel, decodeChannels,
  decodeSerial, encodeChannel, getSetting, importChannelsCsv, parseC42, readSelcall, readTuner, sanitizeImage,
  serializeC42, setSetting, writeSelcall, writeTuner, SETTINGS,
} from "../src/index.js";

const fixture = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
const defaultFile = fixture("default.c42");
const alignmentFile = fixture("alignment.c42");

describe(".C42 file format", () => {
  it("has the size CE42 requires", () => {
    expect(defaultFile.length).toBe(IMAGE_SIZE);
    expect(alignmentFile.length).toBe(IMAGE_SIZE);
  });

  it("generates a new image identical to CE42's default.c42", () => {
    expect(Buffer.from(createDefaultImage()).equals(Buffer.from(defaultFile))).toBe(true);
  });

  it.each([["default.c42", defaultFile], ["alignment.c42", alignmentFile]])("round-trips %s byte for byte", (_, file) => {
    const { bytes, issues } = parseC42(file);
    expect(issues).toEqual([]);
    expect(Buffer.from(serializeC42(bytes)).equals(Buffer.from(file))).toBe(true);
  });

  it("re-encoding every decoded channel is lossless", () => {
    const bytes = alignmentFile.slice();
    for (const ch of decodeChannels(bytes)) encodeChannel(bytes, ch);
    expect(Buffer.from(bytes).equals(Buffer.from(alignmentFile))).toBe(true);
  });

  it("rejects files of the wrong size or model", () => {
    expect(() => parseC42(defaultFile.slice(0, 100))).toThrow(C42FormatError);
    const wrong = defaultFile.slice();
    wrong[0] = 0x58;
    expect(() => parseC42(wrong)).toThrow(/model/);
  });
});

describe("channels", () => {
  it("decodes the default empty channel", () => {
    const c = decodeChannel(defaultFile, 0);
    expect(c).toMatchObject({ number: 1, enabled: false, tag: "  CH-001", rxHz: 3_000_000, txHz: 3_000_000, mode: 1 });
  });

  it("decodes the alignment channels (VCO test points, RX only)", () => {
    const [c1, c2] = [decodeChannel(alignmentFile, 0), decodeChannel(alignmentFile, 1)];
    expect(c1).toMatchObject({ enabled: true, tag: "VCO1 U  ", rxHz: 8_999_990, txHz: 8_999_990, txInhibit: true, mode: 1 });
    expect(c2).toMatchObject({ enabled: true, tag: "VCO1 L  ", rxHz: 500_000, txHz: 1_600_000 });
  });

  it("encodes edits into the expected bytes", () => {
    const bytes = createDefaultImage();
    const c = decodeChannel(bytes, 9);
    Object.assign(c, { enabled: true, tag: "net br", rxHz: 7_065_000, txHz: 7_065_000, mode: 0, power: 1, selcall: true, encryption: true, encryptionCode: 4, tuneMode: true, clockShift: true, txInhibit: false });
    encodeChannel(bytes, c);
    const o = 6 + 9 * 32;
    expect(Array.from(bytes.subarray(o, o + 32))).toEqual([
      0xa5, 0x00, 0x00, 0x0a, 0xc7, 0xc4, 0x00, 0x0a, 0xc7, 0xc4, 0x4e, 0x45, 0x54, 0x20, 0x42, 0x52, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x01, 0x04, 0x01, 0x01, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ]);
    expect(decodeChannel(bytes, 9)).toMatchObject({ tag: "NET BR  ", rxHz: 7_065_000, encryptionCode: 4 });
  });
});

describe("settings", () => {
  it("reads CE42 defaults", () => {
    const v = Object.fromEntries(SETTINGS.map((s) => [s.id, getSetting(defaultFile, s.id)]));
    expect(v).toMatchObject({ lamp: 2, beep: 1, noiseBlanker: 1, preamble: 8, selcallHoldTime: 1, cwPitch: 6, pktOffset: -212, pktTone: 2 });
    for (const s of SETTINGS) expect(getSetting(defaultFile, s.id), s.id).toBe(s.default);
  });

  it("reads the alignment file's key assignments and options", () => {
    expect([getSetting(alignmentFile, "keyA"), getSetting(alignmentFile, "keyB"), getSetting(alignmentFile, "keyC")]).toEqual([10, 12, 1]);
    expect(KEY_FUNCTIONS.find((k) => k.code === 10)?.name).toBe("Squelch");
    expect(getSetting(alignmentFile, "tunerUnit")).toBe(1);
    expect(getSetting(alignmentFile, "voxGain")).toBe(30);
  });

  it("rejects out-of-range values", () => {
    const bytes = createDefaultImage();
    expect(() => setSetting(bytes, "hail", 3)).toThrow(RangeError);
    expect(() => setSetting(bytes, "keyA", 14)).toThrow(RangeError);
    setSetting(bytes, "pktOffset", 150);
    expect(getSetting(bytes, "pktOffset")).toBe(150);
    expect(Array.from(bytes.subarray(0x45d2, 0x45d4))).toEqual([0x00, 0x96]);
  });

  it("decodes the serial number like CE42", () => {
    expect(decodeSerial(defaultFile)).toBe("0B000000");
    const b = createDefaultImage();
    b.set([1, 3, 2, 0x0a, 4, 5, 6, 7], 0x4406);
    expect(decodeSerial(b)).toBe("1E2A4567");
  });
});

describe("selcall, telephone and tuner data", () => {
  it("reads and writes digit fields", () => {
    const bytes = createDefaultImage();
    const s = readSelcall(bytes);
    expect(s.selfId).toBe("0000");
    s.selfId = "1234";
    s.txIds[0] = "5678";
    s.telephones[2] = "0061212345678";
    writeSelcall(bytes, s);
    expect(Array.from(bytes.subarray(0x3e87, 0x3e8b))).toEqual([1, 2, 3, 4]);
    expect(Array.from(bytes.subarray(0x3e8b, 0x3e8f))).toEqual([5, 6, 7, 8]);
    expect(readSelcall(bytes).telephones[2]).toBe("0061212345678");
    expect(bytes[0x3eb4 + 32 + 15]).toBe(0x20);
  });

  it("packs antenna tuner data in 2 bytes per channel", () => {
    const bytes = createDefaultImage();
    writeTuner(bytes, 0, { reset: 1, thru: 0, trans: 2, midC: 3, topC: 1, l: 300 });
    expect(Array.from(bytes.subarray(0x4006, 0x4008))).toEqual([0b1010_1111, 0x2c]);
    writeTuner(bytes, 250, { reset: 0, thru: 1, trans: 0, midC: 0, topC: 0, l: 511 });
    expect(Array.from(bytes.subarray(0x4206, 0x4208))).toEqual([0b0100_0001, 0xff]);
    expect(readTuner(bytes, 0)).toEqual({ reset: 1, thru: 0, trans: 2, midC: 3, topC: 1, l: 300 });
  });
});

describe("sanitizer and CSV", () => {
  it("normalises corrupt data like CE42", () => {
    const bytes = createDefaultImage();
    bytes[6] = 0x12; // unknown channel status
    bytes[0x3f70] = 9; // HAIL out of table
    bytes[0x4004] = 0;
    const issues = sanitizeImage(bytes);
    expect(issues.map((i) => i.where)).toEqual(["CH-001", "hail", "0x4004"]);
    expect(getSetting(bytes, "hail")).toBe(0);
    expect(bytes[0x4004]).toBe(0xa5);
  });

  it("exports and re-imports channels", () => {
    const csv = channelsToCsv(alignmentFile, true);
    expect(csv.split("\r\n")[1]).toBe("1,Y,VCO1 U  ,8.99999,8.99999,Y,USB,High,N,N,01,N,N");
    const target = createDefaultImage();
    const r = importChannelsCsv(target, csv);
    expect(r.errors).toEqual([]);
    expect(decodeChannel(target, 0)).toMatchObject({ enabled: true, tag: "VCO1 U  ", rxHz: 8_999_990, txInhibit: true });
  });

  it("accepts ham mode names and the ITU designators of the original CE42", () => {
    const target = createDefaultImage();
    const r = importChannelsCsv(target, "Channel,Mode\n1,CW\n2,J3E(LSB)\n3,a3e\n4,RTTY\n5,usb\n");
    expect(r.errors).toEqual([]);
    expect([0, 1, 2, 3, 4].map((i) => decodeChannel(target, i).mode)).toEqual([2, 0, 3, 4, 1]);
  });

  it("reports bad CSV rows without stopping", () => {
    const target = createDefaultImage();
    const r = importChannelsCsv(target, "Channel,RxMHz,Mode\n1,7.1,LSB\n2,99,USB\n3,7.2,XYZ\n");
    expect(r.updated).toBe(1);
    expect(r.errors).toHaveLength(2);
    expect(decodeChannel(target, 0)).toMatchObject({ rxHz: 7_100_000, mode: 0 });
  });
});
