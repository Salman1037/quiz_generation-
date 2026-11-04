import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/respond";
import { getUploadStore } from "@/lib/uploads/instance";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Which parts the server already has, so an interrupted upload can resume. */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const store = getUploadStore();
    const meta = await store.meta(id);
    return NextResponse.json({ uploadId: id, totalChunks: meta.totalChunks, chunkSize: meta.chunkSize, size: meta.size, received: await store.received(id) });
  } catch (err) {
    return errorResponse(err, "uploads:status");
  }
}

/** Cancels an upload and deletes its parts. */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await getUploadStore().remove(id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err, "uploads:delete");
  }
}
