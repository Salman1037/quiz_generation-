import type { Chunk, ExtractedDocument } from "@/types/document";
import type { DifficultySetting, ExamSettings } from "@/types/exam";
import { buildChunks } from "@/lib/documents/chunking";
import { selectTopicChunks } from "@/lib/documents/topic";
import { MAX_CHUNK_CHARS } from "@/lib/validation/schemas";

/** Isomorphic generation planning: decides which text goes into which AI request. */

export const QUESTIONS_PER_BATCH = 10;
export const MAX_PER_BATCH = 15;
/** Roughly how much dense source text one good, distinct question needs. */
export const WORDS_PER_QUESTION = 45;
export const MAX_BATCH_WORDS = 5500;
const MIN_CHUNK_WORDS = 30;

export interface PlannedBatch {
  id: string;
  chunks: { label: string; text: string }[];
  chunkIds: string[];
  count: number;
  words: number;
  difficulty: DifficultySetting;
  topic?: string;
}

export type PlanResult =
  | {
      ok: true;
      batches: PlannedBatch[];
      chunks: Chunk[];
      totalWords: number;
      coveredWords: number;
      capacity: number;
      sourceSummary: string;
    }
  | {
      ok: false;
      reason: "no-content" | "insufficient" | "topic-not-found" | "no-selection";
      capacity: number;
      totalWords: number;
      message: string;
    };

export function estimateCapacity(words: number): number {
  return Math.floor(words / WORDS_PER_QUESTION);
}

function selectScope(docs: ExtractedDocument[], s: ExamSettings): { docs: ExtractedDocument[]; sections?: Set<string>; summary: string } {
  if (s.sourceMode === "document") {
    const doc = docs.find((d) => d.id === s.documentId);
    return { docs: doc ? [doc] : [], summary: doc ? doc.name : "" };
  }
  if (s.sourceMode === "sections") {
    const ids = new Set(s.sectionIds);
    const picked = docs.filter((d) => d.sections.some((x) => ids.has(x.id)));
    const titles = picked.flatMap((d) => d.sections.filter((x) => ids.has(x.id)).map((x) => x.title));
    const summary = titles.length <= 2 ? titles.join(" and ") : `${titles.length} selected sections`;
    return { docs: picked, sections: ids, summary };
  }
  const summary = docs.length === 1 ? docs[0].name : `${docs.length} documents`;
  return { docs, summary };
}

/** Distributes `total` across weights with the largest-remainder method, respecting a per-item cap. */
export function distribute(total: number, weights: number[], cap: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const exact = weights.map((w) => (w / sum) * total);
  const out = exact.map((x) => Math.min(cap, Math.floor(x)));
  let remaining = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r);
  let guard = 0;
  while (remaining > 0 && guard++ < 10_000) {
    let placed = false;
    for (const { i } of order) {
      if (remaining === 0) break;
      if (out[i] < cap) {
        out[i]++;
        remaining--;
        placed = true;
      }
    }
    if (!placed) break;
  }
  return out;
}

function evenlySample<T extends { words: number }>(items: T[], maxWords: number): T[] {
  const total = items.reduce((a, b) => a + b.words, 0);
  if (total <= maxWords) return items;
  const avg = total / items.length;
  const keep = Math.max(1, Math.floor(maxWords / avg));
  const step = items.length / keep;
  const out: T[] = [];
  for (let k = 0; k < keep; k++) out.push(items[Math.floor(k * step + step / 2)]);
  return out;
}

