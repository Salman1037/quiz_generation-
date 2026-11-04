"use client";
import { usePathname } from "next/navigation";

export function Footer() {
  const pathname = usePathname();
  if (pathname === "/print" || pathname === "/exam") return null;
  return (
    <footer className="no-print border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-[13px] text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>QuizForge AI writes questions only from the material you upload.</p>
        <p>Your documents and results stay in this browser. Nothing is stored on a server.</p>
      </div>
    </footer>
  );
}
