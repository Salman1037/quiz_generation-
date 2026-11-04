"use client";
import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { MAX_FILES } from "@/lib/documents/limits";

const ACCEPT = ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

export function FileUploader({ onFiles, maxMb, compact }: { onFiles: (files: File[]) => void; maxMb: number; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
      className={cn(
        "relative rounded-2xl border-[1.5px] border-dashed transition-colors duration-150",
        over ? "border-accent bg-accent-soft/70" : "border-line-strong bg-surface hover:border-ink-3",
        compact ? "px-4 py-5" : "px-6 py-10 sm:py-12",
      )}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
      <div className={cn("flex items-center gap-4", compact ? "flex-row" : "flex-col text-center")}>
        <span
          className={cn(
            "grid shrink-0 place-items-center rounded-xl border border-line bg-canvas text-accent",
            compact ? "size-10" : "size-12",
          )}
          aria-hidden
        >
          <UploadCloud className={compact ? "size-5" : "size-6"} />
        </span>
        <div className={cn("min-w-0", compact && "flex-1")}>
          <p className="text-[15px] font-medium text-ink">
            {over ? "Drop to add these files" : compact ? "Add more material" : "Drop your book or notes here"}
          </p>
          <p className="mt-1 text-[13px] text-ink-3">
            PDF, DOCX or TXT, up to {maxMb} MB each, {MAX_FILES} files at a time
          </p>
        </div>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={cn(
            "inline-flex h-10 items-center rounded-[10px] border border-line-strong bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink-3 hover:bg-sunken",
            !compact && "mt-1",
          )}
        >
          Choose files
        </button>
      </div>
    </div>
  );
}