export function planGeneration(docs: ExtractedDocument[], settings: ExamSettings): PlanResult {
  const scope = selectScope(docs, settings);
  if (!scope.docs.length) {
    return { ok: false, reason: "no-selection", capacity: 0, totalWords: 0, message: "Choose a document or section to generate questions from." };
  }
  const scopeWords = scope.docs.reduce(
    (n, d) => n + d.sections.filter((s) => !scope.sections || scope.sections.has(s.id)).reduce((m, s) => m + s.wordCount, 0),
    0,
  );
  if (scopeWords < 60) {
    return {
      ok: false,
      reason: "no-content",
      capacity: estimateCapacity(scopeWords),
      totalWords: scopeWords,
      message: "There isn’t enough readable text in the selected material to write questions.",
    };
  }

  const requested = settings.questionCount;
  const nBatches = Math.ceil(requested / QUESTIONS_PER_BATCH);
  const target = Math.min(1500, Math.max(250, Math.round(scopeWords / Math.max(nBatches, 1))));
  let chunks = buildChunks(scope.docs, target, scope.sections).filter((c) => c.words >= MIN_CHUNK_WORDS);
  // Guard against pathological chunks (e.g. a huge paragraph with no sentence breaks).
  chunks = chunks.map((c) => (c.text.length > MAX_CHUNK_CHARS ? { ...c, text: c.text.slice(0, MAX_CHUNK_CHARS) } : c));
  let summary = scope.summary;

  if (settings.sourceMode === "topic") {
    const topic = settings.topic.trim();
    chunks = selectTopicChunks(chunks, topic, Math.max(requested * WORDS_PER_QUESTION * 2.5, 3000));
    if (!chunks.length) {
      return {
        ok: false,
        reason: "topic-not-found",
        capacity: 0,
        totalWords: 0,
        message: `“${topic}” doesn’t appear in the uploaded material. Try a different term or another source option.`,
      };
    }
    summary = `Topic: ${topic}`;
  }

  const totalWords = chunks.reduce((n, c) => n + c.words, 0);
  const capacity = estimateCapacity(totalWords);
  if (requested > capacity) {
    return {
      ok: false,
      reason: "insufficient",
      capacity,
      totalWords,
      message: `This material (about ${totalWords.toLocaleString()} words) can support roughly ${capacity} distinct questions, not ${requested}.`,
    };
  }

  // Group chunks contiguously so every batch covers a different stretch of the material.
  const groups: Chunk[][] = [];
  if (chunks.length <= nBatches) {
    chunks.forEach((c) => groups.push([c]));
  } else {
    const per = totalWords / nBatches;
    let current: Chunk[] = [];
    let acc = 0;
    for (const c of chunks) {
      current.push(c);
      acc += c.words;
      const remainingGroups = nBatches - groups.length - 1;
      if (acc >= per * (groups.length + 1) && remainingGroups > 0) {
        groups.push(current);
        current = [];
      }
    }
    if (current.length) groups.push(current);
  }

  const sampled = groups.map((g) => evenlySample(g, MAX_BATCH_WORDS));
  const weights = sampled.map((g) => g.reduce((n, c) => n + c.words, 0));
  // A batch can't be asked for more than its text supports or than one request handles.
  const caps = weights.map((w) => Math.max(1, Math.min(MAX_PER_BATCH, estimateCapacity(w))));
  let counts = distribute(requested, weights, MAX_PER_BATCH).map((c, i) => Math.min(c, caps[i]));
  let shortfall = requested - counts.reduce((a, b) => a + b, 0);

  const batches: PlannedBatch[] = sampled.map((g, i) => ({
    id: `b${i + 1}`,
    chunks: g.map((c) => ({ label: c.label, text: c.text })),
    chunkIds: g.map((c) => c.id),
    count: counts[i],
    words: weights[i],
    difficulty: settings.difficulty,
    topic: settings.sourceMode === "topic" ? settings.topic.trim() : undefined,
  }));

  // If per-batch caps left questions unassigned, add extra passes over the largest groups.
  let extra = 0;
  while (shortfall > 0 && extra < 30) {
    const base = batches[extra % sampled.length];
    const n = Math.min(QUESTIONS_PER_BATCH, shortfall);
    batches.push({ ...base, id: `b${batches.length + 1}`, count: n });
    shortfall -= n;
    extra++;
  }
  counts = batches.map((b) => b.count);

  return {
    ok: true,
    batches: batches.filter((b, i) => counts[i] > 0),
    chunks,
    totalWords,
    coveredWords: weights.reduce((a, b) => a + b, 0),
    capacity,
    sourceSummary: summary,
  };
}

/** Builds follow-up batches when validation or de-duplication left the paper short. */
export function planTopUp(batches: PlannedBatch[], yieldById: Record<string, number>, shortfall: number, round: number): PlannedBatch[] {
  const ranked = [...batches].sort((a, b) => {
    const ra = (yieldById[a.id] ?? 0) / Math.max(1, estimateCapacity(a.words));
    const rb = (yieldById[b.id] ?? 0) / Math.max(1, estimateCapacity(b.words));
    return ra - rb || b.words - a.words;
  });
  const out: PlannedBatch[] = [];
  let left = shortfall;
  let i = 0;
  while (left > 0 && i < ranked.length * 2) {
    const base = ranked[i % ranked.length];
    const n = Math.min(QUESTIONS_PER_BATCH, left);
    out.push({ ...base, id: `t${round}-${out.length + 1}`, count: n });
    left -= n;
    i++;
  }
  return out;
}
