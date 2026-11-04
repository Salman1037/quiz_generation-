import type { ReactNode } from "react";
import { AlertTriangle, CircleAlert, Info, X } from "lucide-react";
import { cn } from "@/lib/client/cn";

type Tone = "info" | "warn" | "danger";

const tones: Record<Tone, string> = {
  info: "border-accent-line bg-accent-soft/60 text-ink",
  warn: "border-warn-line bg-warn-soft text-ink",
  danger: "border-danger-line bg-danger-soft text-ink",
};
const iconTone: Record<Tone, string> = { info: "text-accent", warn: "text-warn", danger: "text-danger" };

export function Alert({
  tone = "info",
  title,
  children,
  action,
  onDismiss,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const Icon = tone === "danger" ? CircleAlert : tone === "warn" ? AlertTriangle : Info;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-xl border px-4 py-3", tones[tone], className)}>
      <Icon className={cn("mt-0.5 size-[18px] shrink-0", iconTone[tone])} aria-hidden />
      <div className="min-w-0 flex-1 text-sm leading-relaxed">
        {title && <p className="font-semibold text-ink">{title}</p>}
        {children && <div className="text-ink-2">{children}</div>}
        {action && <div className="mt-2.5 flex flex-wrap gap-2">{action}</div>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-mr-1 -mt-0.5 size-7 shrink-0 rounded-md text-ink-3 hover:bg-black/5 hover:text-ink">
          <X className="mx-auto size-4" />
        </button>
      )}
    </div>
  );
}
