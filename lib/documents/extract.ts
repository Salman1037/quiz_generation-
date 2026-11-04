import "server-only";
import { createHash } from "crypto";
import type { DocKind, ExtractedDocument } from "@/types/document";
import { AppError } from "@/lib/api/errors";
import { extractPdfPages } from "./pdf";
import { extractDocxText } from "./docx";
import { decodeTextFile, sniffMatches } from "./plain";
import { assembleDocument } from "./assemble";

/** Shared extraction for both upload routes: signature check, hashing, parsing, sectioning. */
export async function extractDocument(input: { name: string; size: number; kind: DocKind; bytes: Uint8Array; hash?: string }): Promise<ExtractedDocument> {
  const { name, kind, bytes } = input;
  if (!sniffMatches(kind, bytes)) {
    throw new AppError("MIME_MISMATCH", `${name} doesn’t contain valid ${kind.toUpperCase()} data, even though its name ends in .${kind}.`, 415);
  }
  const hash = input.hash ?? createHash("sha256").update(bytes).digest("hex");
  let doc: ExtractedDocument;
  if (kind === "pdf") {
    doc = assembleDocument({ name, size: input.size, kind, hash, pages: await extractPdfPages(bytes) });
  } else if (kind === "docx") {
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    doc = assembleDocument({ name, size: input.size, kind, hash, text: await extractDocxText(buf) });
  } else {
    doc = assembleDocument({ name, size: input.size, kind, hash, text: decodeTextFile(bytes) });
  }
  if (doc.wordCount === 0 && kind !== "pdf") throw new AppError("EMPTY_FILE", `${name} has no readable text.`, 422);
  return doc;
}
