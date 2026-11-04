import type { Chunk } from "@/types/document";
import { contentTokens } from "./text";

function stem(t: string): string {
  return t.length > 5 ? t.slice(0, Math.max(5, t.length - 3)) : t;
}

export function topicTerms(topic: string): string[] {
  return Array.from(new Set(contentTokens(topic).filter((t) => t.length >= 3).map(stem)));
}

/** Relevance of a chunk to a free-text topic: term hits weighted by coverage of distinct terms. */
export function scoreChunkForTopic(chunk: Chunk, terms: string[], phrase: string): number {
  if (!terms.length) return 0;
  const tokens = contentTokens(chunk.text).map(stem);
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  let hits = 0;
  let distinct = 0;
  for (const term of terms) {
    const c = counts.get(term) ?? 0;
    if (c > 0) distinct++;
    hits += Math.min(c, 12);
  }
  if (distinct === 0) return 0;
  const coverage = distinct / terms.length;
  if (terms.length >= 2 && coverage < 0.5) return 0;
  const phraseBonus = phrase.length > 3 && chunk.text.toLowerCase().includes(phrase.toLowerCase()) ? 5 : 0;
  const titleBonus = terms.some((t) => chunk.sectionTitle.toLowerCase().includes(t)) ? 3 : 0;
  return (hits / Math.sqrt(Math.max(tokens.length, 50))) * 10 * coverage + phraseBonus + titleBonus;
}

export function selectTopicChunks(chunks: Chunk[], topic: string, wordBudget: number): Chunk[] {
  const terms = topicTerms(topic);
  const scored = chunks
    .map((c) => ({ c, s: scoreChunkForTopic(c, terms, topic.trim()) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  const picked: Chunk[] = [];
  let words = 0;
  for (const { c } of scored) {
    if (words >= wordBudget || picked.length >= 60) break;
    picked.push(c);
    words += c.words;
  }
  return picked.sort((a, b) => a.order - b.order);
}
