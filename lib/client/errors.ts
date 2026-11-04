import type { ErrorCode } from "@/lib/api/errors";

export class ClientError extends Error {
  constructor(
    public code: ErrorCode | "ABORTED" | "OFFLINE",
    message: string,
    public status = 0,
    public retryAfterSec?: number,
  ) {
    super(message);
    this.name = "ClientError";
  }
}

export interface ErrorPresentation {
  title: string;
  hint: string;
}

/** Human-readable titles and recovery hints for every error the app can surface. */
export function presentError(err: unknown): ErrorPresentation & { message: string; code: string } {
  const e = err instanceof ClientError ? err : new ClientError("INTERNAL", err instanceof Error ? err.message : "Unexpected error.");
  const map: Partial<Record<ClientError["code"], ErrorPresentation>> = {
    MISSING_KEY: { title: "Gemini API key not configured", hint: "Add GEMINI_API_KEY to .env.local and restart the server. The setup guide on the home page shows how." },
    INVALID_KEY: { title: "API key rejected", hint: "Create a new key in Google AI Studio, update GEMINI_API_KEY in .env.local and restart the server." },
    RATE_LIMIT: { title: "Rate limit reached", hint: "The free tier allows a few requests per minute. Wait a moment, then try again." },
    QUOTA: { title: "Daily quota used up", hint: "Free quota resets at midnight Pacific time. You can also switch GEMINI_MODEL to another free model." },
    MODEL_NOT_FOUND: {
      title: "Model not available",
      hint: "Set GEMINI_MODEL in .env.local to a current free model such as gemini-3.5-flash-lite (see Google AI Studio for the list), then restart the server.",
    },
    TIMEOUT: { title: "The AI took too long", hint: "Try again, or generate fewer questions at a time." },
    NETWORK: { title: "Connection problem", hint: "Check your internet connection and try again." },
    OFFLINE: { title: "You’re offline", hint: "Reconnect to the internet, then try again." },
    UPSTREAM: { title: "Gemini is temporarily unavailable", hint: "This is usually brief. Try again in a minute." },
    BAD_RESPONSE: { title: "The AI response couldn’t be used", hint: "Try again. If it keeps happening, choose a smaller selection." },
    SAFETY: { title: "Content was blocked", hint: "Gemini’s safety filter stopped this section. Choose different sections and try again." },
    PDF_PASSWORD: { title: "Password-protected PDF", hint: "Open it in a PDF viewer, save a copy without a password and upload that copy." },
    PDF_CORRUPT: { title: "PDF couldn’t be read", hint: "Re-export or re-download the file, then upload it again." },
    DOCX_CORRUPT: { title: "Word document couldn’t be read", hint: "Open it in Word or Google Docs and save it again as .docx." },
    TXT_BINARY: { title: "Not a plain-text file", hint: "Save the file as UTF-8 plain text and upload it again." },
    UNSUPPORTED_TYPE: { title: "Unsupported file", hint: "Upload PDF, DOCX or TXT files." },
    MIME_MISMATCH: { title: "File type doesn’t match", hint: "The file’s contents don’t match its extension. Re-save it in the right format." },
    FILE_TOO_LARGE: { title: "File too large", hint: "Split the book into parts, or raise MAX_UPLOAD_MB on the server (see README: Large files)." },
    UPLOAD_NOT_FOUND: { title: "Upload expired", hint: "Select Retry to upload the file again." },
    UPLOAD_INCOMPLETE: { title: "Upload incomplete", hint: "Some parts didn’t arrive. Select Retry; parts already received won’t be sent again." },
    UPLOAD_STORE_UNAVAILABLE: { title: "Upload couldn’t be assembled", hint: "This host can’t keep upload parts together. Use a single-server deployment (see README: Large files)." },
    CHUNK_INVALID: { title: "Upload part rejected", hint: "Select Retry to send it again." },
    TOO_MANY_UPLOADS: { title: "Server busy", hint: "Too many uploads are in progress. Try again in a few minutes." },
    EMPTY_FILE: { title: "Empty file", hint: "This file has no readable text." },
    INSUFFICIENT_CONTENT: { title: "Not enough material", hint: "Lower the number of questions or add more material." },
    TOPIC_NOT_FOUND: { title: "Topic not found", hint: "Try a word that appears in your material." },
    NO_QUESTIONS: { title: "No questions could be generated", hint: "Try a different section, or check that the document has real text." },
    INVALID_KEY_TOKEN: { title: "Answer key unreadable", hint: "The server key changed since this paper was made. Generate a new paper." },
    REVEAL_DISABLED: { title: "Answers are hidden", hint: "This paper is in test mode. Answers appear after you submit." },
    ABORTED: { title: "Cancelled", hint: "Nothing was lost. You can start again whenever you’re ready." },
  };
  const p = map[e.code] ?? { title: "Something went wrong", hint: "Please try again." };
  return { ...p, message: e.message, code: e.code };
}
