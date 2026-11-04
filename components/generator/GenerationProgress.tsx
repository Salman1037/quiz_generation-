"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import type { GenerationProgress as Progress } from "@/lib/client/generate";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { cn } from "@/lib/client/cn";

type StepState = "done" | "active" | "pending";

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular">{Math.max(0, Math.ceil((until - now) / 1000))} s</span>;
}

export function GenerationProgressPanel({
  progress,
  error,
  onCancel,
  onRetry,
  onClose,
}: {
  progress: Progress | null;
  error: { title: string; message: string; hint: string } | null;
  onCancel: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const stage = progress?.stage ?? "planning";
  const order = ["planning", "generating", "topping-up", "finalizing", "done"];
  const at = order.indexOf(stage);
  const state = (i: number): StepState => (at > i ? "done" : at === i ? "active" : "pending");
  const generatingState: StepState = at > 2 ? "done" : at >= 1 ? "active" : "pending";
  const steps: { label: string; detail?: string; state: StepState }[] = [
    { label: "Plan which passages each request covers", state: state(0) },
    {
      label: "Write and verify questions",
      detail: progress && at >= 1 ? `${progress.batchesDone} of ${progress.batchesTotal} requests done, ${progress.questionsReady} of ${progress.requested} questions passed checks` : undefined,
      state: generatingState,
    },
    { label: "Remove duplicates and build the paper", state: at === 3 ? "active" : at > 3 ? "done" : "pending" },
  ];
  const fraction = progress ? Math.min(1, progress.questionsReady / Math.max(1, progress.requested)) : 0;

  return (
    <motion.section
      aria-labelledby="gen-title"
      aria-live="polite"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="card mx-auto w-full max-w-xl p-6 sm:p-8"
    >
      {error ? (
        <>
          <h2 id="gen-title" className="text-lg font-semibold tracking-tight">
            Generation stopped
          </h2>
          <Alert tone="danger" className="mt-4" title={error.title}>
            {error.message} {error.hint}
          </Alert>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={onClose}>Back to settings</Button>
            <Button variant="primary" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </>
      ) : (
        <>
          <h2 id="gen-title" className="text-lg font-semibold tracking-tight">
            Writing your examination
          </h2>
          <p className="mt-1 text-sm text-ink-2">Each question is checked against your material before it is kept.</p>
          <div className="mt-6">
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <span className="font-medium text-ink tabular">
                {progress?.questionsReady ?? 0} / {progress?.requested ?? 0} questions
              </span>
              {progress && progress.coveragePct < 100 && <span className="text-[12px] text-ink-3">Sampling {progress.coveragePct}% of the text evenly</span>}
            </div>
            <ProgressBar value={fraction} label="Questions generated" />
          </div>
          <ol className="mt-6 space-y-3.5">
            {steps.map((s) => (
              <li key={s.label} className="flex gap-3">
                <span
                  className={cn(
                    "mt-px grid size-5 shrink-0 place-items-center rounded-full border",
                    s.state === "done" && "border-success bg-success text-white",
                    s.state === "active" && "border-accent text-accent",
                    s.state === "pending" && "border-line-strong text-transparent",
                  )}
                  aria-hidden
                >
                  {s.state === "done" ? <Check className="size-3" strokeWidth={3} /> : s.state === "active" ? <Loader2 className="size-3 animate-spin" /> : null}
                </span>
                <div>
                  <p className={cn("text-sm", s.state === "pending" ? "text-ink-3" : "font-medium text-ink")}>{s.label}</p>
                  {s.detail && <p className="mt-0.5 text-[13px] text-ink-3 tabular">{s.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
          {progress?.note && (
            <p className="mt-5 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-ink-2">
              {progress.note} {progress.waitingUntil && <>Resuming in <Countdown until={progress.waitingUntil} />.</>}
            </p>
          )}
          {progress && progress.batchesFailed > 0 && (
            <p className="mt-3 text-[13px] text-warn">
              {progress.batchesFailed} request{progress.batchesFailed === 1 ? "" : "s"} failed and will be made up from other passages where possible.
            </p>
          )}
          <div className="mt-6 flex justify-end">
            <Button variant="ghost" onClick={onCancel} disabled={stage === "finalizing" || stage === "done"}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </motion.section>
  );
}
