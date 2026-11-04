import "server-only";
import { AppError } from "@/lib/api/errors";

/** Extracts text page by page. Every page is returned, including empty ones. */
export async function extractPdfPages(input: Uint8Array): Promise<string[]> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  // pdf.js rejects Node Buffers; pass a plain Uint8Array view over the same memory (no copy).
  const buffer = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    pdf = await getDocumentProxy(buffer);
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name !== "PasswordException" && name !== "InvalidPDFException") {
      // Unexpected parser failure: log the parser's message (never document content) for diagnosis.
      console.warn(`[pdf] open failed: ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (name === "PasswordException") {
      throw new AppError("PDF_PASSWORD", "This PDF is password-protected. Remove the password and upload it again.", 422);
    }
    throw new AppError("PDF_CORRUPT", "This PDF couldn’t be opened. It may be damaged or incomplete.", 422);
  }
  try {
    const { text } = await extractText(pdf, { mergePages: false });
    return Array.isArray(text) ? text : [String(text)];
  } catch {
    throw new AppError("PDF_CORRUPT", "Text couldn’t be read from this PDF. It may be damaged.", 422);
  } finally {
    await pdf.cleanup().catch(() => undefined);
  }
}
