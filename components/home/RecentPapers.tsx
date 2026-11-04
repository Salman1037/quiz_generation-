"use client";
import { useRouter } from "next/navigation";
import { History, Play, Trash2 } from "lucide-react";
import { useExam } from "@/lib/client/exam-store";
import { Button } from "@/components/ui/Button";

export function RecentPapers() {
  const { library, startPaper, removeFromLibrary, session } = useExam();
  const router = useRouter();
  if (!library.length) return null;
  return (
    <section aria-labelledby="recent-title" className="mt-12">
      <h2 id="recent-title" className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        <History className="size-4 text-ink-3" aria-hidden />
        Saved papers
      </h2>
      <p className="mt-1 text-[13px] text-ink-3">Stored in this browser, so you can sit them again without generating anything.</p>
      <ul className="card mt-4 divide-y divide-line">
        {library.map((e) => (
          <li key={e.paper.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{e.paper.title}</p>
              <p className="mt-0.5 text-[13px] text-ink-3">
                {e.paper.totalQuestions} questions, created {new Date(e.paper.createdAt).toLocaleDateString()}
                {e.lastScore !== null && <span className="text-ink-2">, last score {e.lastScore}%</span>}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  if (session?.status === "in-progress" && session.paper.id !== e.paper.id && !window.confirm("Starting this paper ends the exam you have in progress. Continue?")) return;
                  startPaper(e.paper);
                  router.push("/exam");
                }}
              >
                <Play className="size-3.5" aria-hidden />
                Sit paper
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Remove ${e.paper.title}`} onClick={() => removeFromLibrary(e.paper.id)}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
