"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileDown, FileKey2, FileText, Plus, Printer, RotateCcw } from "lucide-react";
import { useExam } from "@/lib/client/exam-store";
import { ScoreCard } from "@/components/results/ScoreCard";
import { PerformanceChart } from "@/components/results/PerformanceChart";
import { AnswerReview } from "@/components/results/AnswerReview";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

type ExportKind = "paper" | "key" | "report";

export default function ResultsPage() {
  const router = useRouter();
  const { session, hydrated, retake } = useExam();
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6" aria-busy>
        <div className="card h-64 animate-pulse bg-sunken/50" />
      </div>
    );
  }

  if (!session || session.status !== "submitted" || !session.result) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">No results yet</h1>
        <p className="mt-2 text-ink-2">{session ? "Submit your examination to see your results." : "Generate a paper and sit the examination first."}</p>
        <Link
          href={session ? "/exam" : "/"}
          className="mt-6 inline-flex h-10 items-center rounded-[10px] bg-accent px-4 text-sm font-medium text-white hover:bg-accent-strong"
        >
          {session ? "Back to the exam" : "Go to workspace"}
        </Link>
      </div>
    );
  }

  const result = session.result;
  const run = async (kind: ExportKind) => {
    setBusy(kind);
    setExportError(null);
    try {
      const pdf = await import("@/lib/export/pdf");
      if (kind === "paper") await pdf.exportQuestionPaper(session.paper, session.order);
      if (kind === "key") await pdf.exportQuestionPaper(session.paper, session.order, result.perQuestion);
      if (kind === "report") await pdf.exportResultReport(session);
    } catch {
      setExportError("The PDF couldn’t be created. Try the print view instead.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 pb-16 pt-8 sm:px-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] text-ink-3">
            Attempt {session.attempt}, submitted {new Date(result.submittedAt).toLocaleString()}
          </p>
          <p className="truncate text-sm font-medium text-ink-2" title={session.paper.title}>
            {session.paper.title}
          </p>
        </div>
      </div>

      <ScoreCard result={result} />

      <div className="no-print flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={() => {
            retake();
            router.push("/exam");
          }}
        >
          <RotateCcw className="size-4" aria-hidden />
          Retake this paper
        </Button>
        <Button onClick={() => router.push("/")}>
          <Plus className="size-4" aria-hidden />
          Generate a new paper
        </Button>
      </div>

      <PerformanceChart session={session} />

      <section aria-labelledby="export-title" className="no-print">
        <h2 id="export-title" className="text-[15px] font-semibold text-ink">
          Download and print
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            { kind: "paper" as const, icon: FileText, title: "Question paper", body: "Questions and options only, ready to hand out." },
            { kind: "key" as const, icon: FileKey2, title: "Paper with answer key", body: "Correct answers marked, with explanations." },
            { kind: "report" as const, icon: FileDown, title: "Result report", body: "Your score, every answer and the corrections." },
          ].map((x) => (
            <button
              key={x.kind}
              type="button"
              onClick={() => run(x.kind)}
              disabled={busy !== null}
              className="card flex items-start gap-3 p-4 text-left transition-colors hover:border-line-strong disabled:opacity-60"
            >
              <x.icon className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
              <span>
                <span className="block text-sm font-medium text-ink">{busy === x.kind ? "Creating PDF…" : `${x.title} (PDF)`}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-ink-3">{x.body}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
          <Printer className="size-4" aria-hidden />
          Print view:
          <Link className="font-medium text-accent hover:underline" href="/print?mode=paper" target="_blank">
            question paper
          </Link>
          <Link className="font-medium text-accent hover:underline" href="/print?mode=key" target="_blank">
            with answer key
          </Link>
          <Link className="font-medium text-accent hover:underline" href="/print?mode=report" target="_blank">
            result report
          </Link>
          <span>(supports every language and script)</span>
        </div>
        {exportError && (
          <Alert tone="danger" className="mt-3">
            {exportError}
          </Alert>
        )}
      </section>

      <AnswerReview session={session} />
    </div>
  );
}
