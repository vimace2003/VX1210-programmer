import { readBits, writeBits, type BitField } from "./bits.js";
import { KEY_FUNCTIONS, T } from "./tables.js";

/**
 * Radio-wide settings. Offsets are image offsets (see layout.ts); they come from the
 * descriptor table at 0x004D9610.. in CE42Win.exe and were bound to the CE42 dialogs by
 * matching the setter used by the decoder (FUN_00494b78) with the one used by each
 * dialog's OK handler. `source` names the original dialog control.
 *
 * Settings in the "factory" region (0x4406..0x4605) are not part of the normal write;
 * CE42 patches them onto the factory block read back from the radio (see clone.ts).
 */
export type SettingGroup =
  | "cw" | "hardware" | "powerSave" | "keys" | "misc" | "system" | "option" | "selcall" | "telephone";

interface Base {
  readonly id: string;
  readonly group: SettingGroup;
  readonly field: BitField;
  readonly default: number;
  readonly source: string;
  /** Not editable in the field version of CE42 (Hardware dialog). */
  readonly factoryLocked?: boolean;
}

export interface EnumSetting extends Base {
  readonly kind: "enum";
  readonly options: readonly string[];
}

export interface KeySetting extends Base {
  readonly kind: "key";
}

export interface NumberSetting extends Base {
  readonly kind: "number";
  readonly min: number;
  readonly max: number;
  /** Value shown to the user = stored * scale. */
  readonly scale: number;
  readonly unit: string;
}

export type Setting = EnumSetting | KeySetting | NumberSetting;

const e = (id: string, group: SettingGroup, offset: number, options: readonly string[], def: number, source: string, extra: Partial<Base> = {}): EnumSetting =>
  ({ kind: "enum", id, group, field: { offset }, options, default: def, source, ...extra });

