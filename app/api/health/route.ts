import { NextResponse } from "next/server";
import { getGeminiConfig, DEFAULT_MODEL, resolveModel } from "@/lib/ai/gemini";
import { AppError } from "@/lib/api/errors";
import { maxUploadMb, uploadChunkBytes } from "@/lib/api/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports whether the server is configured and which model is in use. Never returns the key itself. */
export async function GET() {
  const cfg = getGeminiConfig();
  let model = cfg?.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  let modelNote: string | null = null;
  let keyProblem: string | null = null;
  if (cfg) {
    try {
      const r = await resolveModel(cfg);
      if (r.replaced) modelNote = `“${cfg.model}” is no longer available, so ${r.model} is being used. Set GEMINI_MODEL=${r.model} to make this permanent.`;
      model = r.model;
    } catch (err) {
      // Listing models can fail offline or with a bad key; generation reports the precise error later.
      if (err instanceof AppError && err.code === "INVALID_KEY") keyProblem = err.message;
    }
  }
  return NextResponse.json({
    configured: Boolean(cfg),
    model,
    modelNote,
    keyProblem,
    rpm: cfg?.rpm ?? 8,
    maxUploadMb: maxUploadMb(),
    chunkSizeMb: Math.round((uploadChunkBytes() / (1024 * 1024)) * 10) / 10,
  });
}
