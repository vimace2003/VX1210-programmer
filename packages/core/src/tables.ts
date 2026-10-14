/**
 * Value tables recovered from CE42Win.exe (TVALTBLX records at 0x004D8578, 0x58 bytes each).
 * The stored byte is the index into the table. Strings are kept exactly as in the
 * original program so that printouts and CSV exports stay comparable.
 */
export const T = {
  /** Operating mode as hams name it. J2B is the radio's DATA mode (RTTY/PKT per System > Data mode). */
  mode: ["LSB", "USB", "CW", "AM", "DATA"],
  /** ITU emission designators used by the original CE42 for the same values. */
  modeItu: ["J3E(LSB)", "J3E(USB)", "A1A", "A3E", "J2B"],
  power: ["High", "Low"],
  offOn: ["OFF", "ON"],
  encryptionCode: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16"],
  cwDelay: ["500 ms", "1000 ms", "1500 ms", "2000 ms", "2500 ms"],
  cwPitch: ["400 Hz", "500 Hz", "600 Hz", "700 Hz", "800 Hz", "900 Hz", "1000 Hz"],
  hail: ["1", "2", "3"],
  lamp: ["On", "Off", "Toggle", "Moment", "3 s", "Auto"],
  saveTime: ["OFF", "1.0 s", "1.5 s", "2.0 s", "2.5 s", "3.0 s", "3.5 s", "4.0 s", "4.5 s", "5.0 s"],
  voxDelay: ["500 ms", "1000 ms", "1500 ms", "2000 ms", "2500 ms"],
  dataMode: ["RTTY-LSB", "RTTY-USB", "PKT-LSB", "PKT-USB"],
  rttyShift: ["170 Hz", "425 Hz", "850 Hz"],
  rttyDisplay: ["Mark", "Carrier"],
  pktTone: ["1170 Hz", "1700 Hz", "2125 Hz", "2210 Hz"],
  speaker: ["Internal", "Auto", "SP MIC"],
  enableDisable: ["ENABLE", "DISABLE"],
  selcallPowerSave: ["OFF", "1 s", "2 s", "3 s", "4 s", "5 s", "6 s", "7 s", "8 s", "9 s"],
  telCallType: ["BARRETT", "CODAN12", "CODAN16"],
  rxRange: ["0.5-30 MHz", "3-30 MHz"],
  txRange: ["1.6-30 MHz", "3-30 MHz"],
  // Static lists defined in the DFM forms (not rebuilt from tables at run time)
  tot: ["OFF", ...Array.from({ length: 20 }, (_, i) => `${((i + 1) * 0.5).toFixed(1)} min`)],
  powerSaveHold: Array.from({ length: 51 }, (_, i) => `${(5 + i * 0.5).toString()} s`),
  selcallHold: Array.from({ length: 20 }, (_, i) => `${((i + 1) * 0.5).toFixed(1)} min`),
  preamble: Array.from({ length: 19 }, (_, i) => `${(1 + i * 0.5).toFixed(1)} s`),
  voxGain: ["OFF", ...Array.from({ length: 100 }, (_, i) => String(i + 1))],
} as const satisfies Record<string, readonly string[]>;

/** Programmable front-panel key functions (TKEYFNCTBL at 0x004D9574: name -> code). */
export const KEY_FUNCTIONS: readonly { code: number; name: string }[] = [
  { code: 0, name: "N/A" },
  { code: 1, name: "SELCALL" },
  { code: 2, name: "Power Select" },
  { code: 3, name: "Noise Blanker" },
  { code: 4, name: "Antenna Tuner" },
  { code: 5, name: "Antenna Tuning" },
  { code: 6, name: "ENCRYPTION" },
  { code: 7, name: "Display Select(Tag/Freq)" },
  { code: 8, name: "HAIL" },
  { code: 9, name: "TELCALL" },
  { code: 10, name: "Squelch" },
  { code: 11, name: "Speaker Select" },
  { code: 12, name: "Lamp" },
  { code: 13, name: "VFO/Memory" },
];

export function keyFunctionName(code: number): string {
  return KEY_FUNCTIONS.find((k) => k.code === code)?.name ?? `? (${code})`;
}
