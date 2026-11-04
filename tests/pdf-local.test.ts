import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { extractPdfPagesLocally, itemsToText } from "@/lib/documents/pdf-local";
import { assembleDocument } from "@/lib/documents/assemble";
import { extractPdfPages } from "@/lib/documents/pdf";

const fx = (n: string) => new Uint8Array(readFileSync(path.join(__dirname, "fixtures", n)));

describe("in-browser PDF extraction", () => {
  it("joins text items into lines", () => {
    expect(itemsToText([{ str: "Chapter 1:" }, { str: "Sets", hasEOL: true }, { str: "A set is", hasEOL: false }, { str: "a collection." }])).toBe(
      "Chapter 1: Sets\nA set is a collection. ",
    );
  });
  it("extracts every page with progress and finds chapters", async () => {
    const progress: number[] = [];
    const pages = await extractPdfPagesLocally(fx("os_book.pdf"), (d) => progress.push(d));
    expect(pages).toHaveLength(8);
    expect(progress.at(-1)).toBe(8);
    const doc = assembleDocument({ name: "os.pdf", size: 1, kind: "pdf", hash: "a".repeat(32), pages });
    expect(doc.sections.map((s) => s.title)[3]).toBe("Chapter 4: File Systems");
  });
  it("reports password-protected, corrupt and fake PDFs", async () => {
    await expect(extractPdfPagesLocally(fx("locked.pdf"), () => {})).rejects.toMatchObject({ code: "PDF_PASSWORD" });
    await expect(extractPdfPagesLocally(fx("corrupt.pdf"), () => {})).rejects.toMatchObject({ code: "PDF_CORRUPT" });
    await expect(extractPdfPagesLocally(new TextEncoder().encode("<html>"), () => {})).rejects.toMatchObject({ code: "MIME_MISMATCH" });
  });
  it("flags scanned PDFs", async () => {
    const pages = await extractPdfPagesLocally(fx("scanned.pdf"), () => {});
    expect(assembleDocument({ name: "s.pdf", size: 1, kind: "pdf", hash: "b".repeat(32), pages }).needsOcr).toBe(true);
  });
  it("stops when cancelled", async () => {
    const c = new AbortController();
    c.abort();
    await expect(extractPdfPagesLocally(fx("os_book.pdf"), () => {}, c.signal)).rejects.toMatchObject({ status: 499 });
  });
});

describe("server PDF extraction", () => {
  it("accepts Node Buffers (as produced by chunk assembly)", async () => {
    const pages = await extractPdfPages(readFileSync(path.join(__dirname, "fixtures", "os_book.pdf")));
    expect(pages).toHaveLength(8);
  });
});
