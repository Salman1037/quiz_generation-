import type { ExtractedDocument } from "@/types/document";
import type { ApiErrorBody } from "@/lib/api/errors";
import { ClientError } from "./errors";

/**
 * Resumable chunked upload. The file is read one slice at a time (File.slice), so even a
 * 200 MB book is never loaded into memory at once. Each part is retried with backoff,
 * the session resumes from the parts the server already has, and completion is verified
 * byte-for-byte on the server.
 */

export interface UploadSession {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
}

export interface UploadTransport {
  init(meta: { name: string; size: number; type: string }, signal?: AbortSignal): Promise<UploadSession>;
  status(uploadId: string, signal?: AbortSignal): Promise<{ received: number[]; chunkSize: number; totalChunks: number; size: number }>;
  putChunk(uploadId: string, index: number, body: Blob, onProgress: (loaded: number) => void, signal?: AbortSignal): Promise<void>;
  complete(uploadId: string, signal?: AbortSignal): Promise<ExtractedDocument>;
  abort(uploadId: string): Promise<void>;
}

export interface UploadProgress {
  phase: "uploading" | "retrying" | "processing";
  sentBytes: number;
  totalBytes: number;
  detail: string;
}

export interface UploadOptions {
  transport?: UploadTransport;
  resumeId?: string | null;
  onSession?: (uploadId: string) => void;
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
  concurrency?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Test hook: how to wait for the browser to come back online. */
  waitForOnline?: (signal?: AbortSignal) => Promise<void>;
}

const RETRYABLE = new Set(["NETWORK", "OFFLINE", "TIMEOUT", "UPSTREAM", "INTERNAL", "CHUNK_INVALID", "TOO_MANY_UPLOADS"]);

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new ClientError("ABORTED", "Upload cancelled."));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new ClientError("ABORTED", "Upload cancelled."));
    });
  });
}

function defaultWaitForOnline(signal?: AbortSignal): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const on = () => {
      window.removeEventListener("online", on);
      resolve();
    };
    window.addEventListener("online", on);
    signal?.addEventListener("abort", () => {
      window.removeEventListener("online", on);
      reject(new ClientError("ABORTED", "Upload cancelled."));
    });
  });
}

export async function chunkedUpload(file: Blob & { name: string; type: string }, opts: UploadOptions = {}): Promise<ExtractedDocument> {
  const transport = opts.transport ?? xhrTransport;
  const { signal } = opts;
  const maxAttempts = opts.maxAttempts ?? 6;
  const baseDelay = opts.baseDelayMs ?? 1000;
  const waitOnline = opts.waitForOnline ?? defaultWaitForOnline;
  const total = file.size;

  // Resume an existing session if the server still has it; otherwise start fresh.
  let session: UploadSession | null = null;
  let received: number[] = [];
  if (opts.resumeId) {
    try {
      const st = await transport.status(opts.resumeId, signal);
      if (st.size === total) {
        session = { uploadId: opts.resumeId, chunkSize: st.chunkSize, totalChunks: st.totalChunks };
        received = st.received;
      }
    } catch (err) {
      if (err instanceof ClientError && err.code === "ABORTED") throw err;
      /* expired or unknown: start a new session */
    }
  }
  if (!session) session = await transport.init({ name: file.name, size: total, type: file.type }, signal);
  const s = session;
  opts.onSession?.(s.uploadId);

  const sizeOf = (i: number) => (i < s.totalChunks - 1 ? s.chunkSize : total - s.chunkSize * (s.totalChunks - 1));
  const done = new Set(received);
  let acked = received.reduce((n, i) => n + sizeOf(i), 0);
  const inflight = new Map<number, number>();
  let retryNote: string | null = null;

  const emit = () => {
    const sent = Math.min(total, acked + [...inflight.values()].reduce((a, b) => a + b, 0));
    opts.onProgress?.({
      phase: retryNote ? "retrying" : "uploading",
      sentBytes: sent,
      totalBytes: total,
      detail: retryNote ?? `Uploading ${mb(sent)} of ${mb(total)} MB`,
    });
  };
  emit();

  const sendPart = async (index: number) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const blob = file.slice(index * s.chunkSize, index * s.chunkSize + sizeOf(index));
        await transport.putChunk(
          s.uploadId,
          index,
          blob,
          (loaded) => {
            inflight.set(index, loaded);
            emit();
          },
          signal,
        );
        inflight.delete(index);
        done.add(index);
        acked += sizeOf(index);
        if (retryNote) retryNote = null;
        emit();
        return;
      } catch (err) {
        inflight.delete(index);
        const e = err instanceof ClientError ? err : new ClientError("NETWORK", "The upload was interrupted.");
        if (e.code === "ABORTED") throw e;
        if (!RETRYABLE.has(e.code) || attempt >= maxAttempts) throw e;
        const wait = Math.min(30_000, baseDelay * 2 ** (attempt - 1));
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        retryNote = offline
          ? "Connection lost. The upload will continue when you’re back online."
          : `Connection problem. Retrying part ${index + 1} of ${s.totalChunks} in ${Math.round(wait / 1000)} s (attempt ${attempt + 1} of ${maxAttempts}).`;
        emit();
        await waitOnline(signal);
        await sleep(wait, signal);
      }
    }
  };

  const runQueue = async (indices: number[]) => {
    const queue = [...indices];
    const worker = async () => {
      while (queue.length) await sendPart(queue.shift()!);
    };
    await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, queue.length || 1) }, worker));
  };

  try {
    await runQueue(Array.from({ length: s.totalChunks }, (_, i) => i).filter((i) => !done.has(i)));

    for (let round = 0; ; round++) {
      opts.onProgress?.({ phase: "processing", sentBytes: total, totalBytes: total, detail: "Checking the file and extracting text" });
      try {
        return await transport.complete(s.uploadId, signal);
      } catch (err) {
        if (!(err instanceof ClientError) || err.code !== "UPLOAD_INCOMPLETE" || round >= 1) {
          // Every part was acknowledged but the server can't find them: parts were stored on
          // different instances (serverless hosting). Report it distinctly so a fallback can run.
          if (err instanceof ClientError && err.code === "UPLOAD_INCOMPLETE") {
            throw new ClientError("UPLOAD_STORE_UNAVAILABLE", "The server couldn’t keep the uploaded parts together.", 409);
          }
          throw err;
        }
        const st = await transport.status(s.uploadId, signal);
        const have = new Set(st.received);
        const missing = Array.from({ length: s.totalChunks }, (_, i) => i).filter((i) => !have.has(i));
        missing.forEach((i) => {
          done.delete(i);
          acked -= sizeOf(i);
        });
        await runQueue(missing);
      }
    }
  } catch (err) {
    if (err instanceof ClientError && err.code === "ABORTED") void transport.abort(s.uploadId).catch(() => undefined);
    throw err;
  }
}

