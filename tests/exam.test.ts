import { describe, expect, it } from "vitest";
import { scoreAnswers } from "@/lib/exam/scoring";
import { finalizeQuestions, shuffleOptions } from "@/lib/exam/finalize";
import { formatDuration, isLowTime, remainingSeconds, shuffle } from "@/lib/exam/utilities";
import type { FullQuestion } from "@/types/exam";
import { seeded } from "./helpers";

const key = {
  q1: { correctAnswer: "A" as const, explanation: "e1" },
  q2: { correctAnswer: "B" as const, explanation: "e2" },
  q3: { correctAnswer: "C" as const, explanation: "e3" },
  q4: { correctAnswer: "D" as const, explanation: "e4" },
};

describe("scoring", () => {
  it("counts correct, incorrect and unanswered", () => {
    const { summary, perQuestion } = scoreAnswers(key, { q1: "A", q2: "C", q3: null }, { marksPerQuestion: 1, negativeMarking: 0, passPercentage: null }, true);
    expect(summary).toMatchObject({ total: 4, correct: 1, incorrect: 1, unanswered: 2, marks: 1, maxMarks: 4, percentage: 25, passed: null });
    expect(perQuestion.q2).toMatchObject({ status: "incorrect", selected: "C", correctAnswer: "B", explanation: "e2" });
    expect(perQuestion.q4.status).toBe("unanswered");
  });
  it("applies negative marking only to wrong answers and floors percentage at zero", () => {
    const r = scoreAnswers(key, { q1: "A", q2: "A", q3: "A", q4: null }, { marksPerQuestion: 1, negativeMarking: 0.25, passPercentage: 40 }, false);
    expect(r.summary.marks).toBe(0.5);
    expect(r.summary.percentage).toBe(12.5);
    expect(r.summary.passed).toBe(false);
    expect(r.perQuestion.q1.explanation).toBeNull();
    const worst = scoreAnswers(key, { q1: "B", q2: "A", q3: "A", q4: "A" }, { marksPerQuestion: 1, negativeMarking: 1, passPercentage: null }, false);
    expect(worst.summary.marks).toBe(-4);
    expect(worst.summary.percentage).toBe(0);
  });
  it("evaluates pass thresholds", () => {
    const r = scoreAnswers(key, { q1: "A", q2: "B", q3: "C" }, { marksPerQuestion: 2, negativeMarking: 0, passPercentage: 75 }, false);
    expect(r.summary).toMatchObject({ marks: 6, maxMarks: 8, percentage: 75, passed: true });
  });
});

function q(n: number, question: string): FullQuestion {
  return {
    id: `x${n}`,
    question,
    options: [
      { id: "A", text: `alpha ${n}` },
      { id: "B", text: `beta ${n}` },
      { id: "C", text: `gamma ${n}` },
      { id: "D", text: `delta ${n}` },
    ],
    correctAnswer: "C",
    explanation: `Option C is right for ${n}.`,
    difficulty: "medium",
    source: "Chapter 1",
  };
}

describe("finalize", () => {
  it("keeps the correct answer attached to its text when options are shuffled", () => {
    const rnd = seeded(7);
    for (let i = 0; i < 50; i++) {
      const original = q(i, "Which process state follows the ready state?");
      const s = shuffleOptions(original, rnd);
      const correctText = s.options.find((o) => o.id === s.correctAnswer)!.text;
      expect(correctText).toBe(`gamma ${i}`);
      expect(s.options.map((o) => o.id)).toEqual(["A", "B", "C", "D"]);
      expect(s.explanation).toBe(`Option ${s.correctAnswer} is right for ${i}.`);
    }
  });
  it("dedupes across batches, trims to the requested count and assigns sequential ids", () => {
    const input = [
      q(1, "What does the translation lookaside buffer cache?"),
      q(2, "What does the translation lookaside buffer cache?"),
      q(3, "Which scheduling algorithm uses a fixed time quantum?"),
      q(4, "When does a page fault occur during execution?"),
    ];
    const { questions, duplicatesRemoved } = finalizeQuestions({
      paperId: "p",
      questions: input,
      requestedCount: 2,
      shuffleQuestions: false,
      shuffleOptions: false,
    });
    expect(questions.map((x) => x.id)).toEqual(["q1", "q2"]);
    expect(questions[1].question).toMatch(/time quantum/);
    expect(duplicatesRemoved).toBe(1);
  });
});

describe("timer utilities", () => {
  it("computes remaining time from the clock", () => {
    expect(remainingSeconds(10_000, 4_500)).toBe(6);
    expect(remainingSeconds(10_000, 12_000)).toBe(0);
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(65)).toBe("01:05");
    expect(isLowTime(50, 3600)).toBe(true);
    expect(isLowTime(1000, 3600)).toBe(false);
  });
  it("shuffle is a permutation", () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffle(arr, seeded(1)).sort((a, b) => a - b)).toEqual(arr);
  });
});
