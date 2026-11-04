/**
 * End-to-end journey against a running production server (see scripts/e2e.mjs):
 * upload → extract → plan → generate in batches → finalize → evaluate, plus failure paths.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import type { ExtractedDocument } from "@/types/document";
import type { ExamSettings, PublicQuestion, QuestionResult, ScoreSummary } from "@/types/exam";
import { planGeneration, planTopUp } from "@/lib/ai/planning";
import { dedupeQuestions } from "@/lib/validation/dedupe";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const FIX = path.resolve(__dirname, "../fixtures");

async function upload(name: string, bytes: Uint8Array | string, type = "") {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], name, { type }));
  const res = await fetch(`${BASE}/api/documents`, { method: "POST", body: form });
  return { status: res.status, body: await res.json() };
}
const fixture = (n: string) => new Uint8Array(readFileSync(path.join(FIX, n)));
async function post<T = Record<string, unknown>>(url: string, body: unknown) {
  const res = await fetch(`${BASE}${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as T };
}

/** A synthetic "book": 6 chapters of unique factual sentences (~4,800 words). */
function syntheticBook(): string {
  const syl = ["var", "kel", "mor", "dan", "sil", "tor", "bra", "quen", "lis", "zab", "orn", "pel"];
  const name = (n: number, suffix: string) =>
    (syl[n % 12] + syl[Math.floor(n / 12) % 12] + syl[Math.floor(n / 144) % 12]).replace(/^./, (c) => c.toUpperCase()) + suffix;
  const metals = ["copper", "silver", "nickel", "cobalt", "zinc", "tin", "lead", "iron", "chromium", "titanium"];
  const out: string[] = [];
  let n = 0;
  for (let ch = 1; ch <= 6; ch++) {
    out.push(`Chapter ${ch}: Regional Geography Part ${ch}`);
    const paras: string[] = [];
    for (let p = 0; p < 8; p++) {
      const sents: string[] = [];
      for (let s = 0; s < 5; s++) {
        n++;
        sents.push(
          `The settlement of ${name(n, "borough")} lies beside the ${name(n + 7, "water")} and exports ${metals[n % metals.length]} ore to the coastal market at ${name(n + 3, "haven")} every spring.`,
        );
      }
      paras.push(sents.join(" "));
    }
    out.push(paras.join("\n\n"));
  }
  return out.join("\n\n");
}

const settings = (over: Partial<ExamSettings>): ExamSettings => ({
  questionCount: 10,
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
  durationMinutes: 10,
  marksPerQuestion: 1,
  negativeMarking: 0.25,
  passPercentage: 50,
  ...over,
});

interface BatchRes {
  sealed: string;
  questions: PublicQuestion[];
}

/** Mirrors the browser orchestrator: batches, avoid-lists, top-ups, then finalize. */
async function generatePaper(docs: ExtractedDocument[], s: ExamSettings) {
  const plan = planGeneration(docs, s);
  if (!plan.ok) throw new Error(plan.message);
  const sealed: string[] = [];
  const collected: PublicQuestion[] = [];
  const yields: Record<string, number> = {};
  const run = async (batches: typeof plan.batches) => {
    for (const b of batches) {
      const r = await post<BatchRes>("/api/generate", {
        batchId: b.id,
        chunks: b.chunks,
        count: b.count,
        difficulty: b.difficulty,
        topic: b.topic,
        avoid: collected.map((q) => q.question.slice(0, 200)).slice(-120),
      });
      expect(r.status).toBe(200);
      const { kept } = dedupeQuestions(r.body.questions, collected);
      collected.push(...kept);
      yields[b.id] = kept.length;
      sealed.push(r.body.sealed);
    }
  };
  await run(plan.batches);
  for (let round = 1; round <= 2 && collected.length < s.questionCount; round++) {
    await run(planTopUp(plan.batches, yields, s.questionCount - collected.length, round));
  }
  const fin = await post<{ paper: { questions: PublicQuestion[]; totalQuestions: number }; key: string }>("/api/papers", {
    title: "E2E paper",
    batches: sealed,
    requestedCount: s.questionCount,
    shuffleQuestions: s.shuffleQuestions,
    shuffleOptions: s.shuffleOptions,
    includeExplanations: s.includeExplanations,
    revealMode: s.revealMode,
    scoring: { marksPerQuestion: s.marksPerQuestion, negativeMarking: s.negativeMarking, passPercentage: s.passPercentage },
  });
  expect(fin.status).toBe(200);
  return { plan, ...fin.body };
}

let pdfDoc: ExtractedDocument;
let docxDoc: ExtractedDocument;
let txtDoc: ExtractedDocument;
let book: ExtractedDocument;

describe("server health", () => {
  it("reports configuration without leaking the key", async () => {
    const res = await fetch(`${BASE}/api/health`);
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(JSON.stringify(body)).not.toContain("e2e-test-key");
  });
  it("replaces the retired gemini-2.5-flash with a current free model", async () => {
    const body = await (await fetch(`${BASE}/api/health`)).json();
    expect(body.model).toBe("gemini-3.5-flash-lite");
    expect(body.modelNote).toMatch(/no longer available/);
  });
});

