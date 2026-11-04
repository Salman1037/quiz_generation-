"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ExamResult, ExamSession, OptionId, Paper, QuestionResult, RevealedAnswer, ScoreSummary } from "@/types/exam";
import { shuffle } from "@/lib/exam/utilities";
import { postJson } from "./api";
import { ClientError } from "./errors";
import { readStore, removeStore, STORE_KEYS, writeStore } from "./storage";

export interface LibraryEntry {
  paper: Paper;
  savedAt: number;
  lastScore: number | null;
}

interface ExamValue {
  hydrated: boolean;
  session: ExamSession | null;
  library: LibraryEntry[];
  startPaper: (paper: Paper) => void;
  select: (questionId: string, option: OptionId) => void;
  clearAnswer: (questionId: string) => void;
  toggleMark: (questionId: string) => void;
  goTo: (index: number) => void;
  submit: (opts?: { auto?: boolean }) => Promise<void>;
  retake: () => void;
  discard: () => void;
  removeFromLibrary: (paperId: string) => void;
}

const ExamContext = createContext<ExamValue | null>(null);
const LIBRARY_LIMIT = 8;

function persistLibrary(entries: LibraryEntry[]) {
  // Drop the oldest entries until the library fits in storage.
  let list = entries.slice(0, LIBRARY_LIMIT);
  while (list.length && !writeStore(STORE_KEYS.library, list)) list = list.slice(0, -1);
}

function newSession(paper: Paper, attempt: number): ExamSession {
  const ids = paper.questions.map((q) => q.id);
  const now = Date.now();
  return {
    paper,
    order: attempt > 1 && paper.settings.shuffleQuestions ? shuffle(ids) : ids,
    answers: {},
    marked: {},
    revealed: {},
    current: 0,
    startedAt: now,
    deadline: paper.settings.timerEnabled ? now + paper.settings.durationMinutes * 60_000 : null,
    status: "in-progress",
    result: null,
    attempt,
  };
}

/** Exam session state, saved to localStorage on every change so a refresh loses nothing. */
export function ExamProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ExamSession | null>(null);
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const pendingReveal = useRef(new Set<string>());

  useEffect(() => {
    const saved = readStore<ExamSession>(STORE_KEYS.session);
    // A submission interrupted by a refresh goes back to in-progress so it can be resubmitted.
    if (saved?.paper?.questions?.length) setSession(saved.status === "submitting" ? { ...saved, status: "in-progress" } : saved);
    setLibrary(readStore<LibraryEntry[]>(STORE_KEYS.library) ?? []);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (session) writeStore(STORE_KEYS.session, session);
    else removeStore(STORE_KEYS.session);
  }, [session, hydrated]);

  const startPaper = useCallback((paper: Paper) => {
    setSession(newSession(paper, 1));
    setLibrary((lib) => {
      const next = [{ paper, savedAt: Date.now(), lastScore: null }, ...lib.filter((e) => e.paper.id !== paper.id)];
      persistLibrary(next);
      return next.slice(0, LIBRARY_LIMIT);
    });
  }, []);

  const reveal = useCallback(async (questionId: string) => {
    const s = sessionRef.current;
    if (!s || s.paper.settings.revealMode !== "immediate" || s.revealed[questionId] || pendingReveal.current.has(questionId)) return;
    pendingReveal.current.add(questionId);
    try {
      const res = await postJson<{ revealed: Record<string, RevealedAnswer> }>("/api/evaluate", {
        key: s.paper.key,
        answers: {},
        revealIds: [questionId],
      });
      setSession((cur) => (cur && cur.paper.id === s.paper.id ? { ...cur, revealed: { ...cur.revealed, ...res.revealed } } : cur));
    } catch {
      /* Reveal is best-effort; the full result still arrives on submit. */
    } finally {
      pendingReveal.current.delete(questionId);
    }
  }, []);

  const select = useCallback(
    (questionId: string, option: OptionId) => {
      const s = sessionRef.current;
      if (!s || s.status !== "in-progress") return;
      if (s.paper.settings.revealMode === "immediate" && (s.revealed[questionId] || s.answers[questionId])) return; // locked once checked
      setSession({ ...s, answers: { ...s.answers, [questionId]: option } });
      if (s.paper.settings.revealMode === "immediate") void reveal(questionId);
    },
    [reveal],
  );

  const clearAnswer = useCallback((questionId: string) => {
    setSession((s) => {
      if (!s || s.status !== "in-progress" || s.revealed[questionId]) return s;
      const answers = { ...s.answers };
      delete answers[questionId];
      return { ...s, answers };
    });
  }, []);

  const toggleMark = useCallback((questionId: string) => {
    setSession((s) => (s ? { ...s, marked: { ...s.marked, [questionId]: !s.marked[questionId] } } : s));
  }, []);

  const goTo = useCallback((index: number) => {
    setSession((s) => (s ? { ...s, current: Math.max(0, Math.min(s.order.length - 1, index)) } : s));
  }, []);

  const submit = useCallback(async (opts?: { auto?: boolean }) => {
    const s = sessionRef.current;
    if (!s || s.status !== "in-progress") return;
    setSession({ ...s, status: "submitting" });
    try {
      const res = await postJson<{ summary: ScoreSummary; perQuestion: Record<string, QuestionResult> }>("/api/evaluate", {
        key: s.paper.key,
        answers: Object.fromEntries(s.order.map((id) => [id, s.answers[id] ?? null])),
      });
      const now = Date.now();
      const end = s.deadline ? Math.min(now, s.deadline) : now;
      const result: ExamResult = {
        summary: res.summary,
        perQuestion: res.perQuestion,
        timeTakenSec: Math.round((end - s.startedAt) / 1000),
        submittedAt: now,
        autoSubmitted: Boolean(opts?.auto),
      };
      setSession((cur) => (cur ? { ...cur, status: "submitted", result } : cur));
      setLibrary((lib) => {
        const next = lib.map((e) => (e.paper.id === s.paper.id ? { ...e, lastScore: res.summary.percentage } : e));
        persistLibrary(next);
        return next;
      });
    } catch (err) {
      setSession((cur) => (cur ? { ...cur, status: "in-progress" } : cur));
      throw err instanceof ClientError ? err : new ClientError("INTERNAL", "Submission failed.");
    }
  }, []);

  const retake = useCallback(() => {
    const s = sessionRef.current;
    if (s) setSession(newSession(s.paper, s.attempt + 1));
  }, []);

  const discard = useCallback(() => setSession(null), []);

  const removeFromLibrary = useCallback((paperId: string) => {
    setLibrary((lib) => {
      const next = lib.filter((e) => e.paper.id !== paperId);
      persistLibrary(next);
      if (!next.length) removeStore(STORE_KEYS.library);
      return next;
    });
  }, []);

  const value = useMemo<ExamValue>(
    () => ({ hydrated, session, library, startPaper, select, clearAnswer, toggleMark, goTo, submit, retake, discard, removeFromLibrary }),
    [hydrated, session, library, startPaper, select, clearAnswer, toggleMark, goTo, submit, retake, discard, removeFromLibrary],
  );
  return <ExamContext.Provider value={value}>{children}</ExamContext.Provider>;
}

export function useExam(): ExamValue {
  const ctx = useContext(ExamContext);
  if (!ctx) throw new Error("useExam must be used inside ExamProvider");
  return ctx;
}
