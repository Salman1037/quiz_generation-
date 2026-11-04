import { NextResponse } from "next/server";
import { AppError } from "@/lib/api/errors";
import { errorResponse } from "@/lib/api/respond";
import { maxUploadMb } from "@/lib/api/config";
import { checkUpload } from "@/lib/documents/limits";
import { extractDocument } from "@/lib/documents/extract";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Single-request upload, kept for API clients and small files. The app itself uses the
 * chunked /api/uploads flow, which avoids buffering a whole large request in memory.
 */
export async function POST(req: Request) {
  try {
    const limitMb = maxUploadMb();
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > (limitMb + 1) * 1024 * 1024) {
      throw new AppError("FILE_TOO_LARGE", `Files larger than ${limitMb} MB can’t be uploaded.`, 413);
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new AppError("INVALID_REQUEST", "The upload was incomplete. Please try again.", 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("INVALID_REQUEST", "No file was attached.", 400);
    const name = file.name.replace(/[\\/]/g, "_").slice(0, 200);
    const check = checkUpload(name, file.size, file.type, limitMb);
    if (!check.ok) throw new AppError(check.code as never, check.message, check.code === "FILE_TOO_LARGE" ? 413 : 415);
    const doc = await extractDocument({ name, size: file.size, kind: check.kind, bytes: new Uint8Array(await file.arrayBuffer()) });
    return NextResponse.json(doc);
  } catch (err) {
    return errorResponse(err, "documents");
  }
}
