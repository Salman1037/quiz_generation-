"use client";
import type { ExamSettings, Paper, PublicQuestion } from "@/types/exam";
import type { ExtractedDocument } from "@/types/document";
import { planGeneration, planTopUp, type PlannedBatch } from "@/lib/ai/planning";
import { dedupeQuestions } from "@/lib/validation/dedupe";
import { ClientError } from "./errors";
import { postJson } from "./api";

export type GenerationStage = "planning" | "generating" | "topping-up" | "finalizing" | "done";

export interface GenerationProgress {
  stage: GenerationStage;
  batchesTotal: number;
  batchesDone: number;
  batchesFailed: number;
  questionsReady: number;
  requested: number;
  /** Set while waiting out a rate limit. */
  waitingUntil: number | null;
  note: string | null;
  coveragePct: number;
}

interface BatchResponse {
  batchId: string;
  sealed: string;
  questions: PublicQuestion[];
  stats: { produced: number; rejected: Record<string, number> };
}

interface FinalizeResponse {
  paper: { id: string; title: string; totalQuestions: number; questions: PublicQuestion[] };
  key: string;
  requested: number;
  duplicatesRemoved: number;
}

export interface GenerationOutcome {
  paper: Paper;
  shortfall: number;
  failedBatches: number;
}

const MAX_RATE_RETRIES = 5;
const MAX_TOPUP_ROUNDS = 2;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new ClientError("ABORTED", "Cancelled."));
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new ClientError("ABORTED", "Cancelled."));
    });
  });
}

/** Spaces request start times so the app stays within the free tier's requests-per-minute. */
class Pacer {
  private next = 0;
  constructor(private intervalMs: number) {}
  async slot(signal: AbortSignal) {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.intervalMs;
    if (at > now) await wait(at - now, signal);
  }
  pushBack(ms: number) {
    this.next = Math.max(this.next, Date.now() + ms);
  }
}

function buildNotice(stoppedEarly: string | null, requested: number, got: number): string | null {
  if (got >= requested) return null;
  if (stoppedEarly) return `${stoppedEarly} It has ${got} of the ${requested} questions you asked for.`;
  return `Only ${got} of the ${requested} questions passed the quality checks (four distinct options, one correct answer, supported by your material), so the paper is shorter rather than padded.`;
}

export function titleFor(settings: ExamSettings, summary: string): string {
  const base = summary.replace(/\.(pdf|docx|txt)$/i, "");
  return `${base} — ${settings.questionCount} question examination`.slice(0, 140);
}

/**
 * Orchestrates the whole pipeline in the browser: plan → paced batch requests (2 in flight) →
 * rate-limit waits → top-up rounds for any shortfall → server-side finalisation.
 * Progress values are derived from completed requests, never simulated.
 */
