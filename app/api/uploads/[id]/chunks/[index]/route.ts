import { NextResponse } from "next/server";
import { AppError } from "@/lib/api/errors";
import { errorResponse } from "@/lib/api/respond";
import { uploadChunkBytes } from "@/lib/api/config";
import { getUploadStore } from "@/lib/uploads/instance";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; index: string }> };

/** Receives one part (raw bytes). Idempotent: re-sending a part replaces it. */
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { id, index } = await ctx.params;
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > uploadChunkBytes() + 1024) {
      throw new AppError("CHUNK_INVALID", "This part is larger than the server’s chunk size.", 413);
    }
    let data: Uint8Array;
    try {
      data = new Uint8Array(await req.arrayBuffer());
    } catch {
      throw new AppError("CHUNK_INVALID", "The part was interrupted while uploading. It will be sent again.", 400);
    }
    const result = await getUploadStore().writeChunk(id, Number(index), data);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err, "uploads:chunk");
  }
}
