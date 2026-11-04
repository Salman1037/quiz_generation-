import { beforeEach, describe, expect, it, vi } from "vitest";
import { callGemini, mapGeminiError, pickModel, resetModelCache, type GeminiConfig } from "@/lib/ai/gemini";
import { generateBatch } from "@/lib/ai/generation";
import { seal, unseal } from "@/lib/security/seal";
import { AppError } from "@/lib/api/errors";
import { SAMPLE_CHAPTERS } from "./helpers";

const cfg: GeminiConfig = { apiKey: "k", model: "gemini-test", baseUrl: "http://mock", maxOutputTokens: 1000, rpm: 5 };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function okText(text: string, finishReason = "STOP") {
  return jsonResponse(200, { candidates: [{ content: { parts: [{ text }] }, finishReason }] });
}

describe("Gemini error mapping", () => {
  it("detects an invalid key", () => {
    const e = mapGeminiError(400, { error: { message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } }, "m");
    expect(e.code).toBe("INVALID_KEY");
  });
  it("separates per-minute rate limits from daily quota", () => {
    const rpm = mapGeminiError(429, { error: { message: "Resource exhausted", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "17s" }] } }, "m");
    expect(rpm.code).toBe("RATE_LIMIT");
    expect(rpm.retryAfterSec).toBe(17);
    const daily = mapGeminiError(429, { error: { message: "Quota exceeded", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } }, "m");
    expect(daily.code).toBe("QUOTA");
  });
  it("maps unknown models and server errors", () => {
    expect(mapGeminiError(404, {}, "nope").code).toBe("MODEL_NOT_FOUND");
    expect(mapGeminiError(503, {}, "m").code).toBe("UPSTREAM");
  });
});

describe("model selection", () => {
  const available = [
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.8-flash-preview",
    "gemini-3.1-flash-image",
    "gemini-3.1-flash-tts-preview",
    "gemini-3.1-pro-preview",
    "gemini-embedding-2",
    "gemini-flash-latest",
  ];
  it("prefers the newest stable Flash-Lite model and skips image, TTS, embedding and Pro models", () => {
    expect(pickModel(available)).toBe("gemini-3.5-flash-lite");
    expect(pickModel(available.map((n) => `models/${n}`))).toBe("gemini-3.5-flash-lite");
    expect(pickModel(["gemini-3.6-flash", "gemini-3.1-flash-image"])).toBe("gemini-3.6-flash");
    expect(pickModel(["gemini-flash-latest", "gemini-embedding-2"])).toBe("gemini-flash-latest");
    expect(pickModel(["gemini-3.1-pro-preview", "imagen-4"])).toBeNull();
  });

  it("replaces a retired model automatically and remembers the replacement", async () => {
    resetModelCache();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/models?")) return jsonResponse(200, { models: available.map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ["generateContent"] })) });
      if (url.includes("gemini-2.5-flash:")) return jsonResponse(404, { error: { code: 404, message: "models/gemini-2.5-flash is not found", status: "NOT_FOUND" } });
      return okText('{"questions":[]}');
    });
    const retired = { ...cfg, model: "gemini-2.5-flash" };
    const r = await callGemini({ system: "s", parts: [{ text: "p" }] }, { config: retired, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.text).toBe('{"questions":[]}');
    expect(calls.at(-1)).toContain("gemini-3.5-flash-lite:generateContent");
    calls.length = 0;
    await callGemini({ system: "s", parts: [{ text: "p" }] }, { config: retired, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("gemini-3.5-flash-lite");
    resetModelCache();
  });

  it("explains when no usable model exists", async () => {
    resetModelCache();
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("/models?") ? jsonResponse(200, { models: [{ name: "models/gemini-embedding-2" }] }) : jsonResponse(404, {}),
    );
    await expect(
      callGemini({ system: "s", parts: [{ text: "p" }] }, { config: { ...cfg, model: "gone" }, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: "MODEL_NOT_FOUND" });
    resetModelCache();
  });
});

describe("callGemini", () => {
  it("retries transient failures then succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(503, {})).mockResolvedValueOnce(okText('{"questions":[]}'));
    const r = await callGemini({ system: "s", parts: [{ text: "p" }] }, { config: cfg, fetchImpl, backoffMs: 1 });
    expect(r.text).toBe('{"questions":[]}');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers["x-goog-api-key"]).toBe("k");
  });
  it("does not retry an invalid key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: { message: "denied" } }));
    await expect(callGemini({ system: "s", parts: [{ text: "p" }] }, { config: cfg, fetchImpl, backoffMs: 1 })).rejects.toMatchObject({ code: "INVALID_KEY" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("flags truncated output", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okText('{"questions":[', "MAX_TOKENS"));
    const r = await callGemini({ system: "s", parts: [{ text: "p" }] }, { config: cfg, fetchImpl });
    expect(r.truncated).toBe(true);
  });
  it("reports network failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(callGemini({ system: "s", parts: [{ text: "p" }] }, { config: cfg, fetchImpl, maxRetries: 0 })).rejects.toMatchObject({ code: "NETWORK" });
  });
});