/* ---------------- Browser transport (XMLHttpRequest for real upload progress) ---------------- */

function parseError(status: number, body: unknown): ClientError {
  const e = (body as ApiErrorBody | null)?.error;
  if (e) return new ClientError(e.code, e.message, status, e.retryAfterSec);
  if (status === 413) return new ClientError("FILE_TOO_LARGE", "A proxy or hosting limit rejected the upload size.", 413);
  if (status === 404) return new ClientError("UPLOAD_NOT_FOUND", "The upload session wasn’t found.", 404);
  if (status === 408 || status === 504) return new ClientError("TIMEOUT", "The server took too long to respond.", status);
  if (status >= 500) return new ClientError("UPSTREAM", `The server responded with status ${status}.`, status);
  return new ClientError("INTERNAL", `The server responded with status ${status}.`, status);
}

async function jsonRequest<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch {
    if (signal?.aborted) throw new ClientError("ABORTED", "Upload cancelled.");
    throw new ClientError(typeof navigator !== "undefined" && !navigator.onLine ? "OFFLINE" : "NETWORK", "Couldn’t reach the server.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw parseError(res.status, data);
  return data as T;
}

export const xhrTransport: UploadTransport = {
  init: (meta, signal) => jsonRequest<UploadSession>("POST", "/api/uploads", meta, signal),
  status: (id, signal) => jsonRequest("GET", `/api/uploads/${id}`, undefined, signal),
  complete: (id, signal) => jsonRequest<ExtractedDocument>("POST", `/api/uploads/${id}/complete`, undefined, signal),
  abort: async (id) => {
    await fetch(`/api/uploads/${id}`, { method: "DELETE", keepalive: true }).catch(() => undefined);
  },
  putChunk: (id, index, body, onProgress, signal) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `/api/uploads/${id}/chunks/${index}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.timeout = 180_000;
      xhr.responseType = "json";
      xhr.upload.onprogress = (e) => onProgress(e.loaded);
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(parseError(xhr.status, xhr.response)));
      xhr.onerror = () => reject(new ClientError(navigator.onLine ? "NETWORK" : "OFFLINE", "The connection was interrupted."));
      xhr.ontimeout = () => reject(new ClientError("TIMEOUT", "This part took too long to upload."));
      xhr.onabort = () => reject(new ClientError("ABORTED", "Upload cancelled."));
      signal?.addEventListener("abort", () => xhr.abort());
      xhr.send(body);
    }),
};

/* ---------------- Resume after a page refresh ---------------- */

const RESUME_KEY = "quizforge:uploads:v1";
export function fileFingerprint(f: { name: string; size: number; lastModified?: number }) {
  return `${f.name}|${f.size}|${f.lastModified ?? 0}`;
}
export function rememberUpload(fp: string, uploadId: string | null) {
  try {
    const map = JSON.parse(localStorage.getItem(RESUME_KEY) || "{}") as Record<string, { id: string; at: number }>;
    if (uploadId) map[fp] = { id: uploadId, at: Date.now() };
    else delete map[fp];
    for (const [k, v] of Object.entries(map)) if (Date.now() - v.at > 2 * 3600_000) delete map[k];
    localStorage.setItem(RESUME_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable: resume just won't survive a refresh */
  }
}
export function recallUpload(fp: string): string | null {
  try {
    const map = JSON.parse(localStorage.getItem(RESUME_KEY) || "{}") as Record<string, { id: string; at: number }>;
    const hit = map[fp];
    return hit && Date.now() - hit.at < 2 * 3600_000 ? hit.id : null;
  } catch {
    return null;
  }
}
