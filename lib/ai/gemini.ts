import "server-only";
import { AppError } from "@/lib/api/errors";

export interface GeminiConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxOutputTokens: number;
  rpm: number;
}

/** Free-tier Flash-Lite: the largest free daily quota. Retired models are replaced automatically (see resolveModel). */
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export function getGeminiConfig(): GeminiConfig | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "your_api_key_here") return null;
  return {
    apiKey,
    model: (process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL).replace(/^models\//, ""),
    baseUrl: (process.env.GEMINI_API_BASE_URL?.trim() || "https://generativelanguage.googleapis.com").replace(/\/$/, ""),
    maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 16384,
    rpm: Math.max(1, Number(process.env.GEMINI_RPM) || 8),
  };
}

export function requireGeminiConfig(): GeminiConfig {
  const cfg = getGeminiConfig();
  if (!cfg) {
    throw new AppError(
      "MISSING_KEY",
      "No Gemini API key is configured. Add GEMINI_API_KEY to .env.local and restart the server.",
      503,
    );
  }
  return cfg;
}

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface GeminiRequest {
  system: string;
  parts: GeminiPart[];
  responseSchema?: unknown;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface GeminiResult {
  text: string;
  finishReason: string | null;
  truncated: boolean;
}

interface GeminiErrorDetail {
  "@type"?: string;
  retryDelay?: string;
  reason?: string;
  violations?: { quotaId?: string }[];
}

function parseRetryDelay(details: GeminiErrorDetail[]): number | undefined {
  for (const d of details) {
    if (d["@type"]?.endsWith("RetryInfo") && d.retryDelay) {
      const secs = parseFloat(d.retryDelay);
      if (Number.isFinite(secs)) return Math.ceil(secs);
    }
  }
  return undefined;
}

/** Maps a Gemini HTTP error to a typed, user-presentable AppError. */
export function mapGeminiError(status: number, body: unknown, model: string, retryAfterHeader?: string | null): AppError {
  const err = (body as { error?: { message?: string; status?: string; details?: GeminiErrorDetail[] } })?.error ?? {};
  const message = err.message ?? "";
  const details = Array.isArray(err.details) ? err.details : [];
  const reasonInvalidKey = details.some((d) => d.reason === "API_KEY_INVALID");

  if (reasonInvalidKey || /api key not valid|api_key_invalid|invalid api key/i.test(message)) {
    return new AppError("INVALID_KEY", "Gemini rejected the API key. Check GEMINI_API_KEY in .env.local, then restart the server.", 401);
  }
  if (status === 401 || status === 403) {
    return new AppError(
      "INVALID_KEY",
      "This API key isn’t allowed to use the Gemini API. Make sure the key is from Google AI Studio and the API is enabled for its project.",
      401,
    );
  }
  if (status === 404) {
    return new AppError(
      "MODEL_NOT_FOUND",
      `Google doesn’t offer the model “${model}” to this key. It may have been retired.`,
      502,
    );
  }
  if (status === 429) {
    const quotaIds = details.flatMap((d) => d.violations?.map((v) => v.quotaId ?? "") ?? []);
    const daily = quotaIds.some((q) => /PerDay/i.test(q)) || /per day|daily/i.test(message);
    const noFreeAccess = /limit:\s*0\b/.test(message);
    if (noFreeAccess) {
      return new AppError(
        "QUOTA",
        `The model “${model}” has no free-tier quota for this key. Set GEMINI_MODEL to a free model such as gemini-3.5-flash-lite.`,
        429,
      );
    }
    if (daily) {
      return new AppError(
        "QUOTA",
        "Today’s free Gemini quota is used up. It resets at midnight Pacific time, or you can switch GEMINI_MODEL to another free model.",
        429,
      );
    }
    const retry = parseRetryDelay(details) ?? (Number(retryAfterHeader) || 20);
    return new AppError("RATE_LIMIT", "Gemini’s per-minute rate limit was reached.", 429, Math.min(Math.max(retry, 2), 90));
  }
  if (status === 400) {
    return new AppError("BAD_RESPONSE", "Gemini couldn’t process this request. Try fewer questions or a smaller selection.", 502);
  }
  if (status >= 500) {
    return new AppError("UPSTREAM", "Gemini is temporarily unavailable.", 503);
  }
  return new AppError("UPSTREAM", `Gemini returned an unexpected status (${status}).`, 502);
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new AppError("NETWORK", "The request was cancelled.", 499));
    });
  });

interface CallOptions {
  config?: GeminiConfig;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  backoffMs?: number;
}

