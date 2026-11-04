"use client";
import { ClientError } from "./errors";
import { postForm } from "./api";

export const OCR_PAGES_PER_REQUEST = 5;
/** Stay well under Gemini's inline request size and the /api/ocr limit. */
const MAX_SLICE_BYTES = 12 * 1024 * 1024;

/**
 * Runs OCR on a page range of a scanned PDF. The browser splits the file into small
 * PDFs (pdf-lib, loaded on demand) so each request stays small, and Gemini reads them.
 */
export async function runOcr(
  file: File,
  firstPage: number,
  lastPage: number,
  opts: { rpm: number; signal: AbortSignal; onProgress: (donePages: number, totalPages: number, waitingUntil: number | null) => void },
): Promise<Map<number, string>> {
  const { PDFDocument } = await import("pdf-lib");
  let source;
  try {
    source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  } catch {
    throw new ClientError("PDF_CORRUPT", "This PDF couldn’t be opened for OCR.");
  }
  const total = source.getPageCount();
  const from = Math.max(1, firstPage);
  const to = Math.min(total, lastPage);
  const result = new Map<number, string>();
  const interval = Math.ceil(60_000 / Math.max(1, opts.rpm));
  let lastStart = 0;
  let done = 0;
  opts.onProgress(0, to - from + 1, null);

  for (let start = from; start <= to; ) {
    // Image-heavy scans can be several MB per page: shrink the slice until it fits.
    let end = Math.min(to, start + OCR_PAGES_PER_REQUEST - 1);
    let bytes: Uint8Array;
    for (;;) {
      const slice = await PDFDocument.create();
      const pages = await slice.copyPages(
        source,
        Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i),
      );
      pages.forEach((p) => slice.addPage(p));
      bytes = await slice.save();
      if (bytes.byteLength <= MAX_SLICE_BYTES || end === start) break;
      end = start + Math.max(0, Math.floor((end - start) / 2));
    }
    if (bytes.byteLength > MAX_SLICE_BYTES) {
      throw new ClientError("FILE_TOO_LARGE", `Page ${start} alone is larger than ${MAX_SLICE_BYTES / 1024 / 1024} MB, too large for OCR.`);
    }
    let rateRetries = 0;
    for (;;) {
      const gap = lastStart + interval - Date.now();
      if (gap > 0) await sleep(gap, opts.signal);
      lastStart = Date.now();
      const form = new FormData();
      form.append("file", new Blob([bytes as BlobPart], { type: "application/pdf" }), "pages.pdf");
      form.append("pageCount", String(end - start + 1));
      try {
        const res = await postForm<{ pages: string[] }>("/api/ocr", form, opts.signal);
        res.pages.forEach((text, i) => result.set(start + i, text));
        break;
      } catch (err) {
        if (err instanceof ClientError && err.code === "RATE_LIMIT" && rateRetries < 5) {
          rateRetries++;
          const ms = (err.retryAfterSec ?? 20) * 1000;
          opts.onProgress(done, to - from + 1, Date.now() + ms);
          await sleep(ms, opts.signal);
          continue;
        }
        throw err;
      }
    }
    done += end - start + 1;
    opts.onProgress(done, to - from + 1, null);
    start = end + 1;
  }
  return result;
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new ClientError("ABORTED", "OCR cancelled."));
    });
  });
}
