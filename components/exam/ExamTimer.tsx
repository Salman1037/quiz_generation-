"use client";
import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { formatDuration, isLowTime, remainingSeconds } from "@/lib/exam/utilities";
import { cn } from "@/lib/client/cn";

/**
 * Countdown derived from the stored deadline on every tick, so it stays correct across
 * refreshes, background tabs and throttled timers.
 */
export function ExamTimer({ deadline, totalSec, onExpire }: { deadline: number; totalSec: number; onExpire: () => void }) {
  const [left, setLeft] = useState(() => remainingSeconds(deadline));
  const fired = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    const tick = () => {
      const r = remainingSeconds(deadline);
      setLeft(r);
      if (r === 300 || r === 60) setAnnounce(`${r / 60} minute${r === 60 ? "" : "s"} remaining`);
      if (r <= 0 && !fired.current) {
        fired.current = true;
        onExpireRef.current();
      }
    };
    tick();
    const t = setInterval(tick, 250);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [deadline]);

  const low = isLowTime(left, totalSec);
  const critical = left <= 30;
  return (
    <div
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold tabular transition-colors",
        critical ? "border-danger bg-danger text-white" : low ? "border-warn-line bg-warn-soft text-warn" : "border-line bg-surface text-ink",
      )}
      role="timer"
      aria-label={`Time remaining ${formatDuration(left)}`}
    >
      <Clock className={cn("size-4", critical && "animate-pulse")} aria-hidden />
      {formatDuration(left)}
      <span className="sr-only" aria-live="assertive">
        {announce}
      </span>
    </div>
  );
}
