import { AppError } from "@/lib/api/errors";

/** Decodes a TXT upload as UTF-8, falling back to Windows-1252. Rejects binary content. */
export function decodeTextFile(bytes: Uint8Array): string {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  let nul = 0;
  for (const b of sample) if (b === 0) nul++;
  if (nul > 0) {
    throw new AppError("TXT_BINARY", "This .txt file contains binary data, not plain text.", 422);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export function sniffMatches(kind: "pdf" | "docx" | "txt", bytes: Uint8Array): boolean {
  if (kind === "pdf") {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
    return head.includes("%PDF-");
  }
  if (kind === "docx") {
    return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  }
  return true;
}
