"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Eraser, FileDown, Flag, Grid3x3, Keyboard, X } from "lucide-react";
import { useExam } from "@/lib/client/exam-store";
import { ExamHeader } from "@/components/exam/ExamHeader";
import { QuestionCard } from "@/components/exam/QuestionCard";
import { QuestionNavigation } from "@/components/exam/QuestionNavigation";
import { SubmitDialog } from "@/components/exam/SubmitDialog";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { presentError } from "@/lib/client/errors";
import type { OptionId, RevealedAnswer } from "@/types/exam";
import { cn } from "@/lib/client/cn";

const KEY_TO_OPTION: Record<string, OptionId> = { a: "A", b: "B", c: "C", d: "D", "1": "A", "2": "B", "3": "C", "4": "D" };

export default function ExamPage() {
  const router = useRouter();
  const exam = useExam();
  const { session, hydrated } = exam;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const direction = useRef(1);
  const autoTried = useRef(false);

  const submitted = session?.status === "submitted";
  const submitting = session?.status === "submitting";

  const doSubmit = useCallback(
    async (auto = false) => {
      setSubmitError(null);
      try {
        await exam.submit({ auto });
        setDialogOpen(false);
        router.push("/results");
      } catch (err) {
        const p = presentError(err);
        setSubmitError(`${p.title}. ${p.message} ${p.hint}`);
        if (auto) setDialogOpen(true);
      }
    },
    [exam, router],
  );

  // If the deadline passed while the tab was closed, submit as soon as the exam is restored.
  useEffect(() => {
    if (!hydrated || !session || session.status !== "in-progress" || !session.deadline || autoTried.current) return;
    if (Date.now() >= session.deadline) {
      autoTried.current = true;
      void doSubmit(true);
    }
  }, [hydrated, session, doSubmit]);

  const go = useCallback(
    (index: number) => {
      if (!session) return;
      direction.current = index >= session.current ? 1 : -1;
      exam.goTo(index);
      setSheetOpen(false);
    },
    [exam, session],
  );

  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      if (dialogOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" && (e.target as HTMLInputElement).type !== "radio") return;
      if (tag === "TEXTAREA" || tag === "SELECT") return;
      const id = session.order[session.current];
      const k = e.key.toLowerCase();
      if (k === "arrowright" && tag !== "INPUT") {
        e.preventDefault();
        go(session.current + 1);
      } else if (k === "arrowleft" && tag !== "INPUT") {
        e.preventDefault();
        go(session.current - 1);
      } else if (KEY_TO_OPTION[k] && session.status === "in-progress") {
        exam.select(id, KEY_TO_OPTION[k]);
      } else if (k === "m" && session.status === "in-progress") {
        exam.toggleMark(id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, dialogOpen, go, exam]);

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6" aria-busy>
        <div className="card h-80 animate-pulse bg-sunken/50" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">No examination yet</h1>
        <p className="mt-2 text-ink-2">Upload your material and generate a paper to start an examination.</p>
        <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-[10px] bg-accent px-4 text-sm font-medium text-white hover:bg-accent-strong">
          Go to workspace
        </Link>
      </div>
    );
  }

  const { paper } = session;
  const qById = new Map(paper.questions.map((q) => [q.id, q]));
  const currentId = session.order[session.current];
  const question = qById.get(currentId)!;
  const answered = session.order.filter((id) => session.answers[id]).length;
  const unanswered = session.order.length - answered;
  const marked = session.order.filter((id) => session.marked[id]).length;
  const resultEntry = session.result?.perQuestion[currentId];
  const revealed: RevealedAnswer | undefined = resultEntry
    ? { correctAnswer: resultEntry.correctAnswer, explanation: resultEntry.explanation }
    : session.revealed[currentId];
  const locked = submitted || submitting || (paper.settings.revealMode === "immediate" && Boolean(session.answers[currentId]));
  const isLast = session.current === session.order.length - 1;

  const exportPaper = async () => {
    setExporting(true);
    try {
      const { exportQuestionPaper } = await import("@/lib/export/pdf");
      await exportQuestionPaper(paper, session.order);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <ExamHeader
        title={paper.title}
        total={session.order.length}
        answered={answered}
        deadline={session.deadline}
        totalSec={paper.settings.durationMinutes * 60}
        onExpire={() => {
          if (!autoTried.current) {
            autoTried.current = true;
            void doSubmit(true);
          }
        }}
        onSubmit={() => {
          setSubmitError(null);
          setDialogOpen(true);
        }}
        submitted={submitted}
        onResults={() => router.push("/results")}
      />

      <div className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12">
        {paper.notice && !noticeDismissed && (
          <Alert tone="warn" className="mb-5" onDismiss={() => setNoticeDismissed(true)}>
            {paper.notice}
          </Alert>
        )}
        {submitted && (
          <Alert tone="info" className="mb-5" title="This examination has been submitted">
            You’re reviewing your answers. Correct answers are shown in green and wrong choices in red.
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18.5rem]">
          <div className="min-w-0">
            <AnimatePresence mode="wait" initial={false} custom={direction.current}>
              <motion.div
                key={currentId}
                custom={direction.current}
                initial={{ opacity: 0, x: direction.current * 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction.current * -16 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
              >
                <QuestionCard
                  question={question}
                  index={session.current}
                  total={session.order.length}
                  selected={session.answers[currentId]}
                  revealed={revealed}
                  locked={locked}
                  marked={Boolean(session.marked[currentId])}
                  onSelect={(opt) => exam.select(currentId, opt)}
                />
              </motion.div>
            </AnimatePresence>

            <div className="no-print mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={() => go(session.current - 1)} disabled={session.current === 0}>
                <ChevronLeft className="size-4" aria-hidden />
                Previous
              </Button>
              {!submitted && (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => exam.toggleMark(currentId)}
                    aria-pressed={Boolean(session.marked[currentId])}
                    className={cn(session.marked[currentId] && "bg-warn-soft text-warn hover:bg-warn-soft")}
                  >
                    <Flag className="size-4" aria-hidden />
                    {session.marked[currentId] ? "Marked" : "Mark for review"}
                  </Button>
                  <Button variant="ghost" onClick={() => exam.clearAnswer(currentId)} disabled={!session.answers[currentId] || locked}>
                    <Eraser className="size-4" aria-hidden />
                    Clear answer
                  </Button>
                </>
              )}
              <div className="ml-auto">
                {isLast && !submitted ? (
                  <Button variant="primary" onClick={() => setDialogOpen(true)}>
                    Finish and submit
                  </Button>
                ) : (
                  <Button variant={submitted ? "secondary" : "primary"} onClick={() => go(session.current + 1)} disabled={isLast}>
                    Next
                    <ChevronRight className="size-4" aria-hidden />
                  </Button>
                )}
              </div>
            </div>

            <p className="no-print mt-5 hidden items-center gap-2 text-[12.5px] text-ink-3 sm:flex">
              <Keyboard className="size-3.5" aria-hidden />
              Keys A–D or 1–4 choose an answer, arrow keys move between questions, M marks for review.
            </p>
          </div>

          <aside className="no-print hidden lg:block" aria-label="Answer sheet">
            <div className="card sticky top-40 p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink">Answer sheet</h2>
              <QuestionNavigation session={session} onJump={go} />
              <div className="mt-4 border-t border-line pt-3">
                <Button size="sm" variant="ghost" className="w-full" onClick={exportPaper} loading={exporting}>
                  <FileDown className="size-4" aria-hidden />
                  Download question paper
                </Button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile answer sheet */}
      <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-md lg:hidden" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <Button className="w-full" onClick={() => setSheetOpen(true)} aria-expanded={sheetOpen}>
          <Grid3x3 className="size-4" aria-hidden />
          Answer sheet: {answered} answered, {unanswered} left{marked ? `, ${marked} marked` : ""}
        </Button>
      </div>
      <AnimatePresence>
        {sheetOpen && (
          <motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/35" onClick={() => setSheetOpen(false)} aria-hidden />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Answer sheet"
              className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl bg-surface p-5"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
              style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Answer sheet</h2>
                <button type="button" className="grid size-8 place-items-center rounded-lg hover:bg-sunken" onClick={() => setSheetOpen(false)} aria-label="Close answer sheet">
                  <X className="size-4" />
                </button>
              </div>
              <QuestionNavigation session={session} onJump={go} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <SubmitDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onConfirm={() => void doSubmit(false)}
        total={session.order.length}
        unanswered={unanswered}
        marked={marked}
        submitting={submitting}
        error={submitError}
      />
    </>
  );
}
