import "server-only";
import { AppError } from "@/lib/api/errors";

export async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch {
    throw new AppError("DOCX_CORRUPT", "This Word document couldn’t be read. It may be damaged or not a real .docx file.", 422);
  }
}
