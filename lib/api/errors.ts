/** Error codes shared between server responses and client messaging. */
export type ErrorCode =
  | "MISSING_KEY"
  | "INVALID_KEY"
  | "RATE_LIMIT"
  | "QUOTA"
  | "TIMEOUT"
  | "NETWORK"
  | "BAD_RESPONSE"
  | "SAFETY"
  | "UPSTREAM"
  | "MODEL_NOT_FOUND"
  | "INVALID_REQUEST"
  | "UNSUPPORTED_TYPE"
  | "MIME_MISMATCH"
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "PDF_PASSWORD"
  | "PDF_CORRUPT"
  | "DOCX_CORRUPT"
  | "TXT_BINARY"
  | "INSUFFICIENT_CONTENT"
  | "TOPIC_NOT_FOUND"
  | "NO_QUESTIONS"
  | "INVALID_KEY_TOKEN"
  | "REVEAL_DISABLED"
  | "UPLOAD_NOT_FOUND"
  | "UPLOAD_INCOMPLETE"
  | "CHUNK_INVALID"
  | "UPLOAD_STORE_UNAVAILABLE"
  | "TOO_MANY_UPLOADS"
  | "INTERNAL";

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; retryAfterSec?: number };
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status = 400,
    public retryAfterSec?: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function isRetryableCode(code: ErrorCode): boolean {
  return code === "UPSTREAM" || code === "NETWORK" || code === "TIMEOUT" || code === "BAD_RESPONSE";
}
