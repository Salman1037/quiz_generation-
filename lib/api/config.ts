import "server-only";
import os from "os";
import path from "path";
import { DEFAULT_CHUNK_MB, DEFAULT_MAX_UPLOAD_MB, MAX_UPLOAD_MB_CEILING } from "@/lib/documents/limits";

/** Single source of truth for the upload limit. The browser receives it from /api/health. */
export function maxUploadMb(): number {
  const v = Number(process.env.MAX_UPLOAD_MB);
  return Number.isFinite(v) && v > 0 ? Math.min(v, MAX_UPLOAD_MB_CEILING) : DEFAULT_MAX_UPLOAD_MB;
}

export function uploadChunkBytes(): number {
  const v = Number(process.env.UPLOAD_CHUNK_MB);
  const mb = Number.isFinite(v) && v > 0 ? Math.min(Math.max(v, 1), 64) : DEFAULT_CHUNK_MB;
  return Math.round(mb * 1024 * 1024);
}

export function uploadTmpDir(): string {
  return process.env.UPLOAD_TMP_DIR?.trim() || path.join(os.tmpdir(), "quizforge-uploads");
}