const chunks = Object.entries(SAMPLE_CHAPTERS).map(([label, text]) => ({ label, text }));
function mcq(question: string, evidence: string, answer = "A") {
  return {
    question,
    options: [
      { id: "A", text: `first for ${question.slice(0, 12)}` },
      { id: "B", text: `second for ${question.slice(0, 12)}` },
      { id: "C", text: `third for ${question.slice(0, 12)}` },
      { id: "D", text: `fourth for ${question.slice(0, 12)}` },
    ],
    correctAnswer: answer,
    explanation: "Because the material says so.",
    difficulty: "hard",
    source: "made up label",
    evidence,
  };
}

describe("generateBatch", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("keeps supported questions, drops invented or invalid ones and re-requests the shortfall", async () => {
    const first = {
      questions: [
        mcq("Which mode does the kernel run in?", "The kernel is the core component of an operating system and runs in a privileged mode called kernel mode."),
        mcq("Who wrote the first Unix kernel at Bell Labs?", "Ken Thompson wrote the first Unix kernel at Bell Labs in 1969."),
        { ...mcq("Broken question with three options only?", "A page table maps page numbers to frame numbers."), options: [{ text: "a" }, { text: "b" }, { text: "c" }] },
      ],
    };
    const second = {
      questions: [
        mcq("Which mode does the kernel run in?", "The kernel is the core component of an operating system and runs in a privileged mode called kernel mode."),
        mcq("What does a page table map page numbers to?", "A page table maps page numbers to frame numbers."),
      ],
    };
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({ text: JSON.stringify(first), finishReason: "STOP", truncated: false })
      .mockResolvedValueOnce({ text: JSON.stringify(second), finishReason: "STOP", truncated: false });

    const out = await generateBatch({ batchId: "b1", chunks, count: 2, difficulty: "medium", avoid: [] }, callModel);
    expect(out.questions).toHaveLength(2);
    expect(out.stats.rejected).toMatchObject({ unsupported: 1, "option-count": 1, duplicate: 1 });
    expect(out.questions.map((q) => q.source)).toEqual(["Chapter 1: Introduction to Operating Systems", "Chapter 3: Memory Management"]);
    expect(out.questions.every((q) => q.difficulty === "medium")).toBe(true);
    expect(callModel).toHaveBeenCalledTimes(2);
    const secondPrompt = callModel.mock.calls[1][0].parts[0].text as string;
    expect(secondPrompt).toContain("EXISTING QUESTIONS");
  });

  it("surfaces configuration errors immediately", async () => {
    const callModel = vi.fn().mockRejectedValue(new AppError("QUOTA", "quota", 429));
    await expect(generateBatch({ batchId: "b", chunks, count: 3, difficulty: "easy", avoid: [] }, callModel)).rejects.toMatchObject({ code: "QUOTA" });
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it("gives up after bounded attempts when the model keeps returning garbage", async () => {
    const callModel = vi.fn().mockResolvedValue({ text: "not json", finishReason: "STOP", truncated: false });
    await expect(generateBatch({ batchId: "b", chunks, count: 3, difficulty: "easy", avoid: [] }, callModel)).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    expect(callModel).toHaveBeenCalledTimes(3);
  });
});

describe("answer key sealing", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
  });
  it("round-trips and rejects tampering or the wrong kind", () => {
    const token = seal({ kind: "key", answers: { q1: "B" } });
    expect(token).not.toContain("q1");
    expect(unseal<{ kind: "key"; answers: Record<string, string> }>(token, "key").answers.q1).toBe("B");
    const tampered = token.slice(0, -4) + (token.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(() => unseal(tampered, "key")).toThrow(/can’t be read/);
    expect(() => unseal(token, "batch")).toThrow(/can’t be read/);
  });
});
