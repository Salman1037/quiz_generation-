"use client";
import { useState } from "react";
import { BookOpen, Check, Lightbulb, Minus, X } from "lucide-react";
import type { ExamSession } from "@/types/exam";
import { AnswerOption } from "@/components/exam/AnswerOption";
import { optionState } from "@/components/exam/QuestionCard";
import { cn } from "@/lib/client/cn";
import { pad2 } from "@/lib/exam/utilities";

type Filter = "all" | "incorrect" | "correct" | "unanswered";

export function AnswerReview({ session }: { session: ExamSession }) {
  const [filter, setFilter] = useState<Filter>("all");
  const result = session.result!;
  const byId = new Map(session.paper.questions.map((q) => [q.id, q]));
  const items = session.order.map((id, i) => ({ q: byId.get(id)!, r: result.perQuestion[id], n: i + 1 })).filter((x) => x.q && x.r);
  const counts = {
    all: items.length,
    incorrect: items.filter((x) => x.r.status === "incorrect").length,
    correct: items.filter((x) => x.r.status === "correct").length,
    unanswered: items.filter((x) => x.r.status === "unanswered").length,
  };
  const visible = filter === "all" ? items : items.filter((x) => x.r.status === filter);
  const tabs: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "incorrect", label: "Incorrect" },
    { id: "correct", label: "Correct" },
    { id: "unanswered", label: "Unanswered" },
  ];

  return (
    <section aria-labelledby="review-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="review-title" className="text-[15px] font-semibold text-ink">
          Question review
        </h2>
        <div role="tablist" aria-label="Filter questions" className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={filter === t.id}
              onClick={() => setFilter(t.id)}
              className={cn(
                "h-8 rounded-lg border px-3 text-[13px] font-medium tabular transition-colors",
                filter === t.id ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-line-strong",
              )}
            >
              {t.label} <span className={filter === t.id ? "text-white/70" : "text-ink-3"}>{counts[t.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <ol className="mt-4 space-y-4" role="tabpanel">
        {visible.length === 0 && (
          <li className="card px-5 py-8 text-center text-sm text-ink-3">No questions in this group.</li>
        )}
        {visible.map(({ q, r, n }) => {
          const Icon = r.status === "correct" ? Check : r.status === "incorrect" ? X : Minus;
          return (
            <li key={q.id} className="card p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-semibold",
                    r.status === "correct" && "bg-success-soft text-success",
                    r.status === "incorrect" && "bg-danger-soft text-danger",
                    r.status === "unanswered" && "bg-sunken text-ink-3",
                  )}
                >
                  <Icon className="size-3.5" strokeWidth={3} aria-hidden />
                  {r.status === "correct" ? "Correct" : r.status === "incorrect" ? "Incorrect" : "Not answered"}
                  {r.marks !== 0 && <span className="tabular">({r.marks > 0 ? "+" : ""}{r.marks})</span>}
                </span>
                <span className="font-semibold text-ink tabular">Question {pad2(n)}</span>
                <span className="capitalize text-ink-3">{q.difficulty}</span>
                <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-ink-3" title={q.source}>
                  <BookOpen className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{q.source}</span>
                </span>
              </div>
              <h3 className="mt-3 text-[16px] font-medium leading-relaxed text-ink">{q.question}</h3>
              <div className="mt-4 space-y-2">
                {q.options.map((o) => (
                  <AnswerOption
                    key={o.id}
                    name={`review-${q.id}`}
                    option={o}
                    state={optionState(o.id, r.selected, r)}
                    checked={r.selected === o.id}
                    disabled
                    onSelect={() => undefined}
                  />
                ))}
              </div>
              {r.explanation && (
                <p className="mt-4 flex gap-2 rounded-xl bg-sunken/70 px-4 py-3 text-sm leading-relaxed text-ink-2">
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                  {r.explanation}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
