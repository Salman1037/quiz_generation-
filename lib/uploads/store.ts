import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { createHash, randomBytes } from "crypto";
import { AppError } from "@/lib/api/errors";
import { checkUpload } from "@/lib/documents/limits";
import type { DocKind } from "@/types/document";

/**
 * Disk-backed store for resumable chunked uploads. Each upload is a directory of
 * numbered part files plus meta.json. Parts are written atomically (temp + rename),
 * so retrying a chunk is always safe, and nothing is assembled until every byte is present.
 */

export interface UploadMeta {
  id: string;
  name: string;
  size: number;
  mime: string;
  kind: DocKind;
  chunkSize: number;
  totalChunks: number;
  createdAt: number;
}

const ID_RE = /^[a-f0-9]{32}$/;
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
export const MAX_ACTIVE_UPLOADS = 24;

export class UploadStore {
  constructor(private root: string) {}

  /** Resolves an upload directory from an id. Rejects anything that isn't a generated id (no path traversal). */
  private dir(id: string): string {
    if (!ID_RE.test(id)) throw new AppError("UPLOAD_NOT_FOUND", "This upload session doesn’t exist.", 404);
    return path.join(this.root, id);
  }

  async create(input: { name: string; size: number; mime: string }, limits: { maxMb: number; chunkBytes: number }): Promise<UploadMeta> {
    const name = input.name.replace(/[\\/\u0000]/g, "_").slice(0, 200);
    const check = checkUpload(name, input.size, input.mime, limits.maxMb);
    if (!check.ok) throw new AppError(check.code as never, check.message, check.code === "FILE_TOO_LARGE" ? 413 : 415);
    await fs.mkdir(this.root, { recursive: true });
    await this.sweep();
    if ((await this.list()).length >= MAX_ACTIVE_UPLOADS) {
      throw new AppError("TOO_MANY_UPLOADS", "The server is handling too many uploads right now. Try again in a few minutes.", 503);
    }
    const id = randomBytes(16).toString("hex");
    const meta: UploadMeta = {
      id,
      name,
      size: input.size,
      mime: input.mime,
      kind: check.kind,
      chunkSize: limits.chunkBytes,
      totalChunks: Math.max(1, Math.ceil(input.size / limits.chunkBytes)),
      createdAt: Date.now(),
    };
    const dir = this.dir(id);
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta));
    return meta;
  }

  async meta(id: string): Promise<UploadMeta> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.dir(id), "meta.json"), "utf8")) as UploadMeta;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError("UPLOAD_NOT_FOUND", "This upload session has expired or doesn’t exist. Start the upload again.", 404);
    }
  }

  expectedChunkSize(meta: UploadMeta, index: number): number {
    return index < meta.totalChunks - 1 ? meta.chunkSize : meta.size - meta.chunkSize * (meta.totalChunks - 1);
  }

  async writeChunk(id: string, index: number, data: Uint8Array): Promise<{ received: number; total: number }> {
    const meta = await this.meta(id);
    if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) {
      throw new AppError("CHUNK_INVALID", `Part ${index} is outside this upload (0–${meta.totalChunks - 1}).`, 400);
    }
    const expected = this.expectedChunkSize(meta, index);
    if (data.byteLength !== expected) {
      throw new AppError("CHUNK_INVALID", `Part ${index} arrived with ${data.byteLength} bytes; expected ${expected}. It will be sent again.`, 400);
    }
    const dir = this.dir(id);
    const tmp = path.join(dir, `${index}.part.${randomBytes(4).toString("hex")}.tmp`);
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, path.join(dir, `${index}.part`));
    return { received: (await this.received(id)).length, total: meta.totalChunks };
  }

  async received(id: string): Promise<number[]> {
    const files = await fs.readdir(this.dir(id)).catch(() => {
      throw new AppError("UPLOAD_NOT_FOUND", "This upload session has expired or doesn’t exist. Start the upload again.", 404);
    });
    return files
      .map((f) => f.match(/^(\d+)\.part$/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
  }

  /**
   * Joins all parts into one buffer, verifying every part exists with the right size and
   * that the total equals the declared size. Never returns a truncated file.
   */
  async assemble(id: string): Promise<{ meta: UploadMeta; bytes: Buffer; hash: string }> {
    const meta = await this.meta(id);
    const have = new Set(await this.received(id));
    const missing = Array.from({ length: meta.totalChunks }, (_, i) => i).filter((i) => !have.has(i));
    if (missing.length) {
      const err = new AppError(
        "UPLOAD_INCOMPLETE",
        `${missing.length} of ${meta.totalChunks} parts haven’t arrived yet (${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}).`,
        409,
      );
      (err as AppError & { missing?: number[] }).missing = missing;
      throw err;
    }
    const bytes = Buffer.allocUnsafe(meta.size);
    const hash = createHash("sha256");
    let offset = 0;
    const dir = this.dir(id);
    for (let i = 0; i < meta.totalChunks; i++) {
      const part = await fs.readFile(path.join(dir, `${i}.part`));
      if (part.byteLength !== this.expectedChunkSize(meta, i)) {
        throw new AppError("UPLOAD_INCOMPLETE", `Part ${i} on the server is the wrong size. Upload the file again.`, 409);
      }
      part.copy(bytes, offset);
      hash.update(part);
      offset += part.byteLength;
    }
    if (offset !== meta.size) {
      throw new AppError("UPLOAD_INCOMPLETE", `Received ${offset} of ${meta.size} bytes. Upload the file again.`, 409);
    }
    return { meta, bytes, hash: hash.digest("hex") };
  }

  async remove(id: string): Promise<void> {
    await fs.rm(this.dir(id), { recursive: true, force: true });
  }

  private async list(): Promise<string[]> {
    return (await fs.readdir(this.root).catch(() => [] as string[])).filter((d) => ID_RE.test(d));
  }

  /** Deletes abandoned uploads so interrupted sessions can't fill the disk. */
  async sweep(now = Date.now()): Promise<number> {
    let removed = 0;
    for (const id of await this.list()) {
      const stat = await fs.stat(path.join(this.root, id)).catch(() => null);
      if (stat && now - stat.mtimeMs > STALE_AFTER_MS) {
        await this.remove(id);
        removed++;
      }
    }
    return removed;
  }
}
