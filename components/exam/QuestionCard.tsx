"use client";
import { BookOpen, Flag, Lightbulb } from "lucide-react";
import type { OptionId, PublicQuestion, RevealedAnswer } from "@/types/exam";
import { AnswerOption, type OptionState } from "./AnswerOption";
import { cn } from "@/lib/client/cn";
import { pad2 } from "@/lib/exam/utilities";

export function optionState(optionId: OptionId, selected: OptionId | null | undefined, revealed: RevealedAnswer | undefined): OptionState {
  if (!revealed) return selected === optionId ? "selected" : "idle";
  if (optionId === revealed.correctAnswer) return selected === optionId ? "correct" : "missed-correct";
  if (selected === optionId) return "wrong";
  return "dim";
}

const difficultyTone = {
  easy: "text-success bg-success-soft",
  medium: "text-accent-strong bg-accent-soft",
  hard: "text-danger bg-danger-soft",
};

export function QuestionCard({
  question,
  index,
  total,
  selected,
  revealed,
  locked,
  marked,
  onSelect,
}: {
  question: PublicQuestion;
  index: number;
  total: number;
  selected: OptionId | null | undefined;
  revealed?: RevealedAnswer;
  locked: boolean;
  marked: boolean;
  onSelect: (id: OptionId) => void;
}) {
  const result = revealed ? (selected ? (selected === revealed.correctAnswer ? "correct" : "incorrect") : "unanswered") : null;
  return (
    <article aria-labelledby={`q-${question.id}`} className="card p-5 sm:p-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
        <span className="font-semibold text-ink tabular">
          Question {pad2(index + 1)} <span className="font-normal text-ink-3">/ {pad2(total)}</span>
        </span>
        <span className={cn("rounded-md px-1.5 py-0.5 text-[12px] font-medium capitalize", difficultyTone[question.difficulty])}>{question.difficulty}</span>
        {marked && (
          <span className="inline-flex items-center gap-1 rounded-md bg-warn-soft px-1.5 py-0.5 text-[12px] font-medium text-warn">
            <Flag className="size-3" aria-hidden />
            Marked for review
          </span>
        )}
        <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-ink-3" title={question.source}>
          <BookOpen className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{question.source}</span>
        </span>
      </div>

      <h2 id={`q-${question.id}`} className="mt-5 text-[1.2rem] font-medium leading-[1.55] tracking-[-0.01em] text-ink sm:text-[1.3rem]">
        {question.question}
      </h2>

      <div role="radiogroup" aria-labelledby={`q-${question.id}`} className="mt-6 space-y-2.5">
        {question.options.map((o) => (
          <AnswerOption
            key={o.id}
            name={question.id}
            option={o}
            state={optionState(o.id, selected, revealed)}
            checked={selected === o.id}
            disabled={locked || Boolean(revealed)}
            onSelect={() => onSelect(o.id)}
          />
        ))}
      </div>

      {revealed && (
        <div
          className={cn(
            "mt-6 rounded-xl border px-4 py-3.5",
            result === "correct" ? "border-success-line bg-success-soft/60" : result === "incorrect" ? "border-danger-line bg-danger-soft/60" : "border-line bg-sunken/60",
          )}
          aria-live="polite"
        >
          <p className={cn("text-sm font-semibold", result === "correct" ? "text-success" : result === "incorrect" ? "text-danger" : "text-ink-2")}>
            {result === "correct" ? "Correct" : result === "incorrect" ? `Incorrect. The answer is ${revealed.correctAnswer}.` : `Not answered. The answer is ${revealed.correctAnswer}.`}
          </p>
          {revealed.explanation && (
            <p className="mt-1.5 flex gap-2 text-sm leading-relaxed text-ink-2">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
              {revealed.explanation}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
