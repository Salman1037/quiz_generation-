/**
 * Large-file pipeline: a ~100 MB, 300-page PDF goes through the chunked upload API with
 * injected faults, is verified byte-for-byte, extracted completely, and used for generation.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { ExtractedDocument } from "@/types/document";
import { planGeneration } from "@/lib/ai/planning";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const PAGES = 300;

const SYL = ["var", "kel", "mor", "dan", "sil", "tor", "bra", "quen", "lis", "zab", "orn", "pel", "fen", "gor"];
/** Unique invented term per index, so every line states a distinct fact. */
const term = (n: number) => SYL[n % 14] + SYL[Math.floor(n / 14) % 14] + SYL[Math.floor(n / 196) % 14] + SYL[Math.floor(n / 2744) % 14] + "ometry";

async function buildLargePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let p = 1; p <= PAGES; p++) {
    const page = pdf.addPage([595, 842]);
    const unit = Math.ceil(p / 30);
    let y = 800;
    const line = (t: string, size = 11) => {
      page.drawText(t, { x: 50, y, size, font });
      y -= size + 5;
    };
    if ((p - 1) % 30 === 0) line(`Unit ${unit}: Quadratic Equations Part ${unit}`, 15);
    for (let l = 0; l < 14; l++) {
      line(`Example ${p}.${l}: the method called ${term(p * 14 + l)} solves quadratic equation ${p * 100 + l} by completing the square.`);
    }
    if (p === PAGES) line("END-OF-BOOK-MARKER final page reached.");
  }
  // ~100 MB of incompressible embedded data, like the scanned figures in a real textbook.
  await pdf.attach(randomBytes(100 * 1024 * 1024), "figures.bin", { mimeType: "application/octet-stream" });
  return pdf.save({ useObjectStreams: true });
}

async function json<T>(method: string, url: string, body?: unknown) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}
const putChunk = (id: string, index: number, data: Uint8Array) =>
  fetch(`${BASE}/api/uploads/${id}/chunks/${index}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: data as BodyInit });

let pdfBytes: Uint8Array;
let doc: ExtractedDocument;

describe("large PDF upload (~100 MB)", () => {
  beforeAll(async () => {
    pdfBytes = await buildLargePdf();
  }, 120_000);

  it("uploads in parts with faults, verifies every byte and extracts the whole book", async () => {
    const size = pdfBytes.byteLength;
    expect(size).toBeGreaterThan(100 * 1024 * 1024);
    const init = await json<{ uploadId: string; chunkSize: number; totalChunks: number }>("POST", "/api/uploads", {
      name: "10th Math New Book.pdf",
      size,
      type: "application/pdf",
    });
    expect(init.status).toBe(201);
    const { uploadId, chunkSize, totalChunks } = init.body;
    expect(totalChunks).toBe(Math.ceil(size / chunkSize));
    const part = (i: number) => pdfBytes.subarray(i * chunkSize, Math.min(size, (i + 1) * chunkSize));

    // Fault 1: a truncated part (as from a dropped connection) is rejected, not stored.
    const truncated = await putChunk(uploadId, 0, part(0).subarray(0, 1000));
    expect(truncated.status).toBe(400);
    expect((await truncated.json()).error.code).toBe("CHUNK_INVALID");

    // Upload all parts except the last; send one part twice (a retry after a lost response).
    for (let i = 0; i < totalChunks - 1; i++) expect((await putChunk(uploadId, i, part(i))).status).toBe(200);
    expect((await putChunk(uploadId, 2, part(2))).status).toBe(200);

    // Fault 2: completing early reports exactly which part is missing; nothing is truncated.
    const early = await json<{ error: { code: string }; missing: number[] }>("POST", `/api/uploads/${uploadId}/complete`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("UPLOAD_INCOMPLETE");
    expect(early.body.missing).toEqual([totalChunks - 1]);

    // Resume: the status endpoint lists what the server already has.
    const status = await json<{ received: number[] }>("GET", `/api/uploads/${uploadId}`);
    expect(status.body.received).toHaveLength(totalChunks - 1);

    expect((await putChunk(uploadId, totalChunks - 1, part(totalChunks - 1))).status).toBe(200);
    const t = Date.now();
    const done = await json<ExtractedDocument>("POST", `/api/uploads/${uploadId}/complete`);
    console.log(`complete + extraction of ${(size / 1048576).toFixed(1)} MB took ${((Date.now() - t) / 1000).toFixed(1)} s`);
    expect(done.status).toBe(200);
    doc = done.body;

    // The server received every byte: same SHA-256 as the original file.
    expect(doc.hash).toBe(createHash("sha256").update(pdfBytes).digest("hex"));
    expect(doc.size).toBe(size);
    // And processed every page, through to the final one.
    expect(doc.pageCount).toBe(PAGES);
    expect(doc.emptyPages).toEqual([]);
    expect(doc.text).toContain("END-OF-BOOK-MARKER");
    expect(doc.sections.map((s) => s.title)).toEqual(Array.from({ length: 10 }, (_, i) => `Unit ${i + 1}: Quadratic Equations Part ${i + 1}`));
    expect(doc.wordCount).toBeGreaterThan(PAGES * 14 * 14);

    // The session is cleaned up after success.
    expect((await json("GET", `/api/uploads/${uploadId}`)).status).toBe(404);
  }, 240_000);

  it("rejects oversized parts and unknown sessions", async () => {
    const init = await json<{ uploadId: string; chunkSize: number }>("POST", "/api/uploads", { name: "x.pdf", size: 1000, type: "application/pdf" });
    const tooBig = await putChunk(init.body.uploadId, 0, new Uint8Array(init.body.chunkSize + 10_000));
    expect(tooBig.status).toBe(413);
    expect((await putChunk("0".repeat(32), 0, new Uint8Array(10))).status).toBe(404);
    expect((await putChunk("../../etc", 0, new Uint8Array(10))).status).toBe(404);
    expect((await fetch(`${BASE}/api/uploads/${init.body.uploadId}`, { method: "DELETE" })).status).toBe(204);
  });

  it("generates questions from the large book in small batches (never the raw PDF)", async () => {
    const plan = planGeneration([doc], {
      questionCount: 20, difficulty: "mixed", sourceMode: "all", documentId: null, sectionIds: [], topic: "",
      shuffleQuestions: true, shuffleOptions: true, includeExplanations: true, revealMode: "after",
      timerEnabled: false, durationMinutes: 10, marksPerQuestion: 1, negativeMarking: 0, passPercentage: null,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // Each AI request carries a few thousand words of text, not the 100 MB file.
    for (const b of plan.batches) expect(JSON.stringify(b.chunks).length).toBeLessThan(60_000);
    const sealed: string[] = [];
    for (const b of plan.batches) {
      const r = await json<{ sealed: string; questions: unknown[] }>("POST", "/api/generate", { batchId: b.id, chunks: b.chunks, count: b.count, difficulty: b.difficulty, avoid: [] });
      expect(r.status).toBe(200);
      sealed.push(r.body.sealed);
    }
    const fin = await json<{ paper: { totalQuestions: number; questions: { source: string }[] } }>("POST", "/api/papers", {
      title: "Large book", batches: sealed, requestedCount: 20, shuffleQuestions: true, shuffleOptions: true,
      includeExplanations: true, revealMode: "after", scoring: { marksPerQuestion: 1, negativeMarking: 0, passPercentage: null },
    });
    expect(fin.status).toBe(200);
    expect(fin.body.paper.totalQuestions).toBe(20);
    expect(new Set(fin.body.paper.questions.map((q) => q.source)).size).toBeGreaterThanOrEqual(5);
  }, 120_000);
});
