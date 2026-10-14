import { IMAGE_SIZE } from "./layout.js";
import { isModelIdValid, sanitizeImage, type SanitizeIssue } from "./image.js";

export class C42FormatError extends Error {
  override name = "C42FormatError";
}

export interface ParsedC42 {
  bytes: Uint8Array;
  issues: SanitizeIssue[];
}

/**
 * Open a CE42 data file. CE42 reads exactly 0x4607 bytes and rejects anything else with
 * "The file cannot be opened. The file format is not correct."
 */
export function parseC42(data: Uint8Array | ArrayBuffer): ParsedC42 {
  const src = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (src.length !== IMAGE_SIZE) throw new C42FormatError(`expected ${IMAGE_SIZE} bytes, got ${src.length}`);
  const bytes = src.slice();
  if (!isModelIdValid(bytes)) throw new C42FormatError("model id is not ac027h (VX-1210)");
  const issues = sanitizeImage(bytes);
  return { bytes, issues };
}

export function serializeC42(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== IMAGE_SIZE) throw new C42FormatError(`image must be ${IMAGE_SIZE} bytes`);
  return bytes.slice();
}
