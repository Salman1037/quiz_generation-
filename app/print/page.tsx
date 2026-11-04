"use client";
import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import { useExam } from "@/lib/client/exam-store";
import { formatDurationWords } from "@/lib/exam/utilities";

type Mode = "paper" | "key" | "report";

function PrintView() {
  const params = useSearchParams();
  const mode = (params.get("mode") as Mode) || "paper";
  const { session, hydrated } = useExam();
  const printed = useRef(false);

  const needsResult = mode !== "paper";
  const ready = hydrated && session && (!needsResult || session.result);

  useEffect(() => {
    if (ready && !printed.current && params.get("auto") !== "0") {
      printed.current = true;
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [ready, params]);

  if (!hydrated) return null;
  if (!session || (needsResult && !session.result)) {
    return (
      <div className="mx-auto max-w-lg px-6 py-20 text-center">
        <p className="text-ink-2">{session ? "Submit the examination first to print answers." : "There’s no paper to print yet."}</p>
        <Link href="/" className="mt-4 inline-block font-medium text-accent hover:underline">
          Go to workspace
        </Link>
      </div>
    );
  }

  const { paper, result } = session;
  const byId = new Map(paper.questions.map((q) => [q.id, q]));
  const questions = session.order.map((id) => byId.get(id)!).filter(Boolean);
  const s = paper.settings;
  const title = mode === "paper" ? paper.title : mode === "key" ? `${paper.title} (answer key)` : `Result report: ${paper.title}`;

  return (
    <div className="print-sheet mx-auto max-w-[210mm] bg-white px-8 py-10 text-[11pt] leading-relaxed text-ink print:p-0">
      <style>{`@page { size: A4; margin: 16mm; } @media print { .print-q { break-inside: avoid; } }`}</style>
      <div className="no-print mb-6 flex items-center justify-between rounded-xl border border-line bg-canvas px-4 py-3 text-sm">
        <span className="text-ink-2">Use your browser’s print dialog and choose “Save as PDF” to keep a copy.</span>
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 font-medium text-white">
          <Printer className="size-4" aria-hidden />
          Print
        </button>
      </div>

      <header className="border-b border-line pb-4">
        <h1 className="text-[17pt] font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-[9.5pt] text-ink-3">
          {paper.totalQuestions} questions, total marks {paper.totalQuestions * s.marksPerQuestion}
          {s.negativeMarking ? `, −${s.negativeMarking} per wrong answer` : ""}
          {s.timerEnabled ? `, ${s.durationMinutes} minutes` : ""}
        </p>
        {mode === "paper" && <p className="mt-4 text-[10pt]">Name: ______________________________ &nbsp;&nbsp; Date: ________________</p>}
        {mode === "report" && result && (
          <p className="mt-3 text-[12pt] font-semibold">
            Score {result.summary.marks} / {result.summary.maxMarks} ({result.summary.percentage}%). Correct {result.summary.correct}, incorrect{" "}
            {result.summary.incorrect}, unanswered {result.summary.unanswered}. Time {formatDurationWords(result.timeTakenSec)}.
          </p>
        )}
      </header>

      <ol className="mt-6 space-y-5">
        {questions.map((q, i) => {
          const r = result?.perQuestion[q.id];
          return (
            <li key={q.id} className="print-q">
              <p className="font-semibold">
                <span className="mr-1.5 text-accent tabular">{i + 1}.</span>
                {q.question}
              </p>
              {mode === "report" && r && (
                <p className={`mt-0.5 text-[9.5pt] font-semibold ${r.status === "correct" ? "text-success" : r.status === "incorrect" ? "text-danger" : "text-ink-3"}`}>
                  {r.status === "correct" ? "Correct" : r.status === "incorrect" ? "Incorrect" : "Not answered"}
                </p>
              )}
              <ul className="mt-1.5 space-y-1 pl-6">
                {q.options.map((o) => {
                  const correct = mode !== "paper" && r?.correctAnswer === o.id;
                  const picked = mode === "report" && r?.selected === o.id;
                  return (
                    <li key={o.id} className={correct ? "font-semibold text-success" : picked ? "font-semibold text-danger" : ""}>
                      {o.id}. {o.text}
                      {correct && (picked ? " (your answer, correct)" : " (correct answer)")}
                      {picked && !correct && " (your answer)"}
                    </li>
                  );
                })}
              </ul>
              {mode !== "paper" && r?.explanation && <p className="mt-1 pl-6 text-[9.5pt] italic text-ink-3">{r.explanation}</p>}
            </li>
          );
        })}
      </ol>
      {mode === "key" && result && (
        <section className="print-q mt-8 border-t border-line pt-4">
          <h2 className="font-semibold">Answer key</h2>
          <p className="mt-2 text-[10pt] tabular">
            {questions.map((q, i) => `${i + 1}–${result.perQuestion[q.id]?.correctAnswer ?? "?"}`).join("   ")}
          </p>
        </section>
      )}
    </div>
  );
}

export default function PrintPage() {
  return (
    <Suspense fallback={null}>
      <PrintView />
    </Suspense>
  );
}
