"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DocKind, ExtractedDocument } from "@/types/document";
import { checkUpload, DEFAULT_MAX_UPLOAD_MB, kindFromName, MAX_FILES } from "@/lib/documents/limits";
import { extractPdfPagesLocally } from "@/lib/documents/pdf-local";
import { AppError } from "@/lib/api/errors";
import { assembleDocument } from "@/lib/documents/assemble";
import { fetchHealth, type HealthInfo } from "./api";
import { chunkedUpload, fileFingerprint, recallUpload, rememberUpload } from "./chunked-upload";
import { ClientError, presentError } from "./errors";
import { hashBytes } from "./hash";
import { runOcr } from "./ocr";

export type ItemStatus = "queued" | "checking" | "uploading" | "extracting" | "ready" | "error" | "ocr";

export interface UploadItem {
  localId: string;
  name: string;
  size: number;
  kind: DocKind | null;
  status: ItemStatus;
  progress: number;
  /** Human-readable detail for the current step, e.g. "Reading page 40 of 300". */
  detail?: string;
  /** True when the file was read in the browser instead of uploaded. */
  local?: boolean;
  /** Server upload session, kept so Retry resumes instead of starting over. */
  uploadId?: string;
  docId?: string;
  error?: { title: string; message: string; hint: string };
  ocr?: { done: number; total: number; waitingUntil: number | null };
}

type HealthState = { status: "loading" } | { status: "ready"; info: HealthInfo } | { status: "error" };

