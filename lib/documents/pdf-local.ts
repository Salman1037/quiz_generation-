import { AppError } from "@/lib/api/errors";

/**
 * PDF text extraction that runs in the browser (and in Node for tests).
 * Large books are read locally page by page, so the file itself is never uploaded:
 * a 100 MB scanned-image-heavy textbook usually contains only 1–3 MB of text.
 */

interface TextItemLike {
  str?: string;
  hasEOL?: boolean;
}

/** Joins pdf.js text items into lines, the same way the server extractor does. */
export function itemsToText(items: TextItemLike[]): string {
  let out = "";
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    out += item.str;
    if (item.hasEOL) out += "\n";
    else if (item.str && !item.str.endsWith(" ")) out += " ";
  }
  return out.replace(/[ \t]+\n/g, "\n");
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

export async function extractPdfPagesLocally(
  bytes: Uint8Array,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!looksLikePdf(bytes)) {
    throw new AppError("MIME_MISMATCH", "This file doesn’t contain PDF data, even though its name ends in .pdf.", 415);
  }
  const { getDocumentProxy } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdf.js may take ownership of the buffer, so give it a copy.
    pdf = await getDocumentProxy(bytes.slice());
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "PasswordException") {
      throw new AppError("PDF_PASSWORD", "This PDF is password-protected. Remove the password and add it again.", 422);
    }
    throw new AppError("PDF_CORRUPT", "This PDF couldn’t be opened. It may be damaged or incomplete.", 422);
  }
  const total = pdf.numPages;
  const pages: string[] = [];
  onProgress(0, total);
  try {
    for (let i = 1; i <= total; i++) {
      if (signal?.aborted) throw new AppError("NETWORK", "Cancelled.", 499);
      try {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push(itemsToText(content.items as TextItemLike[]));
        page.cleanup();
      } catch (err) {
        if (err instanceof AppError) throw err;
        pages.push(""); // an unreadable page is reported as empty, never dropped
      }
      if (i % 4 === 0 || i === total) {
        onProgress(i, total);
        await yieldToUi();
      }
    }
  } finally {
    await pdf.cleanup().catch(() => undefined);
  }
  return pages;
}
