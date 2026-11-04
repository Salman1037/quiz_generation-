import { NextResponse } from "next/server";
import { AppError } from "@/lib/api/errors";
import { errorResponse, readJson } from "@/lib/api/respond";
import { finalizeRequestSchema } from "@/lib/validation/schemas";
import { seal, unseal } from "@/lib/security/seal";
import { finalizeQuestions, toPublic, type BatchPayload, type KeyPayload } from "@/lib/exam/finalize";
import { randomId } from "@/lib/exam/utilities";

export const runtime = "nodejs";

/** Merges generated batches into a final paper and issues its encrypted answer key. */
export async function POST(req: Request) {
  try {
    const body = finalizeRequestSchema.parse(await readJson(req, 8_000_000));
    const all = body.batches.flatMap((token) => unseal<BatchPayload>(token, "batch").questions);
    const paperId = randomId("p_");
    const { questions, duplicatesRemoved } = finalizeQuestions({
      paperId,
      questions: all,
      requestedCount: body.requestedCount,
      shuffleQuestions: body.shuffleQuestions,
      shuffleOptions: body.shuffleOptions,
    });
    if (!questions.length) {
      throw new AppError("NO_QUESTIONS", "No valid questions could be produced from this material.", 422);
    }
    const key: KeyPayload = {
      kind: "key",
      paperId,
      createdAt: Date.now(),
      revealMode: body.revealMode,
      includeExplanations: body.includeExplanations,
      scoring: body.scoring,
      answers: Object.fromEntries(questions.map((q) => [q.id, { correctAnswer: q.correctAnswer, explanation: q.explanation }])),
    };
    return NextResponse.json({
      paper: {
        id: paperId,
        title: body.title,
        totalQuestions: questions.length,
        questions: questions.map(toPublic),
      },
      key: seal(key),
      requested: body.requestedCount,
      duplicatesRemoved,
    });
  } catch (err) {
    return errorResponse(err, "papers");
  }
}
