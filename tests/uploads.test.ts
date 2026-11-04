import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, utimesSync } from "fs";
import os from "os";
import path from "path";
import { createHash, randomBytes } from "crypto";
import { UploadStore } from "@/lib/uploads/store";
import { chunkedUpload, type UploadTransport } from "@/lib/client/chunked-upload";
import { ClientError } from "@/lib/client/errors";
import { AppError } from "@/lib/api/errors";
import type { ExtractedDocument } from "@/types/document";

let root: string;
let store: UploadStore;
const limits = { maxMb: 200, chunkBytes: 1024 * 1024 };

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "qf-test-"));
  store = new UploadStore(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("upload store", () => {
  it("enforces the configured limit before any bytes are sent", async () => {
    await expect(store.create({ name: "big.pdf", size: 201 * 1024 * 1024, mime: "application/pdf" }, limits)).rejects.toMatchObject({ code: "FILE_TOO_LARGE", status: 413 });
    await expect(store.create({ name: "x.exe", size: 10, mime: "" }, limits)).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    const ok = await store.create({ name: "book.pdf", size: 200 * 1024 * 1024, mime: "application/pdf" }, limits);
    expect(ok.totalChunks).toBe(200);
  });

  it("stores parts idempotently and reassembles the exact bytes", async () => {
    const data = randomBytes(3.5 * 1024 * 1024);
    const meta = await store.create({ name: "a.pdf", size: data.length, mime: "application/pdf" }, limits);
    expect(meta.totalChunks).toBe(4);
    const part = (i: number) => data.subarray(i * limits.chunkBytes, Math.min(data.length, (i + 1) * limits.chunkBytes));
    for (const i of [3, 0, 2, 2, 1]) await store.writeChunk(meta.id, i, part(i)); // out of order + a duplicate retry
    expect(await store.received(meta.id)).toEqual([0, 1, 2, 3]);
    const { bytes, hash } = await store.assemble(meta.id);
    expect(bytes.equals(data)).toBe(true);
    expect(hash).toBe(createHash("sha256").update(data).digest("hex"));
  });

  it("refuses to assemble when parts are missing, and rejects wrong-sized parts", async () => {
    const data = randomBytes(2.5 * 1024 * 1024);
    const meta = await store.create({ name: "a.pdf", size: data.length, mime: "" }, limits);
    await store.writeChunk(meta.id, 0, data.subarray(0, limits.chunkBytes));
    await expect(store.writeChunk(meta.id, 1, data.subarray(0, 100))).rejects.toMatchObject({ code: "CHUNK_INVALID" });
    await expect(store.writeChunk(meta.id, 3, data.subarray(0, 100))).rejects.toMatchObject({ code: "CHUNK_INVALID" });
    const err = (await store.assemble(meta.id).catch((e) => e)) as AppError & { missing: number[] };
    expect(err.code).toBe("UPLOAD_INCOMPLETE");
    expect(err.missing).toEqual([1, 2]);
  });

  it("rejects ids that could escape the upload directory", async () => {
    for (const id of ["../etc", "..%2F..", "abc", "/tmp/x", "A".repeat(32)]) {
      await expect(store.meta(id)).rejects.toMatchObject({ code: "UPLOAD_NOT_FOUND" });
    }
  });

  it("sweeps abandoned uploads", async () => {
    const meta = await store.create({ name: "a.txt", size: 10, mime: "text/plain" }, limits);
    const old = Date.now() / 1000 - 3 * 3600;
    utimesSync(path.join(root, meta.id), old, old);
    expect(await store.sweep()).toBe(1);
    await expect(store.meta(meta.id)).rejects.toMatchObject({ code: "UPLOAD_NOT_FOUND" });
  });
});

/** In-memory transport backed by the real UploadStore, with fault injection. */
function makeTransport(opts: { failPuts?: Record<number, number>; loseChunksOnce?: number[]; alwaysLose?: boolean } = {}) {
  const failures = { ...(opts.failPuts ?? {}) };
  const calls = { put: [] as number[], complete: 0, abort: 0, init: 0 };
  let lost = false;
  const t: UploadTransport = {
    async init(meta) {
      calls.init++;
      const m = await store.create({ name: meta.name, size: meta.size, mime: meta.type }, limits);
      return { uploadId: m.id, chunkSize: m.chunkSize, totalChunks: m.totalChunks };
    },
    async status(id) {
      const m = await store.meta(id).catch(() => {
        throw new ClientError("UPLOAD_NOT_FOUND", "gone", 404);
      });
      return { received: await store.received(id), chunkSize: m.chunkSize, totalChunks: m.totalChunks, size: m.size };
    },
    async putChunk(id, index, body, onProgress) {
      calls.put.push(index);
      if (failures[index]) {
        failures[index]--;
        throw new ClientError("NETWORK", "dropped");
      }
      const bytes = new Uint8Array(await body.arrayBuffer());
      onProgress(bytes.length / 2);
      await store.writeChunk(id, index, bytes);
      onProgress(bytes.length);
      if (opts.alwaysLose || (!lost && opts.loseChunksOnce?.includes(index))) {
        // Simulate a part that was acknowledged but not persisted (e.g. another server instance).
        const fs = await import("fs/promises");
        await fs.rm(path.join(root, id, `${index}.part`));
      }
    },
    async complete(id) {
      calls.complete++;
      try {
        const { meta, hash } = await store.assemble(id);
        lost = true;
        return { id: hash.slice(0, 16), hash, name: meta.name, size: meta.size } as ExtractedDocument;
      } catch (e) {
        lost = true;
        if (e instanceof AppError) throw new ClientError(e.code, e.message, e.status);
        throw e;
      }
    },
    async abort(id) {
      calls.abort++;
      await store.remove(id);
    },
  };
  return { t, calls };
}

const fileOf = (bytes: Uint8Array, name = "book.pdf") => new File([bytes as BlobPart], name, { type: "application/pdf" });
const fast = { baseDelayMs: 1, waitForOnline: async () => {} };

describe("chunked uploader", () => {
  it("uploads every byte with monotonic progress", async () => {
    const data = randomBytes(5 * 1024 * 1024 + 123);
    const { t, calls } = makeTransport();
    const progress: number[] = [];
    const doc = await chunkedUpload(fileOf(data), { transport: t, ...fast, onProgress: (p) => p.phase === "uploading" && progress.push(p.sentBytes) });
    expect(doc.hash).toBe(createHash("sha256").update(data).digest("hex"));
    expect(calls.put.sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(progress.at(-1)).toBe(data.length);
  });

  it("retries dropped parts with backoff and still completes", async () => {
    const data = randomBytes(3 * 1024 * 1024);
    const { t, calls } = makeTransport({ failPuts: { 1: 2, 2: 1 } });
    const notes: string[] = [];
    const doc = await chunkedUpload(fileOf(data), { transport: t, ...fast, onProgress: (p) => p.phase === "retrying" && notes.push(p.detail) });
    expect(doc.size).toBe(data.length);
    expect(calls.put.filter((i) => i === 1)).toHaveLength(3);
    expect(notes[0]).toMatch(/Retrying part/);
  });

  it("gives up after the maximum attempts with a clear error", async () => {
    const { t } = makeTransport({ failPuts: { 0: 99 } });
    await expect(chunkedUpload(fileOf(randomBytes(1000)), { transport: t, ...fast, maxAttempts: 3 })).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("resumes an interrupted session without re-sending received parts", async () => {
    const data = randomBytes(4 * 1024 * 1024);
    const first = makeTransport({ failPuts: { 3: 99 } });
    let session = "";
    await expect(
      chunkedUpload(fileOf(data), { transport: first.t, ...fast, maxAttempts: 1, concurrency: 1, onSession: (id) => (session = id) }),
    ).rejects.toMatchObject({ code: "NETWORK" });
    const second = makeTransport();
    const doc = await chunkedUpload(fileOf(data), { transport: second.t, ...fast, resumeId: session });
    expect(second.calls.init).toBe(0);
    expect(second.calls.put).toEqual([3]);
    expect(doc.hash).toBe(createHash("sha256").update(data).digest("hex"));
  });

  it("re-sends parts the server reports missing at completion", async () => {
    const data = randomBytes(3 * 1024 * 1024);
    const { t, calls } = makeTransport({ loseChunksOnce: [1] });
    const doc = await chunkedUpload(fileOf(data), { transport: t, ...fast });
    expect(calls.complete).toBe(2);
    expect(doc.size).toBe(data.length);
  });

  it("reports a host that can't keep parts together, so a fallback can run", async () => {
    const { t } = makeTransport({ alwaysLose: true });
    await expect(chunkedUpload(fileOf(randomBytes(2 * 1024 * 1024)), { transport: t, ...fast })).rejects.toMatchObject({ code: "UPLOAD_STORE_UNAVAILABLE" });
  });

  it("cancels cleanly and deletes the server session", async () => {
    const ctrl = new AbortController();
    const { t, calls } = makeTransport();
    const slow: UploadTransport = {
      ...t,
      putChunk: async (...args) => {
        ctrl.abort();
        throw new ClientError("ABORTED", "cancelled");
        return t.putChunk(...args);
      },
    };
    await expect(chunkedUpload(fileOf(randomBytes(2 * 1024 * 1024)), { transport: slow, ...fast, signal: ctrl.signal })).rejects.toMatchObject({ code: "ABORTED" });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.abort).toBe(1);
  });
});
