import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, type ApiErrorBody } from "./errors";

/** Converts any thrown error into a safe JSON response. Never leaks stack traces. */
export function errorResponse(err: unknown, context: string): NextResponse<ApiErrorBody> {
  if (err instanceof AppError) {
    const headers: Record<string, string> = {};
    if (err.retryAfterSec) headers["Retry-After"] = String(err.retryAfterSec);
    if (err.status >= 500) console.warn(`[${context}] ${err.code}: ${err.message}`);
    return NextResponse.json(
      { error: { code: err.code, message: err.message, retryAfterSec: err.retryAfterSec } },
      { status: err.status, headers },
    );
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const where = first?.path.length ? ` (${first.path.join(".")})` : "";
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: `The request was not valid${where}: ${first?.message ?? "unknown issue"}.` } },
      { status: 400 },
    );
  }
  // Log only the message, never request bodies or document text.
  console.error(`[${context}] unexpected error:`, err instanceof Error ? err.message : String(err));
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong on the server. Please try again." } },
    { status: 500 },
  );
}

export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new AppError("INVALID_REQUEST", "The request is too large.", 413);
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError("INVALID_REQUEST", "The request is too large.", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("INVALID_REQUEST", "The request body is not valid JSON.", 400);
  }
}
