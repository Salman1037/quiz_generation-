"use client";
import { motion } from "framer-motion";
import type { ExamResult } from "@/types/exam";
import { formatDurationWords } from "@/lib/exam/utilities";
import { cn } from "@/lib/client/cn";

function Ring({ pct, tone }: { pct: number; tone: "success" | "warn" | "danger" }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const color = tone === "success" ? "var(--color-success)" : tone === "warn" ? "var(--color-warn)" : "var(--color-danger)";
  return (
    <div className="relative size-40 shrink-0">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-sunken)" strokeWidth="10" />
        <motion.circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct / 100) }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-[2.1rem] font-semibold leading-none tracking-tight text-ink tabular">
            {Math.round(pct)}
            <span className="text-lg text-ink-3">%</span>
          </p>
          <p className="mt-1 text-[12px] text-ink-3">score</p>
        </div>
      </div>
    </div>
  );
}

export function verdict(pct: number): string {
  if (pct >= 90) return "Outstanding. You know this material thoroughly.";
  if (pct >= 75) return "Strong result. A few gaps to tidy up.";
  if (pct >= 50) return "A solid base. Review the questions you missed.";
  if (pct >= 30) return "Some understanding is there. Revisit the sections below.";
  return "This material needs another read. Start with the explanations below.";
}

export function ScoreCard({ result }: { result: ExamResult }) {
  const s = result.summary;
  const tone = s.passed === false ? "danger" : s.percentage >= 75 ? "success" : s.percentage >= 50 ? "warn" : "danger";
  const stats: [string, string, string?][] = [
    ["Correct", String(s.correct), "text-success"],
    ["Incorrect", String(s.incorrect), "text-danger"],
    ["Unanswered", String(s.unanswered)],
    ["Marks", `${s.marks} / ${s.maxMarks}`],
    ["Time taken", formatDurationWords(result.timeTakenSec)],
    ["Questions", String(s.total)],
  ];
  return (
    <section aria-labelledby="score-title" className="card overflow-hidden">
      <div className="flex flex-col items-center gap-6 p-6 sm:flex-row sm:items-center sm:gap-8 sm:p-8">
        <Ring pct={s.percentage} tone={tone} />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          {s.passed !== null && (
            <span
              className={cn(
                "inline-flex rounded-md px-2 py-0.5 text-[12.5px] font-semibold",
                s.passed ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
              )}
            >
              {s.passed ? "Passed" : "Not passed"} (pass mark {s.passPercentage}%)
            </span>
          )}
          <h1 id="score-title" className="mt-2 text-2xl font-semibold tracking-tight text-ink">
            {s.marks} out of {s.maxMarks} marks
          </h1>
          <p className="mt-1.5 text-[15px] text-ink-2">{verdict(s.percentage)}</p>
          {s.negativeMarking > 0 && (
            <p className="mt-1 text-[13px] text-ink-3">
              Negative marking applied: −{s.negativeMarking} for each of {s.incorrect} wrong answer{s.incorrect === 1 ? "" : "s"}.
            </p>
          )}
          {result.autoSubmitted && <p className="mt-1 text-[13px] text-warn">Submitted automatically when time ran out.</p>}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([label, value, color]) => (
          <div key={label} className="bg-surface px-5 py-3.5">
            <dt className="text-[12px] text-ink-3">{label}</dt>
            <dd className={cn("mt-0.5 text-[17px] font-semibold tabular", color ?? "text-ink")}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
