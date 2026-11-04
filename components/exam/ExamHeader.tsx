"use client";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ExamTimer } from "./ExamTimer";

export function ExamHeader({
  title,
  total,
  answered,
  deadline,
  totalSec,
  onExpire,
  onSubmit,
  submitted,
  onResults,
}: {
  title: string;
  total: number;
  answered: number;
  deadline: number | null;
  totalSec: number;
  onExpire: () => void;
  onSubmit: () => void;
  submitted: boolean;
  onResults: () => void;
}) {
  return (
    <div className="no-print sticky top-14 z-30 border-b border-line bg-canvas/90 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink" title={title}>
              {title}
            </p>
            <p className="text-[12.5px] text-ink-3 tabular">
              {submitted ? `Reviewing ${total} questions` : `${answered} of ${total} answered`}
            </p>
          </div>
          {!submitted && deadline && <ExamTimer deadline={deadline} totalSec={totalSec} onExpire={onExpire} />}
          {submitted ? (
            <Button variant="primary" onClick={onResults}>
              View results
            </Button>
          ) : (
            <Button variant="primary" onClick={onSubmit}>
              <Send className="size-4" aria-hidden />
              <span className="hidden sm:inline">Submit examination</span>
              <span className="sm:hidden">Submit</span>
            </Button>
          )}
        </div>
        <ProgressBar className="mt-3" value={answered / Math.max(1, total)} label="Questions answered" tone={submitted ? "success" : "accent"} />
      </div>
    </div>
  );
}
