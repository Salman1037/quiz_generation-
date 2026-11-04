import { contentTokens, normalizeForCompare } from "@/lib/documents/text";

interface Comparable {
  question: string;
  options: { text: string }[];
  correctAnswer?: string;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface Fingerprint {
  stem: Set<string>;
  answer: string | null;
  exact: string;
}

export function fingerprint(q: Comparable | string): Fingerprint {
  if (typeof q === "string") {
    return { stem: new Set(contentTokens(q)), answer: null, exact: normalizeForCompare(q) };
  }
  const answer = q.correctAnswer ? (q.options[["A", "B", "C", "D"].indexOf(q.correctAnswer)]?.text ?? null) : null;
  return {
    stem: new Set(contentTokens(q.question)),
    answer: answer ? normalizeForCompare(answer) : null,
    exact: normalizeForCompare(q.question),
  };
}

/**
 * Near-duplicate test. The correct answer is the strongest signal:
 * - same answer and a moderately similar stem: duplicate (a rephrasing);
 * - different answers: different questions, unless the stems are almost identical
 *   ("Which metal does A export?" vs "Which metal does B export?" are both kept);
 * - answer unknown (plain question text): only very similar stems count.
 */
export function isNearDuplicate(a: Fingerprint, b: Fingerprint): boolean {
  if (a.exact === b.exact) return true;
  const sim = jaccard(a.stem, b.stem);
  if (a.answer && b.answer) {
    if (a.answer === b.answer) return sim >= 0.45;
    return sim >= 0.9;
  }
  return sim >= 0.85;
}

/** Keeps the first occurrence of each question and drops near-duplicates. */
export function dedupeQuestions<T extends Comparable>(items: T[], existing: (Comparable | string)[] = []): { kept: T[]; removed: number } {
  const seen: Fingerprint[] = existing.map(fingerprint);
  const kept: T[] = [];
  let removed = 0;
  for (const item of items) {
    const fp = fingerprint(item);
    if (seen.some((s) => isNearDuplicate(fp, s))) {
      removed++;
      continue;
    }
    seen.push(fp);
    kept.push(item);
  }
  return { kept, removed };
}
