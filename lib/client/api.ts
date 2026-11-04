"use client";
import type { ApiErrorBody } from "@/lib/api/errors";
import { ClientError } from "./errors";

async function toClientError(res: Response): Promise<ClientError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* non-JSON error */
  }
  if (body?.error) return new ClientError(body.error.code, body.error.message, res.status, body.error.retryAfterSec);
  if (res.status === 413) return new ClientError("FILE_TOO_LARGE", "The upload is larger than the server accepts.", 413);
  if (res.status === 504) return new ClientError("TIMEOUT", "The server took too long to respond.", 504);
  return new ClientError("INTERNAL", `The server responded with status ${res.status}.`, res.status);
}

export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      throw new ClientError("ABORTED", "Cancelled.");
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) throw new ClientError("OFFLINE", "You appear to be offline.");
    throw new ClientError("NETWORK", "Couldn’t reach the server.");
  }
  if (!res.ok) throw await toClientError(res);
  return (await res.json()) as T;
}

export interface HealthInfo {
  configured: boolean;
  model: string;
  modelNote: string | null;
  keyProblem: string | null;
  rpm: number;
  maxUploadMb: number;
  chunkSizeMb: number;
}

export async function fetchHealth(): Promise<HealthInfo> {
  const res = await fetch("/api/health", { cache: "no-store" });
  if (!res.ok) throw await toClientError(res);
  return (await res.json()) as HealthInfo;
}

export async function postForm<T>(url: string, form: FormData, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form, signal });
  } catch {
    if (signal?.aborted) throw new ClientError("ABORTED", "Cancelled.");
    throw new ClientError("NETWORK", "Couldn’t reach the server.");
  }
  if (!res.ok) throw await toClientError(res);
  return (await res.json()) as T;
}
