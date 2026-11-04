"use client";
import { Check, X } from "lucide-react";
import type { AnswerOptionData } from "@/types/exam";
import { cn } from "@/lib/client/cn";

export type OptionState = "idle" | "selected" | "correct" | "wrong" | "missed-correct" | "dim";

/**
 * One answer choice. A native radio input keeps it keyboard- and screen-reader-friendly;
 * the visible part is an answer-sheet bubble plus the option text.
 */
export function AnswerOption({
  name,
  option,
  state,
  checked,
  disabled,
  onSelect,
}: {
  name: string;
  option: AnswerOptionData;
  state: OptionState;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const note = state === "correct" ? "Your answer is correct" : state === "wrong" ? "Your answer" : state === "missed-correct" ? "Correct answer" : null;

  return (
    <label
      className={cn(
        "group relative flex items-start gap-4 rounded-xl border px-4 py-3.5 transition-[border-color,background-color,box-shadow] duration-150 sm:px-5 sm:py-4",
        disabled ? "cursor-default" : "cursor-pointer",
        state === "idle" && "border-line bg-surface hover:border-line-strong hover:bg-sunken/40",
        state === "selected" && "border-accent bg-accent-soft/55 shadow-[0_0_0_1px_var(--color-accent)]",
        (state === "correct" || state === "missed-correct") && "border-success bg-success-soft shadow-[0_0_0_1px_var(--color-success)]",
        state === "wrong" && "border-danger bg-danger-soft shadow-[0_0_0_1px_var(--color-danger)]",
        state === "dim" && "border-line bg-surface opacity-70",
      )}
    >
      <input
        type="radio"
        name={name}
        value={option.id}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full border-[1.5px] text-[13px] font-semibold transition-colors duration-150",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2",
          state === "idle" && "border-line-strong text-ink-2 group-hover:border-ink-3",
          state === "dim" && "border-line-strong text-ink-3",
          state === "selected" && "border-accent bg-accent text-white",
          (state === "correct" || state === "missed-correct") && "border-success bg-success text-white",
          state === "wrong" && "border-danger bg-danger text-white",
        )}
      >
        {state === "correct" || state === "missed-correct" ? (
          <Check className="size-4" strokeWidth={3} />
        ) : state === "wrong" ? (
          <X className="size-4" strokeWidth={3} />
        ) : (
          option.id
        )}
      </span>
      <span className="min-w-0 flex-1 pt-1">
        <span className="block text-[15px] leading-relaxed text-ink">
          <span className="sr-only">Option {option.id}: </span>
          {option.text}
        </span>
        {note && (
          <span
            className={cn(
              "mt-1 block text-[12.5px] font-semibold",
              state === "wrong" ? "text-danger" : "text-success",
            )}
          >
            {note}
          </span>
        )}
      </span>
    </label>
  );
}
