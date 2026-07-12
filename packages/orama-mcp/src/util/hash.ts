import { createHash } from "node:crypto";

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Content hash of raw bytes — used to key on-disk caches of extracted PDF text so
 * a file is only re-parsed (and, with OCR, re-recognized) when its bytes change. */
export function hashBuffer(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
