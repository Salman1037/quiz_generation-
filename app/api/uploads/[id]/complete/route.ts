import { NextResponse } from "next/server";
import { AppError } from "@/lib/api/errors";
import { errorResponse } from "@/lib/api/respond";
import { getUploadStore } from "@/lib/uploads/instance";
import { extractDocument } from "@/lib/documents/extract";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Verifies every part arrived (exact byte count), extracts the text, then deletes the parts.
 * Only extracted text goes back to the browser; the original file never goes to the AI.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const store = getUploadStore();
  try {
    const { meta, bytes, hash } = await store.assemble(id);
    const doc = await extractDocument({ name: meta.name, size: meta.size, kind: meta.kind, bytes, hash });
    await store.remove(id);
    return NextResponse.json(doc);
  } catch (err) {
    if (err instanceof AppError && err.code === "UPLOAD_INCOMPLETE") {
      const missing = (err as AppError & { missing?: number[] }).missing ?? [];
      return NextResponse.json({ error: { code: err.code, message: err.message }, missing }, { status: 409 });
    }
    // Parsing failures (corrupt, password, etc.) are final: clean up the parts.
    if (err instanceof AppError && err.code !== "UPLOAD_NOT_FOUND") await store.remove(id).catch(() => undefined);
    return errorResponse(err, "uploads:complete");
  }
}
