import type { OptionId, QuestionResult, ScoreSummary, ScoringRules } from "@/types/exam";

export interface KeyEntry {
  correctAnswer: OptionId;
  explanation: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Scores answers against the key. Unanswered questions score zero and are never penalised. */
export function scoreAnswers(
  key: Record<string, KeyEntry>,
  answers: Record<string, OptionId | null | undefined>,
  rules: ScoringRules,
  includeExplanations: boolean,
): { summary: ScoreSummary; perQuestion: Record<string, QuestionResult> } {
  const perQuestion: Record<string, QuestionResult> = {};
  let correct = 0;
  let incorrect = 0;
  let unanswered = 0;
  let marks = 0;
  for (const [id, entry] of Object.entries(key)) {
    const selected = answers[id] ?? null;
    let status: QuestionResult["status"];
    let m = 0;
    if (!selected) {
      status = "unanswered";
      unanswered++;
    } else if (selected === entry.correctAnswer) {
      status = "correct";
      correct++;
      m = rules.marksPerQuestion;
    } else {
      status = "incorrect";
      incorrect++;
      m = -rules.negativeMarking;
    }
    marks += m;
    perQuestion[id] = {
      id,
      selected,
      correctAnswer: entry.correctAnswer,
      explanation: includeExplanations ? entry.explanation || null : null,
      status,
      marks: round2(m),
    };
  }
  const total = Object.keys(key).length;
  const maxMarks = total * rules.marksPerQuestion;
  const finalMarks = round2(marks);
  const percentage = maxMarks > 0 ? round2(Math.max(0, (finalMarks / maxMarks) * 100)) : 0;
  return {
    summary: {
      total,
      correct,
      incorrect,
      unanswered,
      marks: finalMarks,
      maxMarks: round2(maxMarks),
      percentage,
      passed: rules.passPercentage == null ? null : percentage >= rules.passPercentage,
      passPercentage: rules.passPercentage,
      negativeMarking: rules.negativeMarking,
    },
    perQuestion,
  };
}
