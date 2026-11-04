import type { Chunk, ExtractedDocument } from "@/types/document";
import { countWords, splitSentences } from "./text";

export interface DetectedSection {
  title: string;
  start: number;
  end: number;
  wordCount: number;
}

interface Line {
  text: string;
  start: number;
}

const NUMBER_WORDS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
const KEYWORD_RE = new RegExp(
  `^(chapter|unit|part|section|lesson|module|book)\\s+(\\d{1,3}|[ivxlcdm]{1,7}|${NUMBER_WORDS})\\b(?:\\s*[.:\\-–—)]\\s*|\\s+)?(.{0,110})$`,
  "i",
);
const MD_RE = /^#{1,2}\s+(.{2,110})$/;
const NUMBERED_RE = /^(\d{1,2})\.?\s+([A-Z][^\n]{2,80})$/;
const CAPS_RE = /^[A-Z][A-Z0-9 ,:&'’()\-–]{3,70}$/;
const DOT_LEADER = /\.{4,}|…{2,}|(\s\.){3,}/;
const TRAILING_PAGE = /\s\d{1,4}$/;

const MIN_SECTION_WORDS = 60;

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let pos = 0;
  for (const raw of text.split("\n")) {
    lines.push({ text: raw.trim(), start: pos });
    pos += raw.length + 1;
  }
  return lines;
}

function normTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\((?:continued|cont\.?|contd\.?)\)/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function looksLikeSentence(s: string): boolean {
  return /[.;,]$/.test(s) || s.split(/\s+/).length > 14;
}

type Candidate = { index: number; title: string };

function nextNonEmpty(lines: Line[], i: number): string | null {
  for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
    if (lines[j].text) return lines[j].text;
  }
  return null;
}

function findCandidates(lines: Line[]): Candidate[] {
  const freq = new Map<string, number>();
  for (const l of lines) if (l.text) freq.set(l.text, (freq.get(l.text) ?? 0) + 1);

  const keyword: Candidate[] = [];
  const md: Candidate[] = [];
  const numbered: Candidate[] = [];
  const caps: Candidate[] = [];

  lines.forEach((line, index) => {
    const t = line.text;
    if (!t || t.length > 120 || DOT_LEADER.test(t)) return;
    const k = t.match(KEYWORD_RE);
    if (k) {
      const rest = (k[3] ?? "").trim();
      // A trailing number may be a page number (table of contents) or part of a real title
      // ("World War 2"). Contents entries are tiny sections and get folded away below.
      if (rest && looksLikeSentence(rest)) return;
      let title = t;
      if (!rest) {
        const next = nextNonEmpty(lines, index);
        if (next && next.length < 80 && !looksLikeSentence(next) && !KEYWORD_RE.test(next)) {
          title = `${t}: ${next}`;
        }
      }
      keyword.push({ index, title });
      return;
    }
    const m = t.match(MD_RE);
    if (m) {
      md.push({ index, title: m[1].trim() });
      return;
    }
    const n = t.match(NUMBERED_RE);
    if (n && !looksLikeSentence(t) && !TRAILING_PAGE.test(t) && n[2].split(/\s+/).length >= 2) {
      numbered.push({ index, title: t });
      return;
    }
    if (
      CAPS_RE.test(t) &&
      t.split(/\s+/).length >= 2 &&
      (t.match(/[A-Z]/g) ?? []).length >= 4 &&
      (freq.get(t) ?? 0) < 3
    ) {
      caps.push({ index, title: t });
    }
  });

  for (const tier of [keyword, md, numbered, caps]) {
    if (tier.length >= 2) return tier;
  }
  return [];
}

