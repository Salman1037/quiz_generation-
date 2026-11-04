import type { Difficulty, FullQuestion, OptionId } from "@/types/exam";
import { OPTION_IDS } from "@/types/exam";
import { contentTokens, normalizeForCompare, tokenize } from "@/lib/documents/text";
import { rawQuestionSchema } from "./schemas";

export type RejectReason =
  | "malformed"
  | "option-count"
  | "empty-option"
  | "duplicate-options"
  | "bad-answer"
  | "short-question"
  | "aggregate-option"
  | "unsupported";

export type NormalizeResult =
  | { ok: true; question: Omit<FullQuestion, "id" | "source"> & { sourceHint: string } }
  | { ok: false; reason: RejectReason };

const OPTION_PREFIX = /^\s*(?:\(?[A-Da-d1-4]\)|[A-Da-d1-4][.):]|\([A-Da-d]\))\s+/;
const AGGREGATE = /\b(all|none|both|neither) of (the )?(above|these|them)\b|\ball the above\b/i;

function cleanOption(text: string): string {
  return text.replace(OPTION_PREFIX, "").replace(/\s+/g, " ").trim();
}

function resolveCorrect(raw: string | number, options: string[]): OptionId | null {
  if (typeof raw === "number") {
    if (raw >= 0 && raw <= 3 && Number.isInteger(raw)) return OPTION_IDS[raw];
    if (raw >= 1 && raw <= 4 && Number.isInteger(raw)) return OPTION_IDS[raw - 1];
    return null;
  }
  const s = raw.trim();
  // "B", "b", "(B)", "B." or "B) Option text"
  const letter = s.match(/^\(?([A-Da-d])\)?[.):]?$/) ?? s.match(/^\(?([A-Da-d])[.):]\s+/);
  if (letter) return letter[1].toUpperCase() as OptionId;
  const byText = options.findIndex((o) => normalizeForCompare(o) === normalizeForCompare(cleanOption(s)));
  return byText >= 0 ? OPTION_IDS[byText] : null;
}

function normDifficulty(d: string | undefined, fallback: Difficulty): Difficulty {
  const v = (d ?? "").toLowerCase().trim();
  return v === "easy" || v === "medium" || v === "hard" ? v : fallback;
}

/** Validates one AI-produced question and converts it into the canonical A–D shape. */
export function normalizeQuestion(input: unknown, fallbackDifficulty: Difficulty = "medium"): NormalizeResult {
  const parsed = rawQuestionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const q = parsed.data;
  const question = q.question.replace(/\s+/g, " ").trim().replace(/^(?:Q(?:uestion)?\s*\d+[.:)]\s*)/i, "");
  if (question.length < 12 || tokenize(question).length < 3) return { ok: false, reason: "short-question" };

  // If the model returned ids, order options by them; otherwise keep given order.
  let opts = q.options.map((o, i) =>
    typeof o === "string" ? { id: OPTION_IDS[i], text: o } : { id: (o.id ?? OPTION_IDS[i]).trim().toUpperCase(), text: o.text },
  );
  if (opts.length !== 4) return { ok: false, reason: "option-count" };
  if (opts.every((o) => OPTION_IDS.includes(o.id as OptionId)) && new Set(opts.map((o) => o.id)).size === 4) {
    opts = [...opts].sort((a, b) => a.id.localeCompare(b.id));
  }
  const texts = opts.map((o) => cleanOption(o.text));
  if (texts.some((t) => t.length === 0)) return { ok: false, reason: "empty-option" };
  if (new Set(texts.map(normalizeForCompare)).size !== 4) return { ok: false, reason: "duplicate-options" };
  // Options are shuffled later, so positional answers like "all of the above" would break.
  if (texts.some((t) => AGGREGATE.test(t))) return { ok: false, reason: "aggregate-option" };

  const correct = resolveCorrect(q.correctAnswer, texts);
  if (!correct) return { ok: false, reason: "bad-answer" };

  return {
    ok: true,
    question: {
      question,
      options: texts.map((text, i) => ({ id: OPTION_IDS[i], text })),
      correctAnswer: correct,
      explanation: (q.explanation ?? "").replace(/\s+/g, " ").trim(),
      difficulty: normDifficulty(q.difficulty, fallbackDifficulty),
      evidence: (q.evidence ?? "").replace(/\s+/g, " ").trim(),
      sourceHint: (q.source ?? "").trim(),
    },
  };
}

function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(" "));
  return out;
}

/**
 * Checks that the model's quoted evidence actually appears in the source text.
 * Requires most evidence words to exist in the source and at least one exact
 * 4-word run, which rules out invented "evidence".
 */
export function evidenceScore(evidence: string, normalizedSource: string, sourceTokenSet: Set<string>): number {
  const evTokens = tokenize(evidence);
  if (evTokens.length < 4) return 0;
  const content = contentTokens(evidence);
  const present = content.length ? content.filter((t) => sourceTokenSet.has(t)).length / content.length : 0;
  const grams = ngrams(evTokens, 4);
  const hits = grams.filter((g) => normalizedSource.includes(g)).length;
  if (hits === 0) return 0;
  return present * 0.6 + (hits / grams.length) * 0.4;
}

export const EVIDENCE_THRESHOLD = 0.6;

export interface SourceIndex {
  labels: string[];
  normalized: string[];
  tokenSets: Set<string>[];
}

export function buildSourceIndex(chunks: { label: string; text: string }[]): SourceIndex {
  const normalized = chunks.map((c) => ` ${normalizeForCompare(c.text)} `);
  return {
    labels: chunks.map((c) => c.label),
    normalized,
    tokenSets: chunks.map((c) => new Set(tokenize(c.text))),
  };
}

/** Returns the index of the chunk that best supports the evidence, or -1 when unsupported. */
export function locateEvidence(evidence: string, index: SourceIndex): number {
  let best = -1;
  let bestScore = 0;
  index.normalized.forEach((src, i) => {
    const s = evidenceScore(evidence, src, index.tokenSets[i]);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return bestScore >= EVIDENCE_THRESHOLD ? best : -1;
}
