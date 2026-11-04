import { cn } from "@/lib/client/cn";

export function ProgressBar({ value, label, className, tone = "accent" }: { value: number; label: string; className?: string; tone?: "accent" | "success" }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-sunken", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", tone === "accent" ? "bg-accent" : "bg-success")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
