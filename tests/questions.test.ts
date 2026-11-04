import { describe, expect, it } from "vitest";
import { buildSourceIndex, locateEvidence, normalizeQuestion } from "@/lib/validation/questions";
import { dedupeQuestions } from "@/lib/validation/dedupe";
import { parseItems } from "@/lib/ai/json";
import { SAMPLE_CHAPTERS } from "./helpers";

const good = {
  question: "Which component of an operating system runs in kernel mode?",
  options: [
    { id: "A", text: "The kernel" },
    { id: "B", text: "The shell" },
    { id: "C", text: "The compiler" },
    { id: "D", text: "The text editor" },
  ],
  correctAnswer: "A",
  explanation: "The kernel runs in a privileged mode.",
  difficulty: "easy",
  source: "Chapter 1",
  evidence: "The kernel is the core component of an operating system and runs in a privileged mode called kernel mode.",
};

describe("normalizeQuestion", () => {
  it("accepts a well-formed question", () => {
    const r = normalizeQuestion(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.question.correctAnswer).toBe("A");
  });
  it("accepts string options with letter prefixes and resolves answers by letter, index or text", () => {
    const base = { ...good, options: ["A. The kernel", "B) The shell", "(C) The compiler", "D: The text editor"] };
    for (const [ans, expected] of [["b", "B"], ["C.", "C"], [3, "D"], ["The shell", "B"], ["B) The shell", "B"]] as const) {
      const r = normalizeQuestion({ ...base, correctAnswer: ans });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.question.correctAnswer).toBe(expected);
        expect(r.question.options[0].text).toBe("The kernel");
      }
    }
  });
  it("rejects bad shapes", () => {
    expect(normalizeQuestion({ ...good, options: good.options.slice(0, 3) })).toEqual({ ok: false, reason: "option-count" });
    expect(normalizeQuestion({ ...good, correctAnswer: "E" })).toEqual({ ok: false, reason: "bad-answer" });
    expect(normalizeQuestion({ ...good, options: [...good.options.slice(0, 3), { id: "D", text: "the KERNEL" }] })).toEqual({
      ok: false,
      reason: "duplicate-options",
    });
    expect(normalizeQuestion({ ...good, options: [...good.options.slice(0, 3), { id: "D", text: "All of the above" }] })).toEqual({
      ok: false,
      reason: "aggregate-option",
    });
    expect(normalizeQuestion({ ...good, question: "Why?" })).toEqual({ ok: false, reason: "short-question" });
    expect(normalizeQuestion({ nope: true })).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("evidence verification", () => {
  const chunks = Object.entries(SAMPLE_CHAPTERS).map(([label, text]) => ({ label, text }));
  const index = buildSourceIndex(chunks);
  it("locates verbatim evidence in the right chunk", () => {
    expect(locateEvidence(good.evidence, index)).toBe(0);
    expect(locateEvidence("A page table maps page numbers to frame numbers.", index)).toBe(2);
  });
  it("rejects invented evidence", () => {
    expect(locateEvidence("Linux was first released by Linus Torvalds in 1991 as a hobby project.", index)).toBe(-1);
    expect(locateEvidence("", index)).toBe(-1);
  });
});

describe("dedupe", () => {
  it("drops near-identical questions", () => {
    const a = { question: "What does a page table map page numbers to?", options: [{ text: "Frames" }], correctAnswer: "A" };
    const b = { question: "A page table maps page numbers to what?", options: [{ text: "frames" }], correctAnswer: "A" };
    const c = { question: "What causes thrashing in a system?", options: [{ text: "Swapping" }], correctAnswer: "A" };
    const { kept, removed } = dedupeQuestions([a, b, c]);
    expect(kept).toEqual([a, c]);
    expect(removed).toBe(1);
  });
  it("keeps template-like questions that have different answers", () => {
    const opts = (t: string) => [{ text: t }, { text: "x" }, { text: "y" }, { text: "z" }];
    const a = { question: "Which metal ore does the coastal settlement of Varkel export every spring?", options: opts("copper"), correctAnswer: "A" };
    const b = { question: "Which metal ore does the coastal settlement of Mordan export every spring?", options: opts("nickel"), correctAnswer: "A" };
    const c = { question: "Every spring, which metal ore does the coastal settlement of Varkel export?", options: opts("copper"), correctAnswer: "A" };
    const { kept } = dedupeQuestions([a, b, c]);
    expect(kept).toEqual([a, b]);
  });
  it("checks against existing question stems", () => {
    const { kept } = dedupeQuestions([{ question: "What causes thrashing in a system?", options: [] }], ["What causes thrashing in a system?"]);
    expect(kept).toHaveLength(0);
  });
});

describe("parseItems", () => {
  it("parses fenced JSON and bare arrays", () => {
    expect(parseItems('```json\n{"questions":[{"a":1}]}\n```', "questions").items).toEqual([{ a: 1 }]);
    expect(parseItems('[{"a":1},{"a":2}]', "questions").items).toHaveLength(2);
  });
  it("salvages complete items from truncated output", () => {
    const truncated = '{"questions":[{"question":"one {x}","n":1},{"question":"two \\"q\\"","n":2},{"question":"thr';
    const r = parseItems(truncated, "questions");
    expect(r.salvaged).toBe(true);
    expect(r.items).toEqual([
      { question: "one {x}", n: 1 },
      { question: 'two "q"', n: 2 },
    ]);
  });
  it("throws a typed error on garbage", () => {
    expect(() => parseItems("I cannot help with that", "questions")).toThrow(/couldn’t be read/);
  });
});