describe("document upload and extraction", () => {
  beforeAll(async () => {
    pdfDoc = (await upload("os_book.pdf", fixture("os_book.pdf"), "application/pdf")).body;
    docxDoc = (await upload("biology.docx", fixture("biology.docx"))).body;
    txtDoc = (await upload("notes.txt", fixture("notes.txt"), "text/plain")).body;
    book = (await upload("geography-book.txt", syntheticBook(), "text/plain")).body;
  });

  it("extracts a multi-chapter PDF with pages and chapters", () => {
    expect(pdfDoc.pageCount).toBe(8);
    expect(pdfDoc.wordCount).toBeGreaterThan(1500);
    expect(pdfDoc.sections.map((s) => s.title)).toEqual([
      "Chapter 1: Introduction to Operating Systems",
      "Chapter 2: Process Management",
      "Chapter 3: Memory Management",
      "Chapter 4: File Systems",
    ]);
    expect(pdfDoc.needsOcr).toBe(false);
  });
  it("extracts DOCX units and TXT notes", () => {
    expect(docxDoc.sections.map((s) => s.title)).toEqual(["Unit 1: The Cell", "Unit 2: Genetics"]);
    expect(txtDoc.wordCount).toBeGreaterThan(20);
  });
  it("extracts a large book", () => {
    expect(book.sections).toHaveLength(6);
    expect(book.wordCount).toBeGreaterThan(4500);
  });
  it("flags scanned PDFs for OCR", async () => {
    const r = await upload("scanned.pdf", fixture("scanned.pdf"), "application/pdf");
    expect(r.status).toBe(200);
    expect(r.body.needsOcr).toBe(true);
    expect(r.body.emptyPages).toEqual([1, 2, 3]);
  });
  it("rejects password-protected, corrupt, disguised and oversized files with clear codes", async () => {
    expect((await upload("locked.pdf", fixture("locked.pdf"), "application/pdf")).body.error.code).toBe("PDF_PASSWORD");
    expect((await upload("corrupt.pdf", fixture("corrupt.pdf"), "application/pdf")).body.error.code).toBe("PDF_CORRUPT");
    expect((await upload("fake.pdf", "<html>not a pdf</html>", "application/pdf")).body.error.code).toBe("MIME_MISMATCH");
    expect((await upload("tool.exe", "MZ binary")).body.error.code).toBe("UNSUPPORTED_TYPE");
    expect((await upload("empty.txt", "   \n  ", "text/plain")).body.error.code).toBe("EMPTY_FILE");
    // The configured limit (MAX_UPLOAD_MB=200) is enforced before any bytes are sent.
    const tooBig = await post<{ error: { code: string } }>("/api/uploads", { name: "huge.pdf", size: 201 * 1024 * 1024, type: "application/pdf" });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error.code).toBe("FILE_TOO_LARGE");
  });
});

