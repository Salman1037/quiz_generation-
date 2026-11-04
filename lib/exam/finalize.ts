import type { FullQuestion, OptionId, PublicQuestion, ScoringRules } from "@/types/exam";
import { OPTION_IDS } from "@/types/exam";
import { dedupeQuestions } from "@/lib/validation/dedupe";
import { fullQuestionSchema } from "@/lib/validation/schemas";
import { shuffle } from "./utilities";

export interface KeyPayload {
  kind: "key";
  paperId: string;
  createdAt: number;
  revealMode: "after" | "immediate";
  includeExplanations: boolean;
  scoring: ScoringRules;
  answers: Record<string, { correctAnswer: OptionId; explanation: string }>;
}

export interface BatchPayload {
  kind: "batch";
  createdAt: number;
  questions: FullQuestion[];
}

/** Shuffles a question's options and re-letters them, keeping the correct answer attached to its text. */
export function shuffleOptions(q: FullQuestion, random: () => number = Math.random): FullQuestion {
  const shuffled = shuffle(q.options, random);
  const letterMap = new Map<string, OptionId>(shuffled.map((o, i) => [o.id, OPTION_IDS[i]]));
  const options = shuffled.map((o, i) => ({ id: OPTION_IDS[i], text: o.text }));
  // Explanations sometimes mention letters ("option B"); re-letter those references too.
  const explanation = q.explanation.replace(
    /\b(option|answer|choice)\s+\(?([A-D])\)?(?=[\s.,;:)]|$)/gi,
    (_m, word: string, letter: string) => `${word} ${letterMap.get(letter.toUpperCase()) ?? letter}`,
  );
  return { ...q, options, correctAnswer: letterMap.get(q.correctAnswer)!, explanation };
}

export interface FinalizeInput {
  paperId: string;
  questions: FullQuestion[];
  requestedCount: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  random?: () => number;
}

/** Merges batches into one validated paper: cross-batch de-duplication, trimming, shuffling, stable ids. */
export function finalizeQuestions(input: FinalizeInput): { questions: FullQuestion[]; duplicatesRemoved: number } {
  const random = input.random ?? Math.random;
  const valid = input.questions.filter((q) => fullQuestionSchema.safeParse(q).success);
  const { kept, removed } = dedupeQuestions(valid);
  let list = kept.slice(0, input.requestedCount);
  if (input.shuffleOptions) list = list.map((q) => shuffleOptions(q, random));
  if (input.shuffleQuestions) list = shuffle(list, random);
  return {
    questions: list.map((q, i) => ({ ...q, id: `q${i + 1}` })),
    duplicatesRemoved: removed + (valid.length < input.questions.length ? input.questions.length - valid.length : 0),
  };
}

export function toPublic(q: FullQuestion): PublicQuestion {
  return { id: q.id, question: q.question, options: q.options, difficulty: q.difficulty, source: q.source };
}
