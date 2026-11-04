export type DocKind = "pdf" | "docx" | "txt";

export interface DocSection {
  id: string;
  title: string;
  /** Character offsets into ExtractedDocument.text */
  start: number;
  end: number;
  wordCount: number;
}

export interface ExtractedDocument {
  id: string;
  hash: string;
  name: string;
  size: number;
  kind: DocKind;
  text: string;
  pageCount: number | null;
  /** Raw per-page text, kept so OCR can fill in individual pages later. */
  pages: string[] | null;
  wordCount: number;
  sections: DocSection[];
  /** 1-based page numbers that contained no extractable text. */
  emptyPages: number[];
  needsOcr: boolean;
  ocrApplied: boolean;
  warnings: string[];
}

export interface Chunk {
  id: string;
  docId: string;
  docName: string;
  sectionId: string;
  sectionTitle: string;
  label: string;
  text: string;
  words: number;
  order: number;
}
