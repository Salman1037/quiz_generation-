"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, FileText, FileType2, Loader2, RotateCcw, ScanText, Trash2, TriangleAlert, X } from "lucide-react";
import type { ExtractedDocument } from "@/types/document";
import type { UploadItem } from "@/lib/client/workspace";
import { useWorkspace } from "@/lib/client/workspace";
import { formatBytes } from "@/lib/documents/text";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/client/cn";
import { OCR_PAGES_PER_REQUEST } from "@/lib/client/ocr";

function KindBadge({ kind }: { kind: UploadItem["kind"] }) {
  const Icon = kind === "docx" ? FileType2 : FileText;
  return (
    <span className="relative grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-canvas text-ink-2" aria-hidden>
      <Icon className="size-5" />
      <span className="absolute -bottom-1.5 rounded bg-ink px-1 text-[9px] font-semibold leading-[14px] tracking-wide text-white">
        {(kind ?? "?").toUpperCase()}
      </span>
    </span>
  );
}

function statusText(item: UploadItem, doc?: ExtractedDocument): string {
  switch (item.status) {
    case "queued":
      return "Waiting";
    case "checking":
      return "Checking for duplicates";
    case "uploading":
      return `${item.detail ?? "Uploading"} (${Math.round(item.progress * 100)}%)`;
    case "extracting":
      return item.detail ?? "Extracting text";
    case "ocr":
      return item.ocr ? `Recognising text: ${item.ocr.done} of ${item.ocr.total} pages` : "Starting OCR";
    case "error":
      return item.error?.title ?? "Failed";
    case "ready":
      if (!doc) return "Ready";
      return [
        `${doc.wordCount.toLocaleString()} words`,
        doc.pageCount ? `${doc.pageCount} pages` : null,
        `${doc.sections.length} section${doc.sections.length === 1 ? "" : "s"}`,
        doc.ocrApplied ? "OCR applied" : null,
        item.local ? "read on this device" : null,
      ]
        .filter(Boolean)
        .join(", ");
  }
}

function OcrPanel({ item, doc }: { item: UploadItem; doc: ExtractedDocument }) {
  const { startOcr } = useWorkspace();
  const total = doc.pageCount ?? 1;
  const targetPages = doc.needsOcr ? null : doc.emptyPages;
  const [from, setFrom] = useState(targetPages?.[0] ?? 1);
  const [to, setTo] = useState(targetPages ? targetPages[targetPages.length - 1] : Math.min(total, 30));
  const pages = Math.max(0, to - from + 1);
  const requests = Math.ceil(pages / OCR_PAGES_PER_REQUEST);
  const valid = from >= 1 && to <= total && from <= to;
  return (
    <div className="mt-3 rounded-xl border border-warn-line bg-warn-soft/70 p-3.5">
      <div className="flex gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0 flex-1">
          {doc.warnings.map((w) => (
            <p key={w} className="text-[13px] leading-relaxed text-ink-2">
              {w}
            </p>
          ))}
          <div className="mt-2.5 flex flex-wrap items-end gap-2">
            <label className="text-[12px] font-medium text-ink-2">
              From page
              <input
                type="number"
                min={1}
                max={total}
                value={from}
                onChange={(e) => setFrom(Number(e.target.value))}
                className="mt-1 block h-9 w-20 rounded-lg border border-line-strong bg-surface px-2 text-sm tabular text-ink"
              />
            </label>
            <label className="text-[12px] font-medium text-ink-2">
              To page
              <input
                type="number"
                min={1}
                max={total}
                value={to}
                onChange={(e) => setTo(Number(e.target.value))}
                className="mt-1 block h-9 w-20 rounded-lg border border-line-strong bg-surface px-2 text-sm tabular text-ink"
              />
            </label>
            <Button size="sm" className="h-9" disabled={!valid} onClick={() => startOcr(item.localId, from, to)}>
              <ScanText className="size-4" aria-hidden />
              Run OCR on {pages} page{pages === 1 ? "" : "s"}
            </Button>
          </div>
          <p className="mt-2 text-[12px] text-ink-3">
            Uses {requests} Gemini request{requests === 1 ? "" : "s"}, paced for the free tier. Large ranges take a few minutes.
          </p>
        </div>
      </div>
    </div>
  );
}

