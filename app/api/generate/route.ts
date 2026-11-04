import { NextResponse } from "next/server";
import { errorResponse, readJson } from "@/lib/api/respond";
import { generateBatch } from "@/lib/ai/generation";
import { requireGeminiConfig } from "@/lib/ai/gemini";
import { generateRequestSchema } from "@/lib/validation/schemas";
import { seal } from "@/lib/security/seal";
import { toPublic, type BatchPayload } from "@/lib/exam/finalize";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Generates one batch of questions. The browser drives a sequence of these requests
 * (with paced concurrency) so large books never go to the model in a single call.
 * Answers are returned only inside an encrypted token.
 */
export async function POST(req: Request) {
  try {
    requireGeminiConfig();
    const body = generateRequestSchema.parse(await readJson(req, 400_000));
    const outcome = await generateBatch(body, undefined, req.signal);
    const payload: BatchPayload = { kind: "batch", createdAt: Date.now(), questions: outcome.questions };
    return NextResponse.json({
      batchId: body.batchId,
      sealed: seal(payload),
      questions: outcome.questions.map(toPublic),
      stats: outcome.stats,
    });
  } catch (err) {
    return errorResponse(err, "generate");
  }
}
