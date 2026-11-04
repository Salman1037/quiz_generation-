import "server-only";
import type { Difficulty, FullQuestion } from "@/types/exam";
import { AppError } from "@/lib/api/errors";
import type { GenerateRequest } from "@/lib/validation/schemas";
import { geminiQuestionSchema, MAX_BATCH_QUESTIONS } from "@/lib/validation/schemas";
import { buildSourceIndex, locateEvidence, normalizeQuestion, type RejectReason } from "@/lib/validation/questions";
import { dedupeQuestions } from "@/lib/validation/dedupe";
import { callGemini, type GeminiRequest, type GeminiResult } from "./gemini";
import { parseItems } from "./json";
import { buildMcqPrompt, MCQ_SYSTEM_PROMPT } from "./prompts";

export type ModelCaller = (req: GeminiRequest) => Promise<GeminiResult>;

export interface BatchStats {
  requested: number;
  produced: number;
  rejected: Partial<Record<RejectReason | "duplicate", number>>;
  attempts: number;
  truncated: boolean;
}

export interface BatchOutcome {
  questions: FullQuestion[];
  stats: BatchStats;
}

const MAX_ATTEMPTS = 3;

/**
 * Generates one batch of validated questions from a small set of source chunks.
 * Each candidate must parse, have four distinct options with one correct answer,
 * quote evidence that really exists in the source, and not duplicate earlier questions.
 * Missing questions are re-requested a bounded number of times.
 */
export async function generateBatch(
  req: GenerateRequest,
  callModel: ModelCaller = (r) => callGemini(r),
  signal?: AbortSignal,
): Promise<BatchOutcome> {
  const index = buildSourceIndex(req.chunks);
  const fallbackDifficulty: Difficulty = req.difficulty === "mixed" ? "medium" : req.difficulty;
  const accepted: FullQuestion[] = [];
  const stats: BatchStats = { requested: req.count, produced: 0, rejected: {}, attempts: 0, truncated: false };
  const reject = (r: RejectReason | "duplicate") => (stats.rejected[r] = (stats.rejected[r] ?? 0) + 1);
  let lastError: unknown = null;

  while (accepted.length < req.count && stats.attempts < MAX_ATTEMPTS) {
    stats.attempts++;
    const missing = req.count - accepted.length;
    // Ask for a few extra on the first pass because some candidates fail validation.
    const ask = Math.min(MAX_BATCH_QUESTIONS, stats.attempts === 1 ? missing + Math.ceil(missing * 0.25) : missing + 1);
    const avoid = [...req.avoid, ...accepted.map((q) => q.question)];
    let result: GeminiResult;
    try {
      result = await callModel({
        system: MCQ_SYSTEM_PROMPT,
        parts: [{ text: buildMcqPrompt({ chunks: req.chunks, count: ask, difficulty: req.difficulty, topic: req.topic, avoid }) }],
        responseSchema: geminiQuestionSchema,
        temperature: stats.attempts === 1 ? 0.4 : 0.7,
        signal,
      });
    } catch (err) {
      // Configuration and quota problems will not fix themselves: surface immediately.
      if (err instanceof AppError && !["BAD_RESPONSE", "UPSTREAM", "TIMEOUT"].includes(err.code)) throw err;
      lastError = err;
      continue;
    }
    if (result.truncated) stats.truncated = true;

    let items: unknown[];
    try {
      items = parseItems(result.text, "questions").items;
    } catch (err) {
      lastError = err;
      continue;
    }
    const fresh: FullQuestion[] = [];
    for (const item of items) {
      const norm = normalizeQuestion(item, fallbackDifficulty);
      if (!norm.ok) {
        reject(norm.reason);
        continue;
      }
      const q = norm.question;
      const where = locateEvidence(q.evidence ?? "", index);
      if (where < 0) {
        reject("unsupported");
        continue;
      }
      fresh.push({
        id: "",
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        difficulty: req.difficulty === "mixed" ? q.difficulty : req.difficulty,
        // The source is where the evidence was found, not merely what the model claims.
        source: index.labels[where],
        evidence: q.evidence,
      });
    }
    const { kept, removed } = dedupeQuestions(fresh, [...req.avoid, ...accepted]);
    for (let i = 0; i < removed; i++) reject("duplicate");
    accepted.push(...kept.slice(0, req.count - accepted.length));
  }

  if (!accepted.length && lastError) throw lastError;
  stats.produced = accepted.length;
  return { questions: accepted.map((q, i) => ({ ...q, id: `${req.batchId}-${i}` })), stats };
}
