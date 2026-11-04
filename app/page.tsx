"use client";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { ExamSettings } from "@/types/exam";
import { Hero } from "@/components/home/Hero";
import { RecentPapers } from "@/components/home/RecentPapers";
import { SetupNotice } from "@/components/setup/SetupNotice";
import { FileUploader } from "@/components/upload/FileUploader";
import { UploadedFiles, UploadStats } from "@/components/upload/UploadedFiles";
import { GenerationSettings } from "@/components/generator/GenerationSettings";
import { SummaryPanel } from "@/components/generator/SummaryPanel";
import { GenerationProgressPanel } from "@/components/generator/GenerationProgress";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { useWorkspace } from "@/lib/client/workspace";
import { useExam } from "@/lib/client/exam-store";
import { planGeneration } from "@/lib/ai/planning";
import { runGeneration, type GenerationProgress } from "@/lib/client/generate";
import { presentError } from "@/lib/client/errors";
import { readStore, STORE_KEYS, writeStore } from "@/lib/client/storage";
import { DEFAULT_MAX_UPLOAD_MB } from "@/lib/documents/limits";

const DEFAULT_SETTINGS: ExamSettings = {
  questionCount: 20,
  difficulty: "mixed",
  sourceMode: "all",
  documentId: null,
  sectionIds: [],
  topic: "",
  shuffleQuestions: true,
  shuffleOptions: true,
  includeExplanations: true,
  revealMode: "after",
  timerEnabled: false,
  durationMinutes: 30,
  marksPerQuestion: 1,
  negativeMarking: 0,
  passPercentage: null,
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`} className="space-y-4">
      <h2 id={`step-${n}`} className="flex items-center gap-3 text-[15px] font-semibold text-ink">
        <span className="grid size-6 place-items-center rounded-full bg-ink text-[12px] font-semibold text-white tabular" aria-hidden>
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function WorkspacePage() {
  const router = useRouter();
  const ws = useWorkspace();
  const exam = useExam();
  const [settings, setSettings] = useState<ExamSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ title: string; message: string; hint: string } | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const saved = readStore<Partial<ExamSettings>>(STORE_KEYS.settings);
    if (saved) setSettings((s) => ({ ...s, ...saved, documentId: null, sectionIds: [], sourceMode: saved.sourceMode === "topic" ? "topic" : "all" }));
    setSettingsLoaded(true);
  }, []);
  useEffect(() => {
    if (settingsLoaded) writeStore(STORE_KEYS.settings, settings);
  }, [settings, settingsLoaded]);

  // Keep document/section selections valid when files are removed.
  useEffect(() => {
    setSettings((s) => {
      const ids = new Set(ws.docs.map((d) => d.id));
      const sectionIds = new Set(ws.docs.flatMap((d) => d.sections.map((x) => x.id)));
      const documentId = s.documentId && ids.has(s.documentId) ? s.documentId : (ws.docs[0]?.id ?? null);
      const sections = s.sectionIds.filter((id) => sectionIds.has(id));
      if (documentId === s.documentId && sections.length === s.sectionIds.length) return s;
      return { ...s, documentId, sectionIds: sections };
    });
  }, [ws.docs]);

  const deferredSettings = useDeferredValue(settings);
  const plan = useMemo(() => (ws.docs.length ? planGeneration(ws.docs, deferredSettings) : null), [ws.docs, deferredSettings]);

  const processing = ws.items.some((i) => ["queued", "checking", "uploading", "extracting", "ocr"].includes(i.status));
  const health = ws.health;
  const configured = health.status === "ready" && health.info.configured;
  const rpm = health.status === "ready" ? health.info.rpm : 5;
  const maxMb = health.status === "ready" ? health.info.maxUploadMb : DEFAULT_MAX_UPLOAD_MB;

  const disabledReason = !ws.docs.length
    ? "Add at least one document to continue."
    : processing
      ? "Wait for your documents to finish processing."
      : health.status === "ready" && !configured
        ? "Connect a Gemini API key first."
        : health.status === "error"
          ? "The server isn’t responding. Check that it’s running."
          : null;

  const patch = useCallback((p: Partial<ExamSettings>) => setSettings((s) => ({ ...s, ...p })), []);

  const generate = useCallback(async () => {
    if (exam.session?.status === "in-progress" && !window.confirm("Generating a new paper ends the exam you have in progress. Continue?")) return;
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setError(null);
    setProgress(null);
    setRunning(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const outcome = await runGeneration(ws.docs, settings, { rpm, signal: ctrl.signal, onProgress: setProgress });
      exam.startPaper(outcome.paper);
      router.push("/exam");
    } catch (err) {
      const p = presentError(err);
      if (p.code === "ABORTED") {
        setRunning(false);
        return;
      }
      setError({ title: p.title, message: p.message, hint: p.hint });
    }
  }, [exam, ws.docs, settings, rpm, router]);

  useEffect(() => () => controller.current?.abort(), []);

  if (running) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <GenerationProgressPanel
          progress={progress}
          error={error}
          onCancel={() => {
            controller.current?.abort();
            setRunning(false);
          }}
          onRetry={generate}
          onClose={() => {
            setRunning(false);
            setError(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <Hero />

      {exam.hydrated && exam.session?.status === "in-progress" && (
        <Alert
          tone="info"
          className="mb-6"
          title="You have an examination in progress"
          action={
            <Button size="sm" variant="primary" onClick={() => router.push("/exam")}>
              Resume exam
              <ArrowRight className="size-3.5" aria-hidden />
            </Button>
          }
        >
          {exam.session.paper.title}. Your answers so far are saved in this browser.
        </Alert>
      )}

      {health.status === "ready" && !health.info.configured && (
        <div className="mb-8">
          <SetupNotice onRecheck={ws.refreshHealth} checking={false} />
        </div>
      )}
      {health.status === "ready" && health.info.modelNote && (
        <Alert tone="info" className="mb-8" title="Using a newer Gemini model">
          {health.info.modelNote}
        </Alert>
      )}
      {health.status === "ready" && health.info.keyProblem && (
        <Alert tone="danger" className="mb-8" title="API key rejected" action={<Button size="sm" onClick={ws.refreshHealth}>Check again</Button>}>
          {health.info.keyProblem}
        </Alert>
      )}
      {health.status === "error" && (
        <Alert tone="danger" className="mb-8" title="Can’t reach the server" action={<Button size="sm" onClick={ws.refreshHealth}>Check again</Button>}>
          The app’s server didn’t respond. Make sure <code className="font-mono text-[12px]">npm run dev</code> is running.
        </Alert>
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
        <div className="min-w-0 space-y-10">
          <Step n={1} title="Add your material">
            <FileUploader onFiles={ws.addFiles} maxMb={maxMb} compact={ws.items.length > 0} />
            {ws.notices.map((n, i) => (
              <Alert key={`${n}-${i}`} tone="warn" onDismiss={() => ws.dismissNotice(i)}>
                {n}
              </Alert>
            ))}
            <UploadStats />
            <UploadedFiles />
          </Step>

          <Step n={2} title="Configure the paper">
            <GenerationSettings settings={settings} onChange={patch} docs={ws.docs} />
          </Step>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <SummaryPanel
            settings={settings}
            plan={plan}
            rpm={rpm}
            disabledReason={disabledReason}
            onGenerate={generate}
            onUseCapacity={(n) => patch({ questionCount: n })}
          />
        </div>
      </div>

      <RecentPapers />
    </div>
  );
}
