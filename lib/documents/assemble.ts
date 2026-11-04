import type { DocKind, ExtractedDocument } from "@/types/document";
import { detectSections } from "./chunking";
import { cleanText, countWords } from "./text";

export interface AssembleInput {
  name: string;
  size: number;
  kind: DocKind;
  hash: string;
  /** Per-page raw text for PDFs */
  pages?: string[] | null;
  /** Whole text for DOCX / TXT */
  text?: string;
  ocrApplied?: boolean;
}

const MIN_PAGE_WORDS = 5;

/** Turns raw extracted text into a cleaned, sectioned document. Isomorphic. */
export function assembleDocument(input: AssembleInput): ExtractedDocument {
  const id = input.hash.slice(0, 16);
  const warnings: string[] = [];
  let text = "";
  let pageOffsets: number[] | undefined;
  const emptyPages: number[] = [];

  if (input.pages) {
    const cleaned = input.pages.map((p) => cleanText(p));
    const offsets: number[] = [];
    let pos = 0;
    cleaned.forEach((p, i) => {
      offsets.push(pos);
      if (countWords(p) < MIN_PAGE_WORDS) emptyPages.push(i + 1);
      pos += p.length + 2;
    });
    pageOffsets = offsets;
    text = cleaned.join("\n\n");
  } else {
    text = cleanText(input.text ?? "");
  }

  const wordCount = countWords(text);
  const pageCount = input.pages ? input.pages.length : null;
  let needsOcr = false;

  if (input.kind === "pdf" && pageCount) {
    const wordsPerPage = wordCount / pageCount;
    needsOcr = wordsPerPage < 25 || emptyPages.length / pageCount > 0.5;
    if (needsOcr) {
      warnings.push(
        `Only ${wordCount.toLocaleString()} words were readable across ${pageCount} page${pageCount === 1 ? "" : "s"}. This looks like a scanned PDF, so text recognition (OCR) is needed.`,
      );
    } else if (emptyPages.length > 0) {
      const list = emptyPages.slice(0, 8).join(", ") + (emptyPages.length > 8 ? "…" : "");
      warnings.push(
        `${emptyPages.length} page${emptyPages.length === 1 ? "" : "s"} had no readable text (page ${list}). They may be images or scans; you can run OCR on them.`,
      );
    }
  }
  if (wordCount === 0 && input.kind !== "pdf") {
    warnings.push("This document contains no readable text.");
  }

  const sections = detectSections(text, pageOffsets).map((s, i) => ({ id: `${id}-s${i}`, ...s }));

  return {
    id,
    hash: input.hash,
    name: input.name,
    size: input.size,
    kind: input.kind,
    text,
    pageCount,
    pages: input.pages ?? null,
    wordCount,
    sections,
    emptyPages,
    needsOcr,
    ocrApplied: Boolean(input.ocrApplied),
    warnings,
  };
}
