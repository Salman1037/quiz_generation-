import { NextResponse } from "next/server";
import { AppError } from "@/lib/api/errors";
import { errorResponse } from "@/lib/api/respond";
import { callGemini } from "@/lib/ai/gemini";
import { parseItems } from "@/lib/ai/json";
import { buildOcrPrompt, OCR_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { geminiOcrSchema } from "@/lib/validation/schemas";
import { sniffMatches } from "@/lib/documents/plain";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_OCR_BYTES = 14 * 1024 * 1024; // browser slices are capped at 12 MB; Gemini inline requests allow about 20 MB
const MAX_OCR_PAGES = 10;

/**
 * Recognises text in a small slice of a scanned PDF (the browser splits the file into
 * a few pages per request). Uses Gemini's document understanding, so no extra service is needed.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData().catch(() => {
      throw new AppError("INVALID_REQUEST", "The upload was incomplete.", 400);
    });
    const file = form.get("file");
    const pageCount = Number(form.get("pageCount"));
    if (!(file instanceof File)) throw new AppError("INVALID_REQUEST", "No file was attached.", 400);
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_OCR_PAGES) {
      throw new AppError("INVALID_REQUEST", "Invalid page count.", 400);
    }
    if (file.size > MAX_OCR_BYTES) throw new AppError("FILE_TOO_LARGE", "These pages are too large to process at once.", 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!sniffMatches("pdf", bytes)) throw new AppError("MIME_MISMATCH", "OCR only accepts PDF data.", 415);

    const result = await callGemini({
      system: OCR_SYSTEM_PROMPT,
      parts: [
        { inlineData: { mimeType: "application/pdf", data: Buffer.from(bytes).toString("base64") } },
        { text: buildOcrPrompt(pageCount) },
      ],
      responseSchema: geminiOcrSchema,
      temperature: 0,
    });
    const { items } = parseItems(result.text, "pages");
    const pages: string[] = Array.from({ length: pageCount }, () => "");
    for (const item of items) {
      const p = item as { page?: number; text?: string };
      if (typeof p.page === "number" && p.page >= 1 && p.page <= pageCount && typeof p.text === "string") {
        pages[p.page - 1] = p.text;
      }
    }
    return NextResponse.json({ pages, truncated: result.truncated });
  } catch (err) {
    return errorResponse(err, "ocr");
  }
}