describe("generation, examination and scoring", () => {
  it("generates 10 questions from a PDF with valid structure and no answers exposed", async () => {
    const { paper, key } = await generatePaper([pdfDoc], settings({ questionCount: 10 }));
    expect(paper.totalQuestions).toBe(10);
    expect(paper.questions.map((q) => q.id)).toEqual(Array.from({ length: 10 }, (_, i) => `q${i + 1}`));
    for (const q of paper.questions) {
      expect(q.options.map((o) => o.id)).toEqual(["A", "B", "C", "D"]);
      expect(new Set(q.options.map((o) => o.text.toLowerCase())).size).toBe(4);
      expect(pdfDoc.sections.map((s) => s.title)).toContain(q.source);
    }
    const publicJson = JSON.stringify(paper);
    expect(publicJson).not.toContain("correctAnswer");
    expect(publicJson).not.toContain("explanation");
    expect(key.startsWith("v1.")).toBe(true);
  });

  it("generates 50 and 100 questions from a large book across many batches", async () => {
    for (const count of [50, 100]) {
      const { plan, paper } = await generatePaper([book], settings({ questionCount: count, difficulty: "hard" }));
      expect(plan.batches.length).toBeGreaterThanOrEqual(count / 15);
      expect(paper.totalQuestions).toBe(count);
      expect(new Set(paper.questions.map((q) => q.question)).size).toBe(count);
      expect(paper.questions.every((q) => q.difficulty === "hard")).toBe(true);
      expect(new Set(paper.questions.map((q) => q.source)).size).toBeGreaterThanOrEqual(5);
    }
  }, 120_000);

  it("generates from selected chapters only, and from multiple documents", async () => {
    const chapter = pdfDoc.sections[2];
    const { paper } = await generatePaper([pdfDoc], settings({ sourceMode: "sections", sectionIds: [chapter.id], questionCount: 5 }));
    expect(paper.questions.every((q) => q.source === chapter.title)).toBe(true);
    const multi = await generatePaper([pdfDoc, docxDoc], settings({ questionCount: 20 }));
    const docsSeen = new Set(multi.paper.questions.map((q) => q.source.split(" › ")[0]));
    expect(docsSeen).toEqual(new Set(["os_book.pdf", "biology.docx"]));
  });

  it("scores submissions correctly, including negative marking and unanswered questions", async () => {
    const { paper, key } = await generatePaper([book], settings({ questionCount: 12 }));
    const ids = paper.questions.map((q) => q.id);
    const first = await post<{ summary: ScoreSummary; perQuestion: Record<string, QuestionResult> }>("/api/evaluate", {
      key,
      answers: Object.fromEntries(ids.map((id) => [id, "A"])),
    });
    expect(first.status).toBe(200);
    const truth = Object.fromEntries(ids.map((id) => [id, first.body.perQuestion[id].correctAnswer]));
    expect(first.body.summary.correct + first.body.summary.incorrect).toBe(12);

    // 8 correct, 2 wrong, 2 unanswered → 8 - 0.5 = 7.5 / 12 = 62.5%, pass mark 50%.
    const answers: Record<string, string | null> = {};
    ids.forEach((id, i) => {
      if (i < 8) answers[id] = truth[id];
      else if (i < 10) answers[id] = truth[id] === "A" ? "B" : "A";
      else answers[id] = null;
    });
    const r = await post<{ summary: ScoreSummary; perQuestion: Record<string, QuestionResult> }>("/api/evaluate", { key, answers });
    expect(r.body.summary).toMatchObject({ total: 12, correct: 8, incorrect: 2, unanswered: 2, marks: 7.5, maxMarks: 12, percentage: 62.5, passed: true });
    expect(r.body.perQuestion[ids[8]].status).toBe("incorrect");
    expect(r.body.perQuestion[ids[8]].explanation).toBeTruthy();
    expect(r.body.perQuestion[ids[11]].status).toBe("unanswered");
  });

  it("hides answers before submission in test mode but reveals them in practice mode", async () => {
    const test = await generatePaper([pdfDoc], settings({ questionCount: 3, revealMode: "after" }));
    const denied = await post<{ error: { code: string } }>("/api/evaluate", { key: test.key, answers: {}, revealIds: ["q1"] });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("REVEAL_DISABLED");
    const practice = await generatePaper([pdfDoc], settings({ questionCount: 3, revealMode: "immediate" }));
    const ok = await post<{ revealed: Record<string, { correctAnswer: string }> }>("/api/evaluate", { key: practice.key, answers: {}, revealIds: ["q1"] });
    expect(Object.keys(ok.body.revealed)).toEqual(["q1"]);
  });

  it("rejects a tampered answer key", async () => {
    const { key } = await generatePaper([pdfDoc], settings({ questionCount: 2 }));
    const r = await post<{ error: { code: string } }>("/api/evaluate", { key: key.slice(0, -6) + "AAAAAA", answers: {} });
    expect(r.body.error.code).toBe("INVALID_KEY_TOKEN");
  });
});

describe("AI failure handling", () => {
  const chunks = [{ label: "Chapter 1", text: "The kernel is the core component of an operating system and runs in a privileged mode called kernel mode. User applications run in user mode and request services from the kernel through system calls." }];
  const gen = (topic: string) => post<{ error?: { code: string; retryAfterSec?: number }; questions?: unknown[] }>("/api/generate", { batchId: "f", chunks, count: 2, difficulty: "easy", topic, avoid: [] });

  it("maps rate limits with a retry delay", async () => {
    const r = await gen("RATELIMITME");
    expect(r.status).toBe(429);
    expect(r.body.error).toMatchObject({ code: "RATE_LIMIT", retryAfterSec: 30 });
  });
  it("maps exhausted daily quota and invalid keys", async () => {
    expect((await gen("QUOTATEST")).body.error?.code).toBe("QUOTA");
    const bad = await gen("BADKEYTEST");
    expect(bad.status).toBe(401);
    expect(bad.body.error?.code).toBe("INVALID_KEY");
  });
  it("recovers complete questions from truncated output", async () => {
    const r = await gen("TRUNCTEST");
    expect(r.status).toBe(200);
    expect(r.body.questions!.length).toBeGreaterThanOrEqual(1);
  });
  it("validates requests and never leaks stack traces", async () => {
    const r = await post<{ error: { code: string; message: string } }>("/api/generate", { batchId: "x", chunks: [], count: 500 });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("INVALID_REQUEST");
    expect(r.body.error.message).not.toMatch(/at .*\.ts/);
    const junk = await fetch(`${BASE}/api/evaluate`, { method: "POST", body: "{not json" });
    expect(junk.status).toBe(400);
  });
});

describe("OCR", () => {
  it("recognises text in scanned page slices", async () => {
    const form = new FormData();
    form.append("file", new File([fixture("scanned.pdf") as BlobPart], "pages.pdf", { type: "application/pdf" }));
    form.append("pageCount", "3");
    const res = await fetch(`${BASE}/api/ocr`, { method: "POST", body: form });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.pages).toHaveLength(3);
    expect(body.pages[0]).toMatch(/photosynthesis/);
  });
});