function truncateTitle(t: string): string {
  const clean = t.replace(/\s+/g, " ").replace(/^#+\s*/, "").trim();
  return clean.length > 90 ? `${clean.slice(0, 87)}…` : clean;
}

function fallbackSections(text: string, pageOffsets?: number[]): DetectedSection[] {
  const total = countWords(text);
  if (total < 2500) {
    return [{ title: "Full text", start: 0, end: text.length, wordCount: total }];
  }
  const out: DetectedSection[] = [];
  if (pageOffsets && pageOffsets.length > 1) {
    const pages = pageOffsets.length;
    const per = Math.max(5, Math.ceil(pages / 20));
    for (let p = 0; p < pages; p += per) {
      const start = pageOffsets[p];
      const endPage = Math.min(pages, p + per);
      const end = endPage < pages ? pageOffsets[endPage] : text.length;
      const words = countWords(text.slice(start, end));
      if (words === 0) continue;
      out.push({ title: `Pages ${p + 1}–${endPage}`, start, end, wordCount: words });
    }
    return out;
  }
  // Word-based parts of roughly 2,000 words, split on paragraph boundaries.
  const paragraphs = text.split(/\n\n/);
  let pos = 0;
  let start = 0;
  let acc = 0;
  let part = 1;
  for (let i = 0; i < paragraphs.length; i++) {
    acc += countWords(paragraphs[i]);
    pos += paragraphs[i].length + (i < paragraphs.length - 1 ? 2 : 0);
    if (acc >= 2000 || i === paragraphs.length - 1) {
      out.push({ title: `Part ${part++}`, start, end: pos, wordCount: acc });
      start = pos;
      acc = 0;
    }
  }
  return out;
}

/**
 * Detects chapter / unit / section boundaries in extracted text.
 * Falls back to page groups (PDF) or ~2,000 word parts when no headings exist.
 */
export function detectSections(text: string, pageOffsets?: number[]): DetectedSection[] {
  if (!text.trim()) return [];
  const lines = splitLines(text);
  const candidates = findCandidates(lines);
  if (candidates.length < 2) return fallbackSections(text, pageOffsets);

  const raw: DetectedSection[] = [];
  const firstStart = lines[candidates[0].index].start;
  if (firstStart > 0 && countWords(text.slice(0, firstStart)) >= MIN_SECTION_WORDS) {
    raw.push({ title: "Opening pages", start: 0, end: firstStart, wordCount: countWords(text.slice(0, firstStart)) });
  }
  candidates.forEach((c, i) => {
    const start: number = i === 0 && raw.length === 0 ? 0 : lines[c.index].start;
    const end = i + 1 < candidates.length ? lines[candidates[i + 1].index].start : text.length;
    raw.push({ title: truncateTitle(c.title), start, end, wordCount: countWords(text.slice(start, end)) });
  });

  // Merge consecutive sections with the same title (running headers, "(continued)").
  const merged: DetectedSection[] = [];
  for (const s of raw) {
    const prev = merged[merged.length - 1];
    if (prev && normTitle(prev.title) === normTitle(s.title)) {
      prev.end = s.end;
      prev.wordCount += s.wordCount;
    } else {
      merged.push({ ...s });
    }
  }
  // Fold tiny sections (e.g. table-of-contents lines) into their neighbour.
  const sections: DetectedSection[] = [];
  let carryStart: number | null = null;
  for (let i = 0; i < merged.length; i++) {
    const s = merged[i];
    const start: number = carryStart ?? s.start;
    if (s.wordCount < MIN_SECTION_WORDS && i < merged.length - 1) {
      carryStart = start;
      continue;
    }
    carryStart = null;
    if (s.wordCount < MIN_SECTION_WORDS && sections.length > 0) {
      const prev = sections[sections.length - 1];
      prev.end = s.end;
      prev.wordCount = countWords(text.slice(prev.start, prev.end));
      continue;
    }
    sections.push({ ...s, start, wordCount: countWords(text.slice(start, s.end)) });
  }
  return sections.length ? sections : fallbackSections(text, pageOffsets);
}

/** Splits text into chunks of roughly `targetWords`, respecting paragraph and sentence boundaries. */
export function chunkText(text: string, targetWords: number): string[] {
  const units: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    const p = para.replace(/\s*\n\s*/g, " ").trim();
    if (!p) continue;
    if (countWords(p) > targetWords * 1.3) units.push(...splitSentences(p));
    else units.push(p);
  }
  const chunks: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (const u of units) {
    const w = countWords(u);
    if (words > 0 && words + w > targetWords * 1.15) {
      chunks.push(current.join("\n\n"));
      current = [];
      words = 0;
    }
    current.push(u);
    words += w;
  }
  if (current.length) {
    const tail = current.join("\n\n");
    // Avoid a tiny trailing chunk: attach it to the previous one.
    if (chunks.length && words < targetWords * 0.25) chunks[chunks.length - 1] += `\n\n${tail}`;
    else chunks.push(tail);
  }
  return chunks;
}

export function buildChunks(
  docs: ExtractedDocument[],
  targetWords: number,
  sectionFilter?: Set<string>,
): Chunk[] {
  const multi = docs.length > 1;
  const out: Chunk[] = [];
  let order = 0;
  for (const doc of docs) {
    for (const section of doc.sections) {
      if (sectionFilter && !sectionFilter.has(section.id)) continue;
      const slice = doc.text.slice(section.start, section.end);
      const label = multi ? `${doc.name} › ${section.title}` : section.title;
      chunkText(slice, targetWords).forEach((text, i) => {
        out.push({
          id: `${section.id}-c${i}`,
          docId: doc.id,
          docName: doc.name,
          sectionId: section.id,
          sectionTitle: section.title,
          label,
          text,
          words: countWords(text),
          order: order++,
        });
      });
    }
  }
  return out;
}
