/** Isomorphic text helpers (safe for both server and browser). */

const PAGE_NUMBER_LINE = /^(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i;

export function cleanText(raw: string): string {
  let t = raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/\u00AD/g, "")
     
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\t/g, " ");
  // Re-join words hyphenated across line breaks: "exam-\nple" -> "example"
  t = t.replace(/([A-Za-z])-\n([a-z])/g, "$1$2");
  t = t
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .filter((line) => !PAGE_NUMBER_LINE.test(line))
    .join("\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

export function countWords(text: string): number {
  const m = text.match(WORD_RE);
  return m ? m.length : 0;
}

export const STOPWORDS = new Set(
  (
    "a an the and or but if of to in on at by for with from as is are was were be been being this that these those it its " +
    "which who whom whose what when where why how not no do does did can could should would may might will shall than then " +
    "there their they them he she his her we our you your i me my into about over under also such each any all some most more " +
    "other only same so very just both between during before after above below up down out off again further once"
  ).split(" "),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().normalize("NFKD").match(/[\p{L}\p{N}]+/gu) ?? []).filter(Boolean);
}

export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function normalizeForCompare(text: string): string {
  return tokenize(text).join(" ");
}

/** Split text into sentences without breaking on common abbreviations. */
export function splitSentences(text: string): string[] {
  const protectedText = text.replace(/\b(e\.g|i\.e|etc|vs|Mr|Mrs|Dr|Prof|Fig|No)\./g, "$1\u0000");
  return protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/)
    .map((s) => s.replace(/\u0000/g, ".").trim())
    .filter(Boolean);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
