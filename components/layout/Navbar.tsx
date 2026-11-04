"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/ui/Logo";
import { useExam } from "@/lib/client/exam-store";
import { useWorkspace } from "@/lib/client/workspace";
import { cn } from "@/lib/client/cn";

export function Navbar() {
  const pathname = usePathname();
  const { session, hydrated } = useExam();
  const { health } = useWorkspace();
  if (pathname === "/print") return null;

  const links = [
    { href: "/", label: "Workspace", show: true },
    { href: "/exam", label: session?.status === "submitted" ? "Review exam" : "Exam", show: hydrated && Boolean(session) },
    { href: "/results", label: "Results", show: hydrated && session?.status === "submitted" },
  ].filter((l) => l.show);

  const connected = health.status === "ready" && health.info.configured;

  return (
    <header className="no-print sticky top-0 z-40 border-b border-line/80 bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-lg" aria-label="QuizForge AI home">
          <LogoMark />
          <span className="text-[15px] font-semibold tracking-tight text-ink">QuizForge AI</span>
        </Link>
        <nav aria-label="Main" className="ml-2 flex items-center gap-1 overflow-x-auto">
          {links.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                  active ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-3 hover:text-ink",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto hidden items-center gap-2 text-[13px] text-ink-3 md:flex">
          {health.status === "ready" && (
            <>
              <span className={cn("size-2 rounded-full", connected ? "bg-success" : "bg-warn")} aria-hidden />
              <span>{connected ? `Connected to ${health.info.model}` : "API key needed"}</span>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