function FileRow({ item, doc }: { item: UploadItem; doc?: ExtractedDocument }) {
  const { removeItem, retryItem, cancelOcr } = useWorkspace();
  const busy = ["queued", "checking", "uploading", "extracting", "ocr"].includes(item.status);
  const showOcr = item.status === "ready" && doc && doc.kind === "pdf" && (doc.needsOcr || doc.emptyPages.length > 0);
  const warnings = item.status === "ready" && doc && !showOcr ? doc.warnings : [];
  const progress =
    item.status === "uploading"
      ? item.progress
      : item.status === "extracting"
        ? item.local
          ? item.progress
          : null
        : item.status === "ocr" && item.ocr
          ? item.ocr.done / Math.max(1, item.ocr.total)
          : null;

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ duration: 0.18 }}
      className="px-4 py-3.5"
    >
      <div className="flex items-center gap-3.5">
        <KindBadge kind={item.kind} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="truncate text-sm font-medium text-ink" title={item.name}>
              {item.name}
            </p>
            <span className="shrink-0 text-[12px] text-ink-3 tabular">{formatBytes(item.size)}</span>
          </div>
          <p
            className={cn(
              "mt-0.5 flex items-center gap-1.5 text-[13px]",
              item.status === "error" ? "text-danger" : item.status === "ready" ? "text-ink-2" : "text-ink-3",
            )}
            aria-live="polite"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {item.status === "ready" && !doc?.needsOcr && <CheckCircle2 className="size-3.5 text-success" aria-hidden />}
            {item.status === "ready" && doc?.needsOcr && <TriangleAlert className="size-3.5 text-warn" aria-hidden />}
            <span className="truncate">{statusText(item, doc)}</span>
            {item.status === "ocr" && item.ocr?.waitingUntil && <span className="text-warn">(pausing for the rate limit)</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {item.status === "error" && item.kind && (
            <Button size="sm" variant="ghost" onClick={() => retryItem(item.localId)} aria-label={`Retry ${item.name}`}>
              <RotateCcw className="size-4" aria-hidden />
              <span className="hidden sm:inline">Retry</span>
            </Button>
          )}
          {item.status === "ocr" ? (
            <Button size="sm" variant="ghost" onClick={() => cancelOcr(item.localId)}>
              <X className="size-4" aria-hidden />
              Stop OCR
            </Button>
          ) : (
            <button
              type="button"
              onClick={() => removeItem(item.localId)}
              aria-label={`Remove ${item.name}`}
              className="grid size-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
      {(item.status === "uploading" || item.status === "extracting" || item.status === "ocr") && (
        <div className="mt-2.5 pl-[3.375rem]">
          {progress === null ? (
            <div className="relative h-1.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-label="Extracting text" aria-busy>
              <div className="absolute inset-y-0 w-1/3 animate-[slide_1.2s_ease-in-out_infinite] rounded-full bg-accent/70" />
            </div>
          ) : (
            <ProgressBar value={progress} label={`${item.name} progress`} />
          )}
        </div>
      )}
      {item.status === "error" && item.error && (
        <p className="mt-2 pl-[3.375rem] text-[13px] leading-relaxed text-ink-2">
          {item.error.message} {item.error.hint}
        </p>
      )}
      {item.status === "ready" && item.error && (
        <p className="mt-2 pl-[3.375rem] text-[13px] text-danger">
          {item.error.title}. {item.error.hint}
        </p>
      )}
      {warnings.map((w) => (
        <p key={w} className="mt-2 pl-[3.375rem] text-[13px] text-warn">
          {w}
        </p>
      ))}
      {showOcr && doc && (
        <div className="pl-0 sm:pl-[3.375rem]">
          <OcrPanel item={item} doc={doc} />
        </div>
      )}
    </motion.li>
  );
}

export function UploadedFiles() {
  const { items, docs } = useWorkspace();
  const byId = new Map(docs.map((d) => [d.id, d]));
  if (!items.length) return null;
  return (
    <ul className="card divide-y divide-line overflow-hidden" aria-label="Uploaded documents">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <FileRow key={item.localId} item={item} doc={item.docId ? byId.get(item.docId) : undefined} />
        ))}
      </AnimatePresence>
    </ul>
  );
}

export function UploadStats() {
  const { items, docs } = useWorkspace();
  if (!items.length) return null;
  const words = docs.reduce((n, d) => n + d.wordCount, 0);
  const pages = docs.reduce((n, d) => n + (d.pageCount ?? 0), 0);
  const processing = items.filter((i) => ["queued", "checking", "uploading", "extracting", "ocr"].includes(i.status)).length;
  const failed = items.filter((i) => i.status === "error").length;
  const status = processing ? `Processing ${processing}` : failed ? `${failed} need attention` : "All ready";
  const stats = [
    { label: "Documents", value: String(docs.length) },
    { label: "Words extracted", value: words.toLocaleString() },
    { label: "Pages", value: pages ? pages.toLocaleString() : "—" },
    { label: "Status", value: status },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="bg-surface px-4 py-3">
          <dt className="text-[12px] text-ink-3">{s.label}</dt>
          <dd className={cn("mt-0.5 text-[15px] font-semibold tabular", s.label === "Status" && failed && !processing ? "text-danger" : "text-ink")}>
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
