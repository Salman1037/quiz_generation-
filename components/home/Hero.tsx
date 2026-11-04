"use client";
import { motion, useReducedMotion } from "framer-motion";

// One answer-sheet row per question; the filled bubble is the chosen answer.
const ROWS = [1, 3, 0, 2, 1];

/** The page's single motion moment: bubbles on an answer sheet fill in, row by row. */
function AnswerSheet() {
  const reduce = useReducedMotion();
  return (
    <div className="card hairline-grid relative hidden w-[17rem] shrink-0 p-5 lg:block" aria-hidden>
      <div className="mb-3 flex items-center justify-between text-[11px] font-medium text-ink-3">
        <span>Answer sheet</span>
        <span className="tabular">5 / 50</span>
      </div>
      <div className="space-y-2.5">
        {ROWS.map((pick, r) => (
          <div key={r} className="flex items-center gap-3">
            <span className="w-5 text-right text-[12px] font-medium text-ink-3 tabular">{r + 1}</span>
            {["A", "B", "C", "D"].map((l, c) => (
              <span key={l} className="relative grid size-7 place-items-center rounded-full border border-line-strong bg-surface text-[11px] font-semibold text-ink-3">
                {l}
                {c === pick && (
                  <motion.span
                    className="absolute inset-[-1px] grid place-items-center rounded-full bg-accent text-white"
                    initial={reduce ? false : { scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: reduce ? 0 : 0.45 + r * 0.22, type: "spring", stiffness: 520, damping: 26 }}
                  >
                    {l}
                  </motion.span>
                )}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="flex items-center justify-between gap-10 pb-8 pt-10 sm:pt-14">
      <div className="max-w-xl">
        <h1 className="text-[2rem] font-semibold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[2.5rem]">
          Turn your books into intelligent examinations.
        </h1>
        <p className="mt-4 max-w-[34rem] text-[15.5px] leading-relaxed text-ink-2">
          Upload a textbook, lecture notes or a whole book. QuizForge AI writes multiple-choice questions from that material only,
          checks each one against the text, and lets you sit the paper here with instant marking.
        </p>
      </div>
      <AnswerSheet />
    </section>
  );
}
