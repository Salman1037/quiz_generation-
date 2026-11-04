"use client";
import type { ExamSession } from "@/types/exam";
import { cn } from "@/lib/client/cn";

/** The answer sheet: one bubble per question showing answered, current, marked and (after submit) right/wrong. */
export function QuestionNavigation({ session, onJump }: { session: ExamSession; onJump: (index: number) => void }) {
  const answered = session.order.filter((id) => session.answers[id]).length;
  const marked = session.order.filter((id) => session.marked[id]).length;
  const result = session.result;

  return (
    <div>
      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line text-center">
        {[
          ["Answered", answered],
          ["Remaining", session.order.length - answered],
          ["Marked", marked],
        ].map(([label, v]) => (
          <div key={label} className="bg-surface px-2 py-2">
            <dt className="text-[11.5px] text-ink-3">{label}</dt>
            <dd className="text-[15px] font-semibold text-ink tabular">{v}</dd>
          </div>
        ))}
      </dl>

      <nav aria-label="Question navigator" className="mt-4">
        <ol className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1.5">
          {session.order.map((id, i) => {
            const isCurrent = i === session.current;
            const isAnswered = Boolean(session.answers[id]);
            const isMarked = session.marked[id];
            const status = result?.perQuestion[id]?.status ?? (session.revealed[id] ? (session.answers[id] === session.revealed[id].correctAnswer ? "correct" : "incorrect") : null);
            const label = `Question ${i + 1}${status ? `, ${status}` : isAnswered ? ", answered" : ", not answered"}${isMarked ? ", marked for review" : ""}`;
            return (
              <li key={id} className="relative">
                <button
                  type="button"
                  onClick={() => onJump(i)}
                  aria-label={label}
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "grid aspect-square w-full place-items-center rounded-full border-[1.5px] text-[12px] font-semibold tabular transition-colors duration-150",
                    status === "correct" && "border-success bg-success text-white",
                    status === "incorrect" && "border-danger bg-danger text-white",
                    status === "unanswered" && "border-line-strong bg-sunken text-ink-3",
                    !status && isAnswered && "border-accent bg-accent text-white",
                    !status && !isAnswered && "border-line-strong bg-surface text-ink-2 hover:border-ink-3",
                    isCurrent && "ring-2 ring-ink ring-offset-2 ring-offset-surface",
                  )}
                >
                  {i + 1}
                </button>
                {isMarked && <span className="pointer-events-none absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface bg-warn" aria-hidden />}
              </li>
            );
          })}
        </ol>
      </nav>

      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-ink-3" aria-label="Legend">
        {result ? (
          <>
            <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-success" />Correct</li>
            <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-danger" />Incorrect</li>
            <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border border-line-strong bg-sunken" />Unanswered</li>
          </>
        ) : (
          <>
            <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-accent" />Answered</li>
            <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border border-line-strong bg-surface" />Not answered</li>
            <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-warn" />Marked</li>
          </>
        )}
      </ul>
    </div>
  );
}
