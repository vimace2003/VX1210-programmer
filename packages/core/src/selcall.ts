/**
 * Digit strings (Selcall IDs, Kill ID, telephone numbers). One byte per digit holding
 * 0..9; any other value is shown as a space. When writing, characters past the end of
 * the string are stored as 0x20 and non-digits as 0 (FUN_00494094 uses StrToIntDef(c, 0)).
 */
export const DIGIT_FIELDS = {
  selfId: { offset: 0x3e87, length: 4 },
  killId: { offset: 0x3f55, length: 8 },
} as const;

export const TX_ID_COUNT = 10;
export const TX_ID_BASE = 0x3e8b;
export const TX_ID_LENGTH = 4;

export const TEL_COUNT = 10;
export const TEL_BASE = 0x3eb4;
export const TEL_LENGTH = 16;
/** CODAN12 numbers are limited to 12 digits, BARRETT/CODAN16 to 16 (help: Telephone Numbers). */
export const TEL_MAX_DIGITS = [16, 12, 16] as const;

export function readDigits(bytes: Uint8Array, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) {
    const v = bytes[offset + i] ?? 0;
    s += v <= 9 ? String(v) : " ";
  }
  return s;
}

export function writeDigits(bytes: Uint8Array, offset: number, length: number, value: string): void {
  if (readDigits(bytes, offset, length) === value.padEnd(length, " ").slice(0, length)) return; // unchanged
  for (let i = 0; i < length; i++) {
    const c = value[i];
    bytes[offset + i] = c === undefined ? 0x20 : /[0-9]/.test(c) ? Number(c) : 0;
  }
}

export function txIdOffset(index: number): number {
  if (index < 0 || index >= TX_ID_COUNT) throw new RangeError(`TX ID ${index}`);
  return TX_ID_BASE + index * TX_ID_LENGTH;
}

export function telOffset(index: number): number {
  if (index < 0 || index >= TEL_COUNT) throw new RangeError(`telephone ${index}`);
  return TEL_BASE + index * TEL_LENGTH;
}

export interface SelcallData {
  selfId: string;
  killId: string;
  txIds: string[];
  telephones: string[];
}

export function readSelcall(bytes: Uint8Array): SelcallData {
  return {
    selfId: readDigits(bytes, DIGIT_FIELDS.selfId.offset, DIGIT_FIELDS.selfId.length),
    killId: readDigits(bytes, DIGIT_FIELDS.killId.offset, DIGIT_FIELDS.killId.length),
    txIds: Array.from({ length: TX_ID_COUNT }, (_, i) => readDigits(bytes, txIdOffset(i), TX_ID_LENGTH)),
    telephones: Array.from({ length: TEL_COUNT }, (_, i) => readDigits(bytes, telOffset(i), TEL_LENGTH).trimEnd()),
  };
}

export function writeSelcall(bytes: Uint8Array, data: SelcallData): void {
  writeDigits(bytes, DIGIT_FIELDS.selfId.offset, DIGIT_FIELDS.selfId.length, data.selfId);
  writeDigits(bytes, DIGIT_FIELDS.killId.offset, DIGIT_FIELDS.killId.length, data.killId);
  data.txIds.forEach((v, i) => writeDigits(bytes, txIdOffset(i), TX_ID_LENGTH, v));
  data.telephones.forEach((v, i) => {
    const current = readDigits(bytes, telOffset(i), TEL_LENGTH);
    if (current.trimEnd() !== v.trimEnd()) writeDigits(bytes, telOffset(i), TEL_LENGTH, v);
  });
}

/** CE42 requires a complete 4-digit Self ID (message "Input the 4-digit Selcall Self ID"). */
export function isValidSelfId(id: string): boolean {
  return /^[0-9]{4}$/.test(id);
}