interface WorkspaceValue {
  items: UploadItem[];
  docs: ExtractedDocument[];
  health: HealthState;
  notices: string[];
  addFiles: (files: File[]) => void;
  removeItem: (localId: string) => void;
  retryItem: (localId: string) => void;
  dismissNotice: (i: number) => void;
  startOcr: (localId: string, from: number, to: number) => void;
  cancelOcr: (localId: string) => void;
  refreshHealth: () => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

let counter = 0;
const newLocalId = () => `f${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * Holds uploaded files and their extracted text for the current browser session.
 * Text stays in memory (books can be several MB), so navigating to the exam and back keeps it.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [docMap, setDocMap] = useState<Record<string, ExtractedDocument>>({});
  const [health, setHealth] = useState<HealthState>({ status: "loading" });
  const [notices, setNotices] = useState<string[]>([]);
  const files = useRef(new Map<string, File>());
  const controllers = useRef(new Map<string, AbortController>());
  const queue = useRef<string[]>([]);
  const busy = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const docsRef = useRef(docMap);
  docsRef.current = docMap;

  const patch = useCallback((localId: string, p: Partial<UploadItem>) => {
    setItems((list) => list.map((it) => (it.localId === localId ? { ...it, ...p } : it)));
  }, []);

  const refreshHealth = useCallback(() => {
    setHealth({ status: "loading" });
    fetchHealth()
      .then((info) => setHealth({ status: "ready", info }))
      .catch(() => setHealth({ status: "error" }));
  }, []);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  const maxMb = health.status === "ready" ? health.info.maxUploadMb : DEFAULT_MAX_UPLOAD_MB;
  const maxMbRef = useRef(maxMb);
  maxMbRef.current = maxMb;

  const processNext = useCallback(async () => {
    if (busy.current) return;
    const localId = queue.current.shift();
    if (!localId) return;
    busy.current = true;
    const file = files.current.get(localId);
    const controller = new AbortController();
    controllers.current.set(localId, controller);
    try {
      if (!file) throw new ClientError("INTERNAL", "File is no longer available.");
      patch(localId, { status: "checking", progress: 0, detail: undefined });
      // Quick duplicate check without reading the file; the content hash is checked after upload.
      const fp = fileFingerprint(file);
      const kind = kindFromName(file.name);

      // Fallback only: if a proxy or serverless host rejects chunked uploads, PDFs can still be
      // read in the browser. This needs the whole file in memory, so it is not the default path.
      const readLocally = async () => {
        patch(localId, { status: "extracting", progress: 0, local: true, detail: "Opening the PDF on this device" });
        const bytes = new Uint8Array(await file.arrayBuffer());
        const hash = await hashBytes(bytes, fp);
        const pages = await extractPdfPagesLocally(
          bytes,
          (done, total) => patch(localId, { progress: done / Math.max(1, total), detail: `Reading page ${done} of ${total} on this device` }),
          controller.signal,
        );
        return assembleDocument({ name: file.name, size: file.size, kind: "pdf", hash, pages });
      };

      let doc: ExtractedDocument;
      patch(localId, { status: "uploading", progress: 0, local: false });
      try {
        const existing = itemsRef.current.find((it) => it.localId === localId)?.uploadId ?? recallUpload(fp);
        doc = await chunkedUpload(file, {
          resumeId: existing,
          signal: controller.signal,
          onSession: (uploadId) => {
            patch(localId, { uploadId });
            rememberUpload(fp, uploadId);
          },
          onProgress: (p) =>
            patch(localId, {
              status: p.phase === "processing" ? "extracting" : "uploading",
              progress: p.sentBytes / Math.max(1, p.totalBytes),
              detail: p.phase === "processing" ? "Checking the file and extracting text" : p.detail,
            }),
        });
        rememberUpload(fp, null);
      } catch (err) {
        const fallback =
          kind === "pdf" && err instanceof ClientError && (err.code === "FILE_TOO_LARGE" || err.code === "UPLOAD_STORE_UNAVAILABLE") && err.status !== 0;
        // A file rejected by our own limit stays rejected; only infrastructure limits trigger the fallback.
        if (fallback && file.size <= maxMbRef.current * 1024 * 1024) {
          rememberUpload(fp, null);
          doc = await readLocally();
        } else {
          if (err instanceof ClientError && ["PDF_PASSWORD", "PDF_CORRUPT", "DOCX_CORRUPT", "TXT_BINARY", "MIME_MISMATCH", "EMPTY_FILE"].includes(err.code)) {
            rememberUpload(fp, null);
            patch(localId, { uploadId: undefined });
          }
          throw err;
        }
      }
      if (docsRef.current[doc.id]) {
        setNotices((n) => [...n, `${file.name} is the same file as one already uploaded, so it was skipped.`]);
        setItems((list) => list.filter((it) => it.localId !== localId));
        return;
      }
      files.current.set(doc.id, file);
      setDocMap((m) => ({ ...m, [doc.id]: doc }));
      patch(localId, { status: "ready", progress: 1, docId: doc.id, error: undefined, detail: undefined });
    } catch (err) {
      if (err instanceof ClientError && err.code === "ABORTED") return;
      if (err instanceof AppError && err.status === 499) return;
      const p = presentError(err instanceof AppError ? new ClientError(err.code, err.message, err.status) : err);
      patch(localId, { status: "error", error: { title: p.title, message: p.message, hint: p.hint } });
    } finally {
      controllers.current.delete(localId);
      busy.current = false;
      void processNext();
    }
  }, [patch]);

  const addFiles = useCallback(
    (incoming: File[]) => {
      const current = itemsRef.current;
      const accepted: UploadItem[] = [];
      const rejected: string[] = [];
      for (const file of incoming) {
        if (current.length + accepted.length >= MAX_FILES) {
          rejected.push(`Only ${MAX_FILES} files can be added at once; ${file.name} was skipped.`);
          continue;
        }
        const dup = [...current, ...accepted].some((it) => it.name === file.name && it.size === file.size);
        if (dup) {
          rejected.push(`${file.name} is already in the list.`);
          continue;
        }
        const check = checkUpload(file.name, file.size, file.type, maxMb);
        const localId = newLocalId();
        if (!check.ok) {
          const p = presentError(new ClientError(check.code as never, check.message));
          accepted.push({
            localId,
            name: file.name,
            size: file.size,
            kind: kindFromName(file.name),
            status: "error",
            progress: 0,
            error: { title: p.title, message: p.message, hint: p.hint },
          });
          continue;
        }
        files.current.set(localId, file);
        queue.current.push(localId);
        accepted.push({ localId, name: file.name, size: file.size, kind: check.kind, status: "queued", progress: 0 });
      }
      if (rejected.length) setNotices((n) => [...n, ...rejected]);
      setItems((list) => [...list, ...accepted]);
      setTimeout(() => void processNext(), 0);
    },
    [maxMb, processNext],
  );

  const removeItem = useCallback((localId: string) => {
    controllers.current.get(localId)?.abort();
    queue.current = queue.current.filter((id) => id !== localId);
    const item = itemsRef.current.find((it) => it.localId === localId);
    if (item?.docId) {
      const docId = item.docId;
      setDocMap((m) => {
        const next = { ...m };
        delete next[docId];
        return next;
      });
      files.current.delete(docId);
    }
    files.current.delete(localId);
    setItems((list) => list.filter((it) => it.localId !== localId));
  }, []);

  const retryItem = useCallback(
    (localId: string) => {
      if (!files.current.has(localId)) return;
      patch(localId, { status: "queued", error: undefined, progress: 0 });
      queue.current.push(localId);
      void processNext();
    },
    [patch, processNext],
  );

  const startOcr = useCallback(
    (localId: string, from: number, to: number) => {
      const item = itemsRef.current.find((it) => it.localId === localId);
      const doc = item?.docId ? docsRef.current[item.docId] : undefined;
      const file = item?.docId ? files.current.get(item.docId) : undefined;
      if (!item || !doc || !file || !doc.pages) return;
      const rpm = health.status === "ready" ? health.info.rpm : 5;
      const controller = new AbortController();
      controllers.current.set(localId, controller);
      patch(localId, { status: "ocr", ocr: { done: 0, total: to - from + 1, waitingUntil: null }, error: undefined });
      runOcr(file, from, to, {
        rpm,
        signal: controller.signal,
        onProgress: (done, total, waitingUntil) => patch(localId, { ocr: { done, total, waitingUntil } }),
      })
        .then((recognised) => {
          const pages = doc.pages!.map((p, i) => {
            const ocrText = recognised.get(i + 1);
            return ocrText && ocrText.trim().length > p.trim().length ? ocrText : p;
          });
          const updated = assembleDocument({ name: doc.name, size: doc.size, kind: doc.kind, hash: doc.hash, pages, ocrApplied: true });
          setDocMap((m) => ({ ...m, [doc.id]: updated }));
          patch(localId, { status: "ready", ocr: undefined });
        })
        .catch((err) => {
          if (err instanceof ClientError && err.code === "ABORTED") {
            patch(localId, { status: "ready", ocr: undefined });
            return;
          }
          const p = presentError(err);
          patch(localId, { status: "ready", ocr: undefined, error: { title: `OCR stopped: ${p.title}`, message: p.message, hint: p.hint } });
        })
        .finally(() => controllers.current.delete(localId));
    },
    [health, patch],
  );

  const cancelOcr = useCallback((localId: string) => controllers.current.get(localId)?.abort(), []);
  const dismissNotice = useCallback((i: number) => setNotices((n) => n.filter((_, j) => j !== i)), []);

  const docs = useMemo(
    () =>
      items
        .map((it) => (it.docId ? docMap[it.docId] : undefined))
        .filter((d): d is ExtractedDocument => Boolean(d)),
    [items, docMap],
  );

  const value = useMemo<WorkspaceValue>(
    () => ({ items, docs, health, notices, addFiles, removeItem, retryItem, dismissNotice, startOcr, cancelOcr, refreshHealth }),
    [items, docs, health, notices, addFiles, removeItem, retryItem, dismissNotice, startOcr, cancelOcr, refreshHealth],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