export const SETTINGS: readonly Setting[] = [
  // A1A (CW) function
  e("cwDelay", "cw", 0x3f5f, T.cwDelay, 0, "TfrmComA1A.cmbCWDelay"),
  e("cwPitch", "cw", 0x45ce, T.cwPitch, 6, "TfrmComA1A.cmbCWPitch"),
  // Hardware
  e("hail", "hardware", 0x3f70, T.hail, 0, "TfrmHardware.cmbHail"),
  e("lamp", "hardware", 0x3f6f, T.lamp, 2, "TfrmHardware.cmbLamp"),
  e("rxRange", "hardware", 0x45d6, T.rxRange, 0, "TfrmHardware.cmbRxFreqRange", { factoryLocked: true }),
  e("txRange", "hardware", 0x45d5, T.txRange, 0, "TfrmHardware.cmbTxFreqRange", { factoryLocked: true }),
  // Power saving
  e("saveTime", "powerSave", 0x3f6c, T.saveTime, 0, "TfrmPowerSave.cmbSaveTime"),
  e("saveHoldTime", "powerSave", 0x3f6d, T.powerSaveHold, 0, "TfrmPowerSave.cmbHoldTime"),
  // Key functions (A/B/C front panel switches)
  { kind: "key", id: "keyA", group: "keys", field: { offset: 0x45d7 }, default: 0, source: "TfrmKeyFunc A" },
  { kind: "key", id: "keyB", group: "keys", field: { offset: 0x45d8 }, default: 0, source: "TfrmKeyFunc B" },
  { kind: "key", id: "keyC", group: "keys", field: { offset: 0x45d9 }, default: 0, source: "TfrmKeyFunc C" },
  // Miscellaneous
  e("beep", "misc", 0x3f6a, T.offOn, 1, "TfrmMisc.cmbBeep"),
  e("voxDelay", "misc", 0x3f5e, T.voxDelay, 0, "TfrmMisc.cmbVoxDelay"),
  e("voxGain", "misc", 0x3f5d, T.voxGain, 0, "TfrmMisc.cmbVoxGain"),
  // System
  e("dataMode", "system", 0x45cf, T.dataMode, 0, "TfrmSystem.cmbDataMode"),
  e("noiseBlanker", "system", 0x3f6b, T.offOn, 1, "TfrmSystem.cmbNB"),
  e("rttyShift", "system", 0x45d0, T.rttyShift, 0, "TfrmSystem.cmbRttyShift"),
  e("rttyDisplay", "system", 0x45d1, T.rttyDisplay, 0, "TfrmSystem.cmbRttyFDisp"),
  {
    kind: "number", id: "pktOffset", group: "system", field: { offset: 0x45d2, endOffset: 0x45d3, signed: true },
    default: -212, min: -300, max: 300, scale: 10, unit: "Hz", source: "TfrmSystem.edtPktOffset",
  },
  e("pktTone", "system", 0x45d4, T.pktTone, 2, "TfrmSystem.cmbPktTone"),
  e("speaker", "system", 0x3f6e, T.speaker, 0, "TfrmSystem.cmbSP"),
  e("tot", "system", 0x3f63, T.tot, 0, "TfrmSystem.cmbTot"),
  // Option units
  e("tunerUnit", "option", 0x3f60, T.offOn, 0, "TfrmOption.cmbTunerU"),
  e("encryptionUnit", "option", 0x3f61, T.offOn, 0, "TfrmOption.cmbEncryptU"),
  e("selcallUnit", "option", 0x3f62, T.offOn, 0, "TfrmOption.cmbSelcallU / TfrmSelcall.cmbSelcall"),
  // Selcall common
  e("killSystem", "selcall", 0x3f54, T.offOn, 0, "TfrmSelcall.cmbKillSystem"),
  e("allCall", "selcall", 0x3f69, T.enableDisable, 0, "TfrmSelcall.cmbAllCall"),
  e("groupCall", "selcall", 0x3f68, T.enableDisable, 0, "TfrmSelcall.cmbGroupCall"),
  e("subGroupCall", "selcall", 0x3f67, T.enableDisable, 0, "TfrmSelcall.cmbSubGroup"),
  e("selcallHoldTime", "selcall", 0x3f66, T.selcallHold, 1, "TfrmSelcall.cmbHoldTime"),
  e("preamble", "selcall", 0x3f65, T.preamble, 8, "TfrmSelcall.cmbPreamble"),
  e("selcallPowerSave", "selcall", 0x3f64, T.selcallPowerSave, 0, "TfrmSelcall.cmbPowerSave"),
  // Telephone (Telcall)
  e("telCallType", "telephone", 0x3eb3, T.telCallType, 0, "TfrmTelephone.cmbTelCallType"),
];

export function settingById(id: string): Setting {
  const s = SETTINGS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown setting ${id}`);
  return s;
}

export function getSetting(bytes: Uint8Array, id: string): number {
  return readBits(bytes, settingById(id).field);
}

export function setSetting(bytes: Uint8Array, id: string, value: number): void {
  const s = settingById(id);
  validateSetting(s, value);
  writeBits(bytes, s.field, value);
}

export function validateSetting(s: Setting, value: number): void {
  if (!Number.isInteger(value)) throw new RangeError(`${s.id}: not an integer`);
  if (s.kind === "enum" && (value < 0 || value >= s.options.length)) throw new RangeError(`${s.id}: ${value} out of range`);
  if (s.kind === "key" && !KEY_FUNCTIONS.some((k) => k.code === value)) throw new RangeError(`${s.id}: unknown key function ${value}`);
  if (s.kind === "number" && (value < s.min || value > s.max)) throw new RangeError(`${s.id}: ${value} out of range`);
}

export function isValidSetting(s: Setting, value: number): boolean {
  try {
    validateSetting(s, value);
    return true;
  } catch {
    return false;
  }
}

/** Factory-block fields CE42 copies onto the radio's own factory data when writing. */
export const FACTORY_OPTION_IDS = ["cwPitch", "rxRange", "txRange", "keyA", "keyB", "keyC", "dataMode", "rttyShift", "rttyDisplay", "pktOffset", "pktTone"] as const;
