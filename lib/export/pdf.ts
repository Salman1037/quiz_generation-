"use client";
import type { jsPDF } from "jspdf";
import type { ExamSession, Paper, PublicQuestion, QuestionResult } from "@/types/exam";
import { formatDurationWords } from "@/lib/exam/utilities";

/**
 * Real A4 PDF generation with jsPDF. Built-in PDF fonts cover Latin text; for other
 * scripts use the print view (browser "Save as PDF"), which supports every font.
 */

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_SPACE = 14;

const INK: [number, number, number] = [15, 26, 58];
const MUTED: [number, number, number] = [105, 113, 144];
const GREEN: [number, number, number] = [14, 120, 70];
const RED: [number, number, number] = [190, 40, 45];
const ACCENT: [number, number, number] = [75, 63, 224];

const REPLACEMENTS: [RegExp, string][] = [
  [/[\u2018\u2019\u201A\u2032]/g, "'"],
  [/[\u201C\u201D\u201E\u2033]/g, '"'],
  [/[\u2013\u2014\u2212]/g, "-"],
  [/\u2026/g, "..."],
  [/[\u2022\u25CF\u25AA]/g, "-"],
  [/\u203A/g, ">"],
  [/[\u00A0\u2007\u202F]/g, " "],
  [/\u2264/g, "<="],
  [/\u2265/g, ">="],
  [/\u2260/g, "!="],
  [/\u00D7/g, "x"],
];

export function sanitizeForPdf(text: string): string {
  let t = text;
  for (const [re, rep] of REPLACEMENTS) t = t.replace(re, rep);
  t = t.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
   
  return t.replace(/[^\u0000-\u00FF]/g, "?");
}

class Writer {
  y = MARGIN;
  constructor(
    public doc: jsPDF,
    private runningTitle: string,
  ) {}

  private wrap(text: string, size: number, style: "normal" | "bold" | "italic", width: number): string[] {
    this.doc.setFont("helvetica", style);
    this.doc.setFontSize(size);
    return this.doc.splitTextToSize(sanitizeForPdf(text), width) as string[];
  }

  measure(text: string, size: number, style: "normal" | "bold" | "italic", width = CONTENT_W): number {
    return this.wrap(text, size, style, width).length * size * 0.42;
  }

  ensure(height: number) {
    if (this.y + height > PAGE_H - MARGIN - FOOTER_SPACE) {
      this.doc.addPage();
      this.y = MARGIN;
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(8);
      this.doc.setTextColor(...MUTED);
      this.doc.text(sanitizeForPdf(this.runningTitle).slice(0, 110), MARGIN, MARGIN - 6);
    }
  }

  write(
    text: string,
    opts: { size?: number; style?: "normal" | "bold" | "italic"; color?: [number, number, number]; indent?: number; after?: number; width?: number } = {},
  ) {
    const size = opts.size ?? 10.5;
    const style = opts.style ?? "normal";
    const indent = opts.indent ?? 0;
    const lines = this.wrap(text, size, style, opts.width ?? CONTENT_W - indent);
    const lh = size * 0.42;
    for (const line of lines) {
      this.ensure(lh);
      this.doc.setFont("helvetica", style);
      this.doc.setFontSize(size);
      this.doc.setTextColor(...(opts.color ?? INK));
      this.doc.text(line, MARGIN + indent, this.y + lh * 0.8);
      this.y += lh;
    }
    this.y += opts.after ?? 1.5;
  }

  rule(gap = 4) {
    this.ensure(gap * 2);
    this.y += gap / 2;
    this.doc.setDrawColor(222, 226, 238);
    this.doc.setLineWidth(0.3);
    this.doc.line(MARGIN, this.y, PAGE_W - MARGIN, this.y);
    this.y += gap;
  }

  space(mm: number) {
    this.y += mm;
  }

  finish() {
    const pages = this.doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      this.doc.setPage(i);
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(8);
      this.doc.setTextColor(...MUTED);
      this.doc.text("QuizForge AI", MARGIN, PAGE_H - MARGIN + 4);
      this.doc.text(`Page ${i} of ${pages}`, PAGE_W - MARGIN, PAGE_H - MARGIN + 4, { align: "right" });
    }
  }
}

async function createDoc(title: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: sanitizeForPdf(title), creator: "QuizForge AI" });
  return doc;
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "paper";
}

function orderedQuestions(paper: Paper, order?: string[]): PublicQuestion[] {
  const byId = new Map(paper.questions.map((q) => [q.id, q]));
  const ids = order?.length ? order : paper.questions.map((q) => q.id);
  return ids.map((id) => byId.get(id)).filter((q): q is PublicQuestion => Boolean(q));
}

function header(w: Writer, title: string, meta: string) {
  w.write(title, { size: 16, style: "bold", after: 2 });
  w.write(meta, { size: 9.5, color: MUTED, after: 2 });
  w.rule(3);
}

function questionHeight(w: Writer, q: PublicQuestion, extra: string[]): number {
  let h = w.measure(q.question, 10.5, "bold", CONTENT_W - 9) + 2;
  for (const o of q.options) h += w.measure(`${o.id}. ${o.text}`, 10, "normal", CONTENT_W - 15) + 1;
  for (const e of extra) h += w.measure(e, 9, "italic", CONTENT_W - 9) + 1.5;
  return h + 5;
}

