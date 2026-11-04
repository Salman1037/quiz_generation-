"use client";
import { Sparkles } from "lucide-react";
import type { PlanResult } from "@/lib/ai/planning";
import type { ExamSettings } from "@/types/exam";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

function estimateMinutes(requests: number, rpm: number): string {
  // Two requests run at once, each typically 10–25 s, and starts are paced to the per-minute limit.
  const paced = (requests - 1) * (60 / rpm);
  const parallel = Math.ceil(requests / 2) * 18;
  const secs = Math.max(paced + 18, parallel);
  if (secs < 60) return "under a minute";
  const m = Math.round(secs / 60);
  return `about ${m} minute${m === 1 ? "" : "s"}`;
}

export function SummaryPanel({
  settings,
  plan,
  rpm,
  disabledReason,
  onGenerate,
  onUseCapacity,
}: {
  settings: ExamSettings;
  plan: PlanResult | null;
  rpm: number;
  disabledReason: string | null;
  onGenerate: () => void;
  onUseCapacity: (n: number) => void;
}) {
  const requests = plan?.ok ? plan.batches.length : 0;
  const rows: [string, string][] = [
    ["Questions", String(settings.questionCount)],
    ["Difficulty", settings.difficulty[0].toUpperCase() + settings.difficulty.slice(1)],
    ["Answers shown", settings.revealMode === "after" ? "After submitting" : "After each question"],
    ["Timer", settings.timerEnabled ? `${settings.durationMinutes} minutes` : "Off"],
    ["Marking", settings.negativeMarking ? `+1 / −${settings.negativeMarking}` : "+1 per correct answer"],
  ];
  if (settings.passPercentage) rows.push(["Pass mark", `${settings.passPercentage}%`]);

  return (
    <aside aria-label="Paper summary" className="card p-5 sm:p-6">
      <h2 className="text-[15px] font-semibold text-ink">Your paper</h2>
      <dl className="mt-3 divide-y divide-line text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-2">
            <dt className="text-ink-3">{k}</dt>
            <dd className="text-right font-medium text-ink tabular">{v}</dd>
          </div>
        ))}
      </dl>

      {plan?.ok && (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
          {requests} AI request{requests === 1 ? "" : "s"} over {plan.coveredWords.toLocaleString()} words
          {plan.coveredWords < plan.totalWords ? ` sampled evenly from ${plan.totalWords.toLocaleString()}` : ""}. Expect {estimateMinutes(requests, rpm)} on the free tier.
        </p>
      )}

      {plan && !plan.ok && plan.reason === "insufficient" && (
        <Alert
          tone="warn"
          className="mt-4"
          title="Not enough material for that many questions"
          action={
            plan.capacity >= 1 ? (
              <Button size="sm" onClick={() => onUseCapacity(plan.capacity)}>
                Use {plan.capacity} questions
              </Button>
            ) : undefined
          }
        >
          {plan.message} Rather than invent questions, choose fewer or add more material.
        </Alert>
      )}
      {plan && !plan.ok && plan.reason !== "insufficient" && (
        <Alert tone="warn" className="mt-4">
          {plan.message}
        </Alert>
      )}

      <Button variant="primary" size="lg" className="mt-5 w-full" onClick={onGenerate} disabled={Boolean(disabledReason) || !plan?.ok}>
        <Sparkles className="size-[18px]" aria-hidden />
        Generate My MCQ Paper
      </Button>
      {disabledReason && <p className="mt-2.5 text-center text-[13px] text-ink-3">{disabledReason}</p>}
    </aside>
  );
}
