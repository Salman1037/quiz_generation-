import { NextResponse } from "next/server";
import { AppError } from "@/lib/api/errors";
import { errorResponse, readJson } from "@/lib/api/respond";
import { evaluateRequestSchema } from "@/lib/validation/schemas";
import { unseal } from "@/lib/security/seal";
import { scoreAnswers } from "@/lib/exam/scoring";
import type { KeyPayload } from "@/lib/exam/finalize";

export const runtime = "nodejs";

/**
 * Scores a submission against the encrypted key. With `revealIds` it instead reveals
 * individual answers, which is only allowed for papers created in practice mode.
 */
export async function POST(req: Request) {
  try {
    const body = evaluateRequestSchema.parse(await readJson(req, 1_000_000));
    const key = unseal<KeyPayload>(body.key, "key");

    if (body.revealIds) {
      if (key.revealMode !== "immediate") {
        throw new AppError("REVEAL_DISABLED", "Answers for this paper are only shown after you submit.", 403);
      }
      const revealed = Object.fromEntries(
        body.revealIds
          .filter((id) => key.answers[id])
          .map((id) => [
            id,
            {
              correctAnswer: key.answers[id].correctAnswer,
              explanation: key.includeExplanations ? key.answers[id].explanation || null : null,
            },
          ]),
      );
      return NextResponse.json({ revealed });
    }

    const { summary, perQuestion } = scoreAnswers(key.answers, body.answers, key.scoring, key.includeExplanations);
    return NextResponse.json({ summary, perQuestion, paperId: key.paperId });
  } catch (err) {
    return errorResponse(err, "evaluate");
  }
}