export async function runGeneration(
  docs: ExtractedDocument[],
  settings: ExamSettings,
  opts: { rpm: number; signal: AbortSignal; onProgress: (p: GenerationProgress) => void },
): Promise<GenerationOutcome> {
  const { signal } = opts;
  const progress: GenerationProgress = {
    stage: "planning",
    batchesTotal: 0,
    batchesDone: 0,
    batchesFailed: 0,
    questionsReady: 0,
    requested: settings.questionCount,
    waitingUntil: null,
    note: null,
    coveragePct: 0,
  };
  const emit = () => opts.onProgress({ ...progress });
  emit();

  const plan = planGeneration(docs, settings);
  if (!plan.ok) {
    const code = plan.reason === "topic-not-found" ? "TOPIC_NOT_FOUND" : "INSUFFICIENT_CONTENT";
    throw new ClientError(code, plan.message);
  }
  progress.coveragePct = Math.round((plan.coveredWords / Math.max(1, plan.totalWords)) * 100);

  const sealed: string[] = [];
  const collected: PublicQuestion[] = [];
  const yieldById: Record<string, number> = {};
  const pacer = new Pacer(Math.ceil(60_000 / Math.max(1, opts.rpm)));
  let fatal: ClientError | null = null;
  let failed = 0;

  const runBatch = async (batch: PlannedBatch) => {
    let rateRetries = 0;
    let transientRetries = 0;
    while (!fatal) {
      await pacer.slot(signal);
      try {
        const avoid = collected.slice(-120).map((q) => q.question.slice(0, 200));
        const res = await postJson<BatchResponse>(
          "/api/generate",
          { batchId: batch.id, chunks: batch.chunks, count: batch.count, difficulty: batch.difficulty, topic: batch.topic, avoid },
          signal,
        );
        const { kept } = dedupeQuestions(res.questions, collected);
        collected.push(...kept);
        sealed.push(res.sealed);
        yieldById[batch.id] = (yieldById[batch.id] ?? 0) + kept.length;
        progress.batchesDone++;
        progress.questionsReady = Math.min(collected.length, settings.questionCount);
        progress.note = null;
        emit();
        return;
      } catch (err) {
        const e = err instanceof ClientError ? err : new ClientError("INTERNAL", "Unexpected error.");
        if (e.code === "ABORTED") throw e;
        if (e.code === "RATE_LIMIT" && rateRetries < MAX_RATE_RETRIES) {
          rateRetries++;
          const ms = (e.retryAfterSec ?? 20) * 1000 + 500;
          pacer.pushBack(ms);
          progress.waitingUntil = Date.now() + ms;
          progress.note = "Free-tier rate limit reached. Waiting before continuing.";
          emit();
          await wait(ms, signal);
          progress.waitingUntil = null;
          progress.note = null;
          emit();
          continue;
        }
        if (["UPSTREAM", "TIMEOUT", "NETWORK", "BAD_RESPONSE", "INTERNAL"].includes(e.code) && transientRetries < 1) {
          transientRetries++;
          continue;
        }
        if (["MISSING_KEY", "INVALID_KEY", "QUOTA", "MODEL_NOT_FOUND", "OFFLINE", "RATE_LIMIT"].includes(e.code)) {
          fatal = e;
          return;
        }
        // A single failing section (e.g. safety filter) shouldn't sink the whole paper.
        failed++;
        progress.batchesFailed = failed;
        progress.batchesDone++;
        emit();
        return;
      }
    }
  };

  const runPool = async (batches: PlannedBatch[]) => {
    const queue = [...batches];
    const worker = async () => {
      while (queue.length && !fatal) {
        const b = queue.shift()!;
        await runBatch(b);
      }
    };
    await Promise.all([worker(), worker()]);
  };

  progress.stage = "generating";
  progress.batchesTotal = plan.batches.length;
  emit();
  await runPool(plan.batches);

  for (let round = 1; round <= MAX_TOPUP_ROUNDS && !fatal; round++) {
    const shortfall = settings.questionCount - collected.length;
    if (shortfall <= 0) break;
    const extra = planTopUp(plan.batches, yieldById, shortfall, round);
    progress.stage = "topping-up";
    progress.batchesTotal += extra.length;
    progress.note = `Generating ${shortfall} more question${shortfall === 1 ? "" : "s"} to replace ones that failed checks.`;
    emit();
    await runPool(extra);
  }

  // Configuration problems always stop. Quota/rate problems keep whatever was already generated.
  let stoppedEarly: string | null = null;
  if (fatal) {
    const f = fatal as ClientError;
    const keepPartial = (f.code === "QUOTA" || f.code === "RATE_LIMIT") && collected.length > 0;
    if (!keepPartial) throw f;
    stoppedEarly =
      f.code === "QUOTA"
        ? "Gemini’s daily free quota ran out partway through, so this paper is shorter than requested."
        : "Gemini kept rate-limiting requests, so this paper is shorter than requested.";
  }
  if (!sealed.length || collected.length === 0) {
    throw new ClientError("NO_QUESTIONS", "No questions passed validation for this material.");
  }

  progress.stage = "finalizing";
  progress.note = null;
  emit();
  const final = await postJson<FinalizeResponse>(
    "/api/papers",
    {
      title: titleFor(settings, plan.sourceSummary),
      batches: sealed,
      requestedCount: settings.questionCount,
      shuffleQuestions: settings.shuffleQuestions,
      shuffleOptions: settings.shuffleOptions,
      includeExplanations: settings.includeExplanations,
      revealMode: settings.revealMode,
      scoring: {
        marksPerQuestion: settings.marksPerQuestion,
        negativeMarking: settings.negativeMarking,
        passPercentage: settings.passPercentage,
      },
    },
    signal,
  );
  progress.stage = "done";
  progress.questionsReady = final.paper.totalQuestions;
  emit();

  return {
    paper: {
      ...final.paper,
      createdAt: Date.now(),
      key: final.key,
      settings,
      sourceSummary: plan.sourceSummary,
      notice: buildNotice(stoppedEarly, settings.questionCount, final.paper.totalQuestions),
    },
    shortfall: Math.max(0, settings.questionCount - final.paper.totalQuestions),
    failedBatches: failed,
  };
}
