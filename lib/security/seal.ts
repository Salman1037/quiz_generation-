import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { deflateRawSync, inflateRawSync } from "zlib";
import { AppError } from "@/lib/api/errors";

/**
 * Answer keys never reach the browser in readable form. The server encrypts them
 * (AES-256-GCM, compressed) and the browser only holds the opaque token, which it
 * sends back for scoring. No database is needed.
 */
const VERSION = "v1";

function secretKey(): Buffer {
  const secret = process.env.EXAM_SECRET || process.env.GEMINI_API_KEY;
  if (!secret) throw new AppError("MISSING_KEY", "The server has no GEMINI_API_KEY configured.", 503);
  return createHash("sha256").update(`quizforge-exam-key-${VERSION}:${secret}`).digest();
}

export function seal<T extends { kind: string }>(payload: T): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const compressed = deflateRawSync(Buffer.from(JSON.stringify(payload), "utf8"));
  const body = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${Buffer.concat([iv, tag, body]).toString("base64url")}`;
}

export function unseal<T extends { kind: string }>(token: string, kind: T["kind"]): T {
  try {
    const [version, data] = token.split(".");
    if (version !== VERSION || !data) throw new Error("bad version");
    const raw = Buffer.from(data, "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const body = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
    decipher.setAuthTag(tag);
    const plain = inflateRawSync(Buffer.concat([decipher.update(body), decipher.final()]));
    const parsed = JSON.parse(plain.toString("utf8")) as T;
    if (parsed.kind !== kind) throw new Error("wrong kind");
    return parsed;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      "INVALID_KEY_TOKEN",
      "This paper’s answer key can’t be read. It may have been created with a different server key. Generate a new paper.",
      400,
    );
  }
}
