# QuizForge AI

**Turn your books into intelligent examinations.**

QuizForge AI reads the material you upload (a complete book, a PDF, a Word document or plain-text notes), writes multiple-choice questions from that material only using Google's Gemini free tier, and lets you sit the paper in the browser with instant marking, a results dashboard and PDF export.

There is no sign-up, no database and no paid service. Your documents and results stay in your browser; the server only processes them in memory.

---

## Contents

1. [Features](#features)
2. [Quick start](#quick-start)
3. [Configuration](#configuration)
4. [How it works](#how-it-works)
5. [Project structure](#project-structure)
6. [Testing](#testing)
7. [Deployment](#deployment)
8. [Large files](#large-files)
9. [Troubleshooting](#troubleshooting)
10. [Limitations and privacy](#limitations-and-privacy)

---

## Features

**Documents**
- Drag-and-drop upload of several PDF, DOCX and TXT files at once, including whole books up to 200 MB (configurable), using resumable chunked uploads with real progress and automatic retries.
- Server-side validation of extension, MIME type, file signature and size; duplicates are detected by content hash, even when renamed.
- Real upload progress, then text extraction with word, page and chapter counts.
- Chapter, unit and section detection (with table-of-contents filtering and running-header merging), falling back to page ranges or word-based parts.
- Clear handling of password-protected, corrupted, empty and disguised files.
- Scanned PDFs are detected and reported, never silently skipped. An optional **OCR** step reads a chosen page range with Gemini.

**Generation**
- 10, 20, 30, 50, 100 or a custom number of questions (up to 200).
- Easy, medium, hard or mixed difficulty.
- Source: everything uploaded, one document, selected chapters or sections, or a custom topic (with a live check that the topic appears in your text).
- Every question has four distinct options and exactly one correct answer. Each must quote evidence that is verified against your text before it is kept.
- Near-duplicate questions are removed across the whole paper.
- If your material can’t support the requested number, the app tells you how many it can support instead of inventing questions.
- Large books are split into chunks and sent as many small requests, two at a time, paced to the free tier’s rate limit, with live progress and cancellation.

**Examination**
- One question at a time with clickable answer bubbles, an answer-sheet navigator, mark-for-review and clear-answer.
- Answered, unanswered and marked counts with a progress bar.
- Test mode (answers after submitting) or practice mode (each answer checked immediately).
- Optional timer with low-time warning and automatic submission, computed from a fixed deadline so it survives refreshes.
- Keyboard shortcuts: **A–D** or **1–4** to answer, **← →** to move, **M** to mark.
- Progress is saved in the browser, so refreshing loses nothing.

**Results**
- Score ring, marks, percentage, time taken and pass/fail.
- Optional negative marking.
- Accuracy by difficulty and by chapter, weakest chapters first.
- Full review with green (correct) and red (your wrong choice) answers and explanations, filterable by all, incorrect, correct or unanswered.
- Retake the same paper (questions reshuffled) or generate a new one; recent papers are saved locally.
- A4 PDF downloads: question paper, paper with answer key, and result report. A print view handles every language and script.

---

## Quick start

Requirements: **Node.js 20.3 or newer** and a free Gemini API key.

```bash
# 1. Install dependencies
npm install

# 2. Configure your key (one-time)
cp .env.example .env.local
#    then edit .env.local and set GEMINI_API_KEY=...

# 3. Run
npm run dev
```

Open http://localhost:3000.

**Getting a key:** go to [Google AI Studio](https://aistudio.google.com/apikey), sign in, and choose **Create API key**. No billing is needed for the free tier.

If the key is missing, the home page shows a setup guide, and uploads still work.

For a production build on your own machine:

```bash
npm run build
npm start
```

---

## Configuration

All settings are environment variables, read **only on the server**. None use the `NEXT_PUBLIC_` prefix, so nothing reaches the browser.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GEMINI_API_KEY` | Yes | — | Your Google AI Studio key. |
| `GEMINI_MODEL` | No | `gemini-3.5-flash-lite` | Any model your key can use. If it’s retired or unavailable, the app picks the best available Flash model automatically. |
| `GEMINI_RPM` | No | `8` | Requests per minute the app paces itself to. Raise it if your project has higher limits. |
| `GEMINI_MAX_OUTPUT_TOKENS` | No | `16384` | Output token cap per generation request. |
| `EXAM_SECRET` | No | derived from the API key | Secret for encrypting answer keys. Set it if you want papers to stay valid after rotating your API key. |
| `MAX_UPLOAD_MB` | No | `200` | Per-file upload limit, shared by browser and server (max 2048). |
| `UPLOAD_CHUNK_MB` | No | `8` | Size of each upload part. Proxies must accept bodies at least this large. |
| `UPLOAD_TMP_DIR` | No | system temp | Where parts wait until the upload completes. Abandoned uploads are deleted after 2 hours. |
| `GEMINI_API_BASE_URL` | No | Google’s endpoint | Override for proxies and local testing only. |

**Choosing a model:** Google retires Gemini models regularly; the entire 2.5 family was shut down on October 16, 2026. When the configured model returns “not found”, the server lists the models your key can use, switches to the best current Flash model (stable before preview, Flash-Lite first for its larger free daily quota), and the home page tells you which one it chose. As of November 2026, `gemini-3.5-flash-lite` allows about 500 free requests a day (enough for several 100-question papers). The full Flash models (`gemini-3.6-flash`, `gemini-3.8-flash`) write slightly better questions but allow only about 20 free requests a day. Limits per project are shown in Google AI Studio.

---

## How it works

```
Browser                                          Server (Next.js route handlers)
───────                                          ──────────────────────────────
Upload file ───────────────────────────────────▶ POST /api/documents
                                                  validate → extract (unpdf / mammoth)
          ◀── text, pages, chapters, warnings ─── → clean → detect sections

Plan (lib/ai/planning.ts)
  choose source → chunk by chapter → group into
  batches of about 10 questions (≤ 5,500 words each)

For each batch (2 in flight, paced to RPM) ────▶ POST /api/generate
                                                  prompt Gemini (JSON schema output)
                                                  → parse (salvages truncated output)
                                                  → validate each question
                                                  → verify quoted evidence in source
                                                  → de-duplicate; re-ask for shortfall
          ◀── public questions + encrypted batch ─

Top-up rounds if short (max 2)

Finalize ──────────────────────────────────────▶ POST /api/papers
                                                  de-duplicate across batches, trim,
          ◀── paper (no answers) + encrypted key  shuffle options & order, number q1…qn

Sit the exam (state saved in localStorage)

Submit ────────────────────────────────────────▶ POST /api/evaluate
          ◀── score, per-question results ──────  decrypt key → score
```

**Why answers are encrypted rather than stored:** the brief asks for answers to be checked on the server without a database. The server encrypts each answer key (AES-256-GCM, compressed) and the browser keeps only the opaque token, sending it back with the submission. In test mode the server refuses to reveal individual answers before submission.

**Quality checks on every question:**
1. It parses into the required shape (question, four options A–D, one correct answer).
2. The options are distinct, and none is "all/none of the above", since options are shuffled.
3. The correct answer resolves to exactly one option.
4. The model’s quoted evidence is found in the source text (most of its words, plus at least one exact four-word run). Questions with invented evidence are dropped, and the question’s source chapter is set from where the evidence was found.
5. It isn’t a near-duplicate of any earlier question (stem similarity, or a shared answer with a similar stem).

**Final paper format** (decrypted key plus public questions) matches:

```json
{
  "title": "Generated Examination",
  "totalQuestions": 50,
  "questions": [
    {
      "id": "q1",
      "question": "…",
      "options": [{ "id": "A", "text": "…" }, { "id": "B", "text": "…" }, { "id": "C", "text": "…" }, { "id": "D", "text": "…" }],
      "correctAnswer": "B",
      "explanation": "…",
      "difficulty": "medium",
      "source": "Chapter 1: Introduction"
    }
  ]
}
```

---

## Project structure

```
app/
  page.tsx                 Workspace: upload, configure, generate
  exam/page.tsx            Examination interface
  results/page.tsx         Results dashboard
  print/page.tsx           Print-friendly paper, answer key and report
  providers.tsx            Workspace + exam state providers
  api/
    health/route.ts        Configuration status (never returns the key)
    documents/route.ts     Upload validation and text extraction
    generate/route.ts      One batch of validated questions
    papers/route.ts        Merge batches into a paper; issue encrypted key
    evaluate/route.ts      Score a submission / practice-mode reveal
    ocr/route.ts           OCR for scanned page slices
components/
  layout/  upload/  generator/  exam/  results/  home/  setup/  ui/
lib/
  ai/          gemini.ts (client, errors, retries) · prompts.ts · generation.ts · planning.ts · json.ts
  documents/   pdf.ts · docx.ts · plain.ts · text.ts · chunking.ts · assemble.ts · topic.ts · limits.ts
  validation/  schemas.ts (Zod) · questions.ts · dedupe.ts
  exam/        scoring.ts · finalize.ts · utilities.ts
  security/    seal.ts (answer-key encryption)
  export/      pdf.ts (jsPDF A4 export)
  client/      api.ts · generate.ts (orchestrator) · workspace.tsx · exam-store.tsx · ocr.ts · errors.ts · storage.ts
  api/         errors.ts · respond.ts · config.ts
types/         document.ts · exam.ts
tests/         unit tests, fixtures, e2e/
scripts/       mock-gemini.mjs · e2e.mjs
```

## Large files

Books of 100–200 MB upload reliably through a **resumable chunked pipeline**:

1. The browser asks `POST /api/uploads` to start. The server checks name, type and size against `MAX_UPLOAD_MB` **before any bytes are sent**.
2. The file is sent in parts of `UPLOAD_CHUNK_MB` (8 MB) with `PUT /api/uploads/{id}/chunks/{n}`, three at a time. The browser reads one slice at a time (`File.slice`), so a 200 MB book is never loaded into memory at once. Progress is measured in bytes actually sent.
3. A failed part is retried up to 6 times with exponential backoff. If the device goes offline, the upload pauses until it reconnects. Re-sending a part is always safe.
4. `POST /api/uploads/{id}/complete` checks that every part is present with the exact size and that the total equals the declared size. It never processes a truncated file; if parts are missing it lists them and the browser re-sends only those. It then extracts the text and deletes the parts.
5. **Retry** after an error resumes the same session (`GET /api/uploads/{id}` lists the parts already received). This also works after a page refresh if the same file is added again within 2 hours.

Only the **extracted text** is used for generation, split into chunks of a few thousand words per AI request. The original PDF is never sent to Gemini. The one exception is optional OCR of scanned pages, which sends small page slices (up to 12 MB each) to Gemini.

**Memory:** the server holds one file in memory while extracting it (about the file size). Allow roughly 3× `MAX_UPLOAD_MB` of RAM per simultaneous large upload.

### Every size restriction, and its setting

| Layer | Restriction | Setting |
|---|---|---|
| App (browser and server) | Per-file limit | `MAX_UPLOAD_MB` (default 200). The browser reads it from `/api/health`. |
| App | Part size | `UPLOAD_CHUNK_MB` (default 8) |
| App | Active upload sessions | 24 at once; abandoned sessions are swept after 2 hours |
| App | Single-request `/api/documents` (API clients only) | Same `MAX_UPLOAD_MB` |
| App | OCR slice | 12 MB per request (Gemini’s inline request limit is about 20 MB) |
| Next.js route handlers | No built-in body limit in the App Router (the 1 MB `bodySizeLimit` applies only to Server Actions, which this app doesn’t use) | — |
| Next.js middleware | None in this app, so the middleware body limit doesn’t apply | — |
| nginx | `client_max_body_size` defaults to **1 MB** | Set to at least the part size (example below) |
| Cloudflare | 100 MB per request on Free/Pro | Fine: parts are 8 MB |
| Vercel / serverless | About 4.5 MB per request, and each request may run on a different instance with its own temp storage | See below |

### nginx example

```nginx
server {
    listen 443 ssl;
    server_name quizforge.example.com;

    client_max_body_size 16m;        # must be ≥ UPLOAD_CHUNK_MB
    proxy_request_buffering off;     # stream parts straight to the app
    proxy_read_timeout 300s;         # text extraction of a 200 MB book can take a while

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Serverless hosting (Vercel and similar)

Chunked uploads need all parts on one server’s disk, which serverless platforms don’t guarantee, and their request limit is smaller than a part. On such hosts the app detects the problem: PDFs then fall back to being read **in the browser** (which needs the whole file in memory), and other formats show a clear error. For large books, deploy on a single Node server or container (VPS, Render, Railway, Fly.io, Docker). If you must use Vercel, set `UPLOAD_CHUNK_MB=4`.

---

## Testing

```bash
npm run lint        # ESLint (Next.js core-web-vitals + TypeScript rules)
npm run typecheck   # tsc --noEmit
npm run test        # unit tests (Vitest)
npm run build       # production build
npm run test:e2e    # end-to-end API journey (run after `npm run build`)
```

**Unit tests** (`tests/*.test.ts`) cover:
- text cleaning, chapter detection, table-of-contents handling and chunking
- generation planning, capacity limits, chapter and topic selection, and top-ups
- question normalisation and rejection rules, evidence verification and de-duplication
- truncated-JSON recovery
- Gemini error mapping (invalid key, rate limit vs daily quota, unknown model) and retries
- the generation engine with a mocked model
- answer-key encryption and tamper detection
- scoring, negative marking and pass marks
- option shuffling that keeps answers attached, and timer arithmetic

**End-to-end tests** (`tests/e2e/`) include a **100 MB, 300-page PDF** uploaded in parts with injected faults (truncated part, duplicate part, early completion), verified byte-for-byte by SHA-256 and extracted to the last page. The suite in `journey.e2e.ts` start the real production server against a local mock of the Gemini API (`scripts/mock-gemini.mjs`), so they need no key or network. They exercise the HTTP API:
- uploading PDF, DOCX, TXT and a large book
- scanned, password-protected, corrupt, disguised, empty and oversized files
- generating 10, 50 and 100 questions, from selected chapters, and from several documents at once
- checking structure, uniqueness, and that no answers appear in the public paper
- scoring with negative marking and unanswered questions
- test-mode answer hiding and practice-mode reveal
- tampered keys, rate limits, daily quota, invalid keys and truncated AI output
- request validation and OCR

**Manual checks with a real key.** Some things depend on the live model and a real browser:
1. Upload a real textbook PDF, generate 10 questions, and spot-check that questions match the text.
2. Generate 50 from a book and watch the progress view, including any rate-limit pause.
3. Sit the exam: change answers, mark for review, navigate with the grid and keyboard, then refresh mid-exam and confirm nothing is lost.
4. Enable a 1-minute timer and let it auto-submit.
5. Submit with some questions unanswered; check the green/red review and the score.
6. Download all three PDFs and open the print view.
7. Set `GEMINI_API_KEY` to an invalid value, restart, and confirm the error explains how to fix it.
8. Check the layout on a phone (the answer sheet becomes a bottom panel).

---

## Deployment

### Any Node.js host (recommended for large books)

```bash
npm ci
npm run build
GEMINI_API_KEY=... npm start   # listens on port 3000; set PORT to change
```

This works on a VPS, Render, Railway, Fly.io or Docker. Put it behind HTTPS: the browser’s duplicate-detection hashing needs a secure context, though it falls back gracefully without one.

Example `Dockerfile`:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
```

### Vercel

1. Import the repository in Vercel.
2. Add `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) under **Settings → Environment Variables**.
3. Deploy.

**Important:** see [Large files](#large-files). Large uploads need a single-server deployment; on Vercel, big PDFs fall back to in-browser reading. Generation itself is unaffected, because the browser sends small batches.

### Rate limits on shared deployments

Free-tier limits apply **per Google Cloud project**, so everyone using one deployment shares the quota. For public deployments, consider a paid tier or keep the deployment private.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| “Gemini API key not configured” | Create `.env.local` with `GEMINI_API_KEY`, then restart `npm run dev`. |
| “API key rejected” | Create a new key in AI Studio; make sure there are no quotes or spaces around it. |
| “Model not available” / “no free-tier quota” | The app normally switches models by itself; if it can’t, set `GEMINI_MODEL=gemini-3.5-flash-lite` (or another model listed in AI Studio) and restart. |
| Long pauses during generation | That’s the free tier’s per-minute limit; the app waits and resumes automatically. |
| “Daily quota used up” | Quota resets at midnight Pacific time. Questions already generated are kept. |
| Upload stops at a percentage | It retries automatically. If it shows an error, select **Retry**: parts already received aren’t sent again. Behind nginx, check `client_max_body_size` (see Large files). |
| “Not enough material” | Choose fewer questions, more chapters, or add documents. |
| Scanned PDF warning | Use **Run OCR** on the page range you need. |
| “Answer key unreadable” | The API key or `EXAM_SECRET` changed since the paper was made. Generate a new paper, and set `EXAM_SECRET` to avoid this. |
| Non-Latin text shows as `?` in downloaded PDFs | Use the print view and “Save as PDF”; it supports every script. |

---

## Limitations and privacy

- **Free-tier data use:** on Google’s free tier, inputs and outputs may be used by Google to improve its products. Don’t upload confidential material unless you use a paid Gemini tier.
- **Where data goes:** uploaded files are processed in server memory and never written to disk or logged. Document text is sent only to the Gemini API. Papers, answers and results live in your browser’s localStorage.
- **Question quality:** evidence checking guarantees each question is tied to a real passage in your text, but it can’t judge pedagogy. Review important papers before using them formally.
- **Answer secrecy:** answer keys are encrypted, which stops casual peeking in test mode. This is a self-study tool, though: anyone holding the token can submit a blank paper to see the answers.
- **Scanned PDFs:** OCR quality depends on scan quality and uses one Gemini request per 5 pages.
- **PDF parsing:** text order in complex multi-column layouts may be imperfect, and equations and images aren’t interpreted.
#   q u i z _ g e n e r a t i o n -  
 