"use client";
import type { ExamSession } from "@/types/exam";
import { cn } from "@/lib/client/cn";

interface Bucket {
  label: string;
  correct: number;
  total: number;
}

function accuracyRows(buckets: Bucket[]) {
  return buckets.map((b) => ({ ...b, pct: b.total ? Math.round((b.correct / b.total) * 100) : 0 }));
}

function Bars({ title, rows, empty }: { title: string; rows: (Bucket & { pct: number })[]; empty?: string }) {
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {rows.length === 0 && <p className="mt-3 text-[13px] text-ink-3">{empty}</p>}
      <ul className="mt-4 space-y-3.5">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
              <span className="truncate font-medium capitalize text-ink-2" title={r.label}>
                {r.label}
              </span>
              <span className="shrink-0 text-ink-3 tabular">
                {r.correct}/{r.total} <span className="font-semibold text-ink">{r.pct}%</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${r.label}: ${r.pct}% correct`}>
              <div
                className={cn("h-full rounded-full", r.pct >= 75 ? "bg-success" : r.pct >= 50 ? "bg-warn" : "bg-danger")}
                style={{ width: `${Math.max(r.pct, 2)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PerformanceChart({ session }: { session: ExamSession }) {
  const result = session.result!;
  const s = result.summary;
  const qs = session.paper.questions;
  const by = (keyFn: (q: (typeof qs)[number]) => string) => {
    const map = new Map<string, Bucket>();
    for (const q of qs) {
      const k = keyFn(q);
      const b = map.get(k) ?? { label: k, correct: 0, total: 0 };
      b.total++;
      if (result.perQuestion[q.id]?.status === "correct") b.correct++;
      map.set(k, b);
    }
    return [...map.values()];
  };
  const order = ["easy", "medium", "hard"];
  const difficulty = accuracyRows(by((q) => q.difficulty)).sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  const sources = accuracyRows(by((q) => q.source))
    .sort((a, b) => a.pct - b.pct || b.total - a.total)
    .slice(0, 8);

  const segments = [
    { label: "Correct", value: s.correct, cls: "bg-success" },
    { label: "Incorrect", value: s.incorrect, cls: "bg-danger" },
    { label: "Unanswered", value: s.unanswered, cls: "bg-line-strong" },
  ];

  return (
    <section aria-labelledby="perf-title" className="space-y-4">
      <h2 id="perf-title" className="text-[15px] font-semibold text-ink">
        Performance
      </h2>
      <div className="card p-5">
        <div className="flex h-3 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${s.correct} correct, ${s.incorrect} incorrect, ${s.unanswered} unanswered`}>
          {segments.map((seg) =>
            seg.value ? <div key={seg.label} className={seg.cls} style={{ width: `${(seg.value / s.total) * 100}%` }} /> : null,
          )}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-2">
          {segments.map((seg) => (
            <li key={seg.label} className="flex items-center gap-1.5 tabular">
              <span className={cn("size-2.5 rounded-full", seg.cls)} aria-hidden />
              {seg.label} {seg.value} ({Math.round((seg.value / Math.max(1, s.total)) * 100)}%)
            </li>
          ))}
        </ul>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Bars title="Accuracy by difficulty" rows={difficulty} />
        <Bars title={sources.length > 1 ? "Weakest sections first" : "Accuracy by section"} rows={sources} empty="No section data." />
      </div>
    </section>
  );
}
