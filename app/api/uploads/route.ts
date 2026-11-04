import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJson } from "@/lib/api/respond";
import { maxUploadMb, uploadChunkBytes } from "@/lib/api/config";
import { getUploadStore } from "@/lib/uploads/instance";

export const runtime = "nodejs";

const initSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().positive(),
  type: z.string().max(200).default(""),
});

/** Starts a resumable upload. Validates name, type and size against MAX_UPLOAD_MB before any bytes are sent. */
export async function POST(req: Request) {
  try {
    const body = initSchema.parse(await readJson(req, 10_000));
    const meta = await getUploadStore().create(
      { name: body.name, size: body.size, mime: body.type },
      { maxMb: maxUploadMb(), chunkBytes: uploadChunkBytes() },
    );
    return NextResponse.json({ uploadId: meta.id, chunkSize: meta.chunkSize, totalChunks: meta.totalChunks, maxUploadMb: maxUploadMb() }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "uploads:init");
  }
}
