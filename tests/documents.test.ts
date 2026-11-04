import { describe, expect, it } from "vitest";
import { cleanText, countWords, splitSentences } from "@/lib/documents/text";
import { chunkText, detectSections, buildChunks } from "@/lib/documents/chunking";
import { assembleDocument } from "@/lib/documents/assemble";
import { checkUpload } from "@/lib/documents/limits";
import { decodeTextFile, sniffMatches } from "@/lib/documents/plain";
import { sampleBookText, sampleDoc } from "./helpers";

describe("text cleaning", () => {
  it("normalises whitespace, joins hyphenation and drops page-number lines", () => {
    const raw = "Intro\r\n\r\n\r\n\r\nAn exam-\nple   sentence.\n12\nPage 3 of 10\nMore\ttext";
    expect(cleanText(raw)).toBe("Intro\n\nAn example sentence.\nMore text");
  });
  it("counts unicode words", () => {
    expect(countWords("Hello wörld, it’s 2026 — naïve café")).toBe(6);
    expect(countWords("")).toBe(0);
  });
  it("splits sentences but keeps abbreviations together", () => {
    expect(splitSentences("Use e.g. paging. Then stop! Done?")).toEqual(["Use e.g. paging.", "Then stop!", "Done?"]);
  });
});

describe("section detection", () => {
  it("finds chapter headings", () => {
    const sections = detectSections(sampleBookText());
    expect(sections.map((s) => s.title)).toEqual([
      "Chapter 1: Introduction to Operating Systems",
      "Chapter 2: Process Management",
      "Chapter 3: Memory Management",
    ]);
    expect(sections[0].start).toBe(0);
  });
  it("merges repeated running headers and '(continued)' headings", () => {
    const body = "Paging divides memory into frames and pages of equal size which removes external fragmentation entirely. ".repeat(8);
    const text = `Chapter 1: Memory\n\n${body}\n\nChapter 1: Memory (continued)\n\n${body}\n\nChapter 2: Files\n\n${body}`;
    expect(detectSections(text).map((s) => s.title)).toEqual(["Chapter 1: Memory", "Chapter 2: Files"]);
  });
  it("ignores table-of-contents entries", () => {
    const body = "A file system controls how data is stored and retrieved on a storage device and organises directories. ".repeat(8);
    const text = `Contents\nChapter 1 Basics ........ 1\nChapter 2 Files ........ 9\n\nChapter 1 Basics\n\n${body}\n\nChapter 2 Files\n\n${body}`;
    const titles = detectSections(text).map((s) => s.title);
    expect(titles).toEqual(["Chapter 1 Basics", "Chapter 2 Files"]);
  });
  it("keeps headings that end in a number and folds plain contents entries away", () => {
    const body = "Large armies fought across several continents and the conflict reshaped borders for decades afterwards. ".repeat(8);
    const text = `Contents\nUnit 3: World War 1 12\nUnit 4: World War 2 40\n\nUnit 3: World War 1\n\n${body}\n\nUnit 4: World War 2\n\n${body}`;
    const sections = detectSections(text);
    expect(sections.map((s) => s.title)).toEqual(["Unit 3: World War 1", "Unit 4: World War 2"]);
    expect(sections[0].start).toBe(0);
  });
  it("joins a bare 'Chapter 3' line with the following title line", () => {
    const body = "Virtual memory lets processes run when only part of them is loaded into physical memory at a time. ".repeat(8);
    const text = `Chapter 3\nVirtual Memory\n\n${body}\n\nChapter 4\nStorage\n\n${body}`;
    expect(detectSections(text)[0].title).toBe("Chapter 3: Virtual Memory");
  });
  it("falls back to page groups for long PDFs without headings", () => {
    const page = "plain words without any headings at all ".repeat(60);
    const pages = Array.from({ length: 12 }, () => page);
    const doc = assembleDocument({ name: "a.pdf", size: 1, kind: "pdf", hash: "h".repeat(32), pages });
    expect(doc.sections[0].title).toBe("Pages 1–5");
    expect(doc.sections.length).toBe(3);
  });
});

describe("chunking", () => {
  it("respects the target size and never loses words", () => {
    const text = sampleBookText(6);
    const chunks = chunkText(text, 200);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.reduce((n, c) => n + countWords(c), 0)).toBe(countWords(text));
    for (const c of chunks) expect(countWords(c)).toBeLessThan(200 * 1.6);
  });
  it("keeps section labels on chunks", () => {
    const chunks = buildChunks([sampleDoc(4)], 150);
    expect(new Set(chunks.map((c) => c.label)).size).toBe(3);
  });
});

describe("document assembly", () => {
  it("flags scanned PDFs as needing OCR", () => {
    const doc = assembleDocument({ name: "scan.pdf", size: 1, kind: "pdf", hash: "x".repeat(32), pages: ["", "", " "] });
    expect(doc.needsOcr).toBe(true);
    expect(doc.emptyPages).toEqual([1, 2, 3]);
    expect(doc.warnings[0]).toMatch(/OCR/);
  });
  it("reports individual empty pages without hiding them", () => {
    const good = "The kernel manages processes and memory for every program running on the computer. ".repeat(10);
    const doc = assembleDocument({ name: "b.pdf", size: 1, kind: "pdf", hash: "y".repeat(32), pages: [good, "", good, good] });
    expect(doc.needsOcr).toBe(false);
    expect(doc.emptyPages).toEqual([2]);
    expect(doc.warnings[0]).toMatch(/page 2/);
  });
});

describe("upload validation", () => {
  it("accepts supported files and rejects others", () => {
    expect(checkUpload("book.pdf", 100, "application/pdf", 25)).toEqual({ ok: true, kind: "pdf" });
    expect(checkUpload("notes.TXT", 100, "", 25)).toEqual({ ok: true, kind: "txt" });
    expect(checkUpload("x.exe", 100, "", 25).ok).toBe(false);
    expect(checkUpload("x.pdf", 100, "image/png", 25).ok).toBe(false);
    expect(checkUpload("x.pdf", 0, "application/pdf", 25).ok).toBe(false);
    expect(checkUpload("x.pdf", 30 * 1024 * 1024, "application/pdf", 25).ok).toBe(false);
  });
  it("sniffs file signatures", () => {
    expect(sniffMatches("pdf", new TextEncoder().encode("%PDF-1.7 ..."))).toBe(true);
    expect(sniffMatches("pdf", new TextEncoder().encode("<html>"))).toBe(false);
    expect(sniffMatches("docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
  });
  it("rejects binary .txt files and decodes latin-1", () => {
    expect(() => decodeTextFile(new Uint8Array([65, 0, 66]))).toThrow(/binary/);
    expect(decodeTextFile(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
  });
});
