import type { DocKind } from "@/types/document";

export const ACCEPTED_EXTENSIONS: Record<string, DocKind> = { pdf: "pdf", docx: "docx", txt: "txt" };

export const ACCEPTED_MIME: Record<DocKind, string[]> = {
  pdf: ["application/pdf", "application/x-pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  txt: ["text/plain", "text/markdown"],
};

/** Default per-file limit. Configured with MAX_UPLOAD_MB; the browser receives the server's value from /api/health. */
export const DEFAULT_MAX_UPLOAD_MB = 200;
/** Absolute ceiling for MAX_UPLOAD_MB, to protect server memory during extraction. */
export const MAX_UPLOAD_MB_CEILING = 2048;
/** Default chunk size for resumable uploads (UPLOAD_CHUNK_MB). Must fit any proxy body limit. */
export const DEFAULT_CHUNK_MB = 8;
export const MAX_FILES = 12;


export function kindFromName(name: string): DocKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ACCEPTED_EXTENSIONS[ext] ?? null;
}

export type UploadCheck = { ok: true; kind: DocKind } | { ok: false; code: string; message: string };

/** Validation shared by the browser (early feedback) and the server (enforcement). */
export function checkUpload(name: string, size: number, mime: string, maxMb: number): UploadCheck {
  const kind = kindFromName(name);
  if (!kind) {
    return { ok: false, code: "UNSUPPORTED_TYPE", message: `${name} is not a PDF, DOCX or TXT file.` };
  }
  // Browsers sometimes send an empty or generic type, so only reject a clearly wrong one.
  const generic = !mime || mime === "application/octet-stream" || mime === "binary/octet-stream";
  if (!generic && !ACCEPTED_MIME[kind].includes(mime)) {
    return { ok: false, code: "MIME_MISMATCH", message: `${name} has the type “${mime}”, which doesn’t match a .${kind} file.` };
  }
  if (size === 0) return { ok: false, code: "EMPTY_FILE", message: `${name} is empty.` };
  if (size > maxMb * 1024 * 1024) {
    return { ok: false, code: "FILE_TOO_LARGE", message: `${name} is larger than the ${maxMb} MB limit.` };
  }
  return { ok: true, kind };
}