export async function exportQuestionPaper(
  paper: Paper,
  order: string[] | undefined,
  answerKey?: Record<string, Pick<QuestionResult, "correctAnswer" | "explanation">>,
) {
  const withAnswers = Boolean(answerKey);
  const title = withAnswers ? `${paper.title} (answer key)` : paper.title;
  const doc = await createDoc(title);
  const w = new Writer(doc, title);
  const s = paper.settings;
  const meta = [
    `${paper.totalQuestions} questions`,
    `Total marks: ${paper.totalQuestions * s.marksPerQuestion}`,
    s.negativeMarking ? `Negative marking: -${s.negativeMarking} per wrong answer` : null,
    s.timerEnabled ? `Time allowed: ${s.durationMinutes} minutes` : null,
  ]
    .filter(Boolean)
    .join("   |   ");
  header(w, title, meta);
  if (!withAnswers) {
    w.write("Name: ______________________________        Date: ________________", { size: 10, after: 3 });
    w.write("Choose one answer for each question.", { size: 9.5, style: "italic", color: MUTED, after: 4 });
  }

  orderedQuestions(paper, order).forEach((q, idx) => {
    const key = answerKey?.[q.id];
    const extra = key?.explanation ? [`Explanation: ${key.explanation}`] : [];
    w.ensure(Math.min(questionHeight(w, q, extra), 120));
    const numW = 9;
    const startY = w.y;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...ACCENT);
    doc.text(`${idx + 1}.`, MARGIN, startY + 10.5 * 0.42 * 0.8);
    w.write(q.question, { style: "bold", indent: numW, after: 1.5 });
    for (const o of q.options) {
      const isCorrect = key?.correctAnswer === o.id;
      w.write(`${o.id}.  ${o.text}${isCorrect ? "   (correct answer)" : ""}`, {
        size: 10,
        indent: numW + 4,
        style: isCorrect ? "bold" : "normal",
        color: isCorrect ? GREEN : INK,
        after: 0.8,
      });
    }
    for (const e of extra) w.write(e, { size: 9, style: "italic", color: MUTED, indent: numW, after: 1 });
    w.space(4);
  });

  if (answerKey) {
    w.rule(4);
    w.write("Answer key", { size: 12, style: "bold", after: 2 });
    const pairs = orderedQuestions(paper, order).map((q, i) => `${i + 1}-${answerKey[q.id]?.correctAnswer ?? "?"}`);
    for (let i = 0; i < pairs.length; i += 10) w.write(pairs.slice(i, i + 10).join("     "), { size: 10, after: 1 });
  }
  w.finish();
  doc.save(`${slug(paper.title)}${withAnswers ? "-answer-key" : "-question-paper"}.pdf`);
}

export async function exportResultReport(session: ExamSession) {
  const { paper, result } = session;
  if (!result) return;
  const title = `Result report: ${paper.title}`;
  const doc = await createDoc(title);
  const w = new Writer(doc, title);
  const sm = result.summary;
  header(
    w,
    title,
    `Submitted ${new Date(result.submittedAt).toLocaleString()}   |   Time taken: ${formatDurationWords(result.timeTakenSec)}${result.autoSubmitted ? " (submitted when time ran out)" : ""}`,
  );
  w.write(`Score: ${sm.marks} / ${sm.maxMarks}  (${sm.percentage}%)`, { size: 14, style: "bold", after: 2 });
  if (sm.passed !== null) {
    w.write(sm.passed ? `Passed (pass mark ${sm.passPercentage}%)` : `Not passed (pass mark ${sm.passPercentage}%)`, {
      style: "bold",
      color: sm.passed ? GREEN : RED,
      after: 2,
    });
  }
  w.write(
    `Correct: ${sm.correct}    Incorrect: ${sm.incorrect}    Unanswered: ${sm.unanswered}    Total questions: ${sm.total}${sm.negativeMarking ? `    Negative marking: -${sm.negativeMarking}` : ""}`,
    { size: 10, after: 3 },
  );
  w.rule(4);

  orderedQuestions(paper, session.order).forEach((q, idx) => {
    const r = result.perQuestion[q.id];
    if (!r) return;
    const status = r.status === "correct" ? "Correct" : r.status === "incorrect" ? "Incorrect" : "Not answered";
    const extra = [r.explanation ? `Explanation: ${r.explanation}` : "", `Source: ${q.source}   Difficulty: ${q.difficulty}`].filter(Boolean);
    w.ensure(Math.min(questionHeight(w, q, extra) + 6, 120));
    w.write(`${idx + 1}. ${q.question}`, { style: "bold", after: 1 });
    w.write(`${status}${r.marks ? ` (${r.marks > 0 ? "+" : ""}${r.marks})` : ""}`, {
      size: 9,
      style: "bold",
      color: r.status === "correct" ? GREEN : r.status === "incorrect" ? RED : MUTED,
      indent: 5,
      after: 1,
    });
    for (const o of q.options) {
      const isCorrect = o.id === r.correctAnswer;
      const isPicked = o.id === r.selected;
      const tag = isCorrect && isPicked ? "  (your answer, correct)" : isCorrect ? "  (correct answer)" : isPicked ? "  (your answer)" : "";
      w.write(`${o.id}.  ${o.text}${tag}`, {
        size: 10,
        indent: 9,
        style: isCorrect || isPicked ? "bold" : "normal",
        color: isCorrect ? GREEN : isPicked ? RED : INK,
        after: 0.8,
      });
    }
    for (const e of extra) w.write(e, { size: 9, style: "italic", color: MUTED, indent: 5, after: 1 });
    w.space(4);
  });
  w.finish();
  doc.save(`${slug(paper.title)}-result-report.pdf`);
}