async function callOnce(req: GeminiRequest, cfg: GeminiConfig, fetchImpl: typeof fetch): Promise<GeminiResult> {
  const url = `${cfg.baseUrl}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const timeout = AbortSignal.timeout(req.timeoutMs ?? 55_000);
  const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
  const generationConfig: Record<string, unknown> = { maxOutputTokens: cfg.maxOutputTokens };
  // Google recommends leaving temperature at its default for Gemini 3 and later.
  if (!/^gemini-([3-9]|\d{2,})/.test(cfg.model) && req.temperature !== undefined) generationConfig.temperature = req.temperature;
  if (req.responseSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = req.responseSchema;
  }

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: req.parts }],
        generationConfig,
      }),
      signal,
    });
  } catch (err) {
    if (req.signal?.aborted) throw new AppError("NETWORK", "The request was cancelled.", 499);
    if (timeout.aborted || (err instanceof Error && err.name === "TimeoutError")) {
      throw new AppError("TIMEOUT", "Gemini took too long to respond.", 504);
    }
    throw new AppError("NETWORK", "The server couldn’t reach Gemini. Check the internet connection.", 502);
  }

  const raw = await res.text();
  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  if (!res.ok) throw mapGeminiError(res.status, body, cfg.model, res.headers.get("retry-after"));

  const data = body as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  } | null;
  if (data?.promptFeedback?.blockReason) {
    throw new AppError("SAFETY", "Gemini declined to process this material for safety reasons. Try a different section.", 422);
  }
  const cand = data?.candidates?.[0];
  const finishReason = cand?.finishReason ?? null;
  const text = (cand?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
  if (!text) {
    if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT" || finishReason === "RECITATION") {
      throw new AppError("SAFETY", "Gemini stopped generating for this section (safety or recitation filter). Try a different section.", 422);
    }
    throw new AppError("BAD_RESPONSE", "Gemini returned an empty response.", 502);
  }
  return { text, finishReason, truncated: finishReason === "MAX_TOKENS" };
}

const EXCLUDED = /(image|tts|live|audio|embedding|vision|thinking|exp|customtools|cyber|robotics|computer|learnlm|gemma|nano)/i;

/**
 * Picks the best model for MCQ generation from the names a key can use:
 * stable before preview, Flash-Lite before Flash (far larger free daily quota), newest version first.
 */
export function pickModel(names: string[]): string | null {
  const ids = names.map((n) => n.replace(/^models\//, ""));
  const ranked = ids
    .filter((id) => /^gemini-/.test(id) && /flash/.test(id) && !EXCLUDED.test(id))
    .map((id) => {
      const v = id.match(/^gemini-(\d+(?:\.\d+)?)/);
      const version = v ? parseFloat(v[1]) : 0;
      const stable = !/preview|latest|-\d{2}-\d{4}|-\d{3}$/.test(id);
      const lite = /flash-lite/.test(id);
      return { id, score: (stable ? 1000 : 0) + (lite ? 100 : 0) + version };
    })
    .sort((a, b) => b.score - a.score);
  if (ranked.length) return ranked[0].id;
  return ids.find((id) => id === "gemini-flash-lite-latest") ?? ids.find((id) => id === "gemini-flash-latest") ?? null;
}

/** Lists the models this key can call with generateContent. */
export async function listModels(cfg: GeminiConfig, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const names: string[] = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const url = `${cfg.baseUrl}/v1beta/models?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const res = await fetchImpl(url, { headers: { "x-goog-api-key": cfg.apiKey }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw mapGeminiError(res.status, body, cfg.model);
    }
    const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[]; nextPageToken?: string };
    for (const m of data.models ?? []) {
      if (!m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent")) names.push(m.name.replace(/^models\//, ""));
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return names;
}

// The model actually in use, after any automatic replacement of a retired one. Per server process.
let activeModel: { configured: string; model: string; replaced: boolean } | null = null;

export function getActiveModel(cfg: GeminiConfig): { model: string; replaced: boolean } {
  if (activeModel && activeModel.configured === cfg.model) return { model: activeModel.model, replaced: activeModel.replaced };
  return { model: cfg.model, replaced: false };
}

/** Finds a working replacement when the configured model doesn't exist for this key. */
export async function resolveModel(cfg: GeminiConfig, fetchImpl: typeof fetch = fetch): Promise<{ model: string; replaced: boolean }> {
  const current = getActiveModel(cfg);
  if (activeModel?.configured === cfg.model) return current;
  const available = await listModels(cfg, fetchImpl);
  if (available.includes(cfg.model)) {
    activeModel = { configured: cfg.model, model: cfg.model, replaced: false };
    return { model: cfg.model, replaced: false };
  }
  const pick = pickModel(available);
  if (!pick) {
    throw new AppError(
      "MODEL_NOT_FOUND",
      `Google doesn’t offer “${cfg.model}” to this key, and no suitable Flash model was found among the ${available.length} models it can use.`,
      502,
    );
  }
  console.warn(`[gemini] model "${cfg.model}" is unavailable; using "${pick}" instead.`);
  activeModel = { configured: cfg.model, model: pick, replaced: true };
  return { model: pick, replaced: true };
}

export function resetModelCache() {
  activeModel = null;
}

/** Calls Gemini with bounded retries for transient failures, and replaces a retired model automatically. */
export async function callGemini(req: GeminiRequest, opts: CallOptions = {}): Promise<GeminiResult> {
  const base = opts.config ?? requireGeminiConfig();
  const fetchImpl0 = opts.fetchImpl ?? fetch;
  const cfg = { ...base, model: getActiveModel(base).model };
  try {
    return await callWithRetries(req, cfg, fetchImpl0, opts);
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== "MODEL_NOT_FOUND") throw err;
    const { model, replaced } = await resolveModel(base, fetchImpl0);
    if (!replaced || model === cfg.model) throw err;
    return callWithRetries(req, { ...base, model }, fetchImpl0, opts);
  }
}

async function callWithRetries(req: GeminiRequest, cfg: GeminiConfig, fetchImpl: typeof fetch, opts: CallOptions): Promise<GeminiResult> {
  const maxRetries = opts.maxRetries ?? 2;
  const backoff = opts.backoffMs ?? 900;
  let lastErr: AppError | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callOnce(req, cfg, fetchImpl);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      lastErr = err;
      const transient = err.code === "UPSTREAM" || err.code === "NETWORK" || err.code === "TIMEOUT";
      const shortRateLimit = err.code === "RATE_LIMIT" && (err.retryAfterSec ?? 99) <= 6;
      if (err.status === 499 || attempt === maxRetries || !(transient || shortRateLimit)) throw err;
      const wait = shortRateLimit ? (err.retryAfterSec ?? 3) * 1000 : backoff * 3 ** attempt;
      await sleep(wait, req.signal);
    }
  }
  throw lastErr ?? new AppError("UPSTREAM", "Gemini request failed.", 502);
}
