// A local stand-in for the Gemini REST API, used only by the end-to-end tests.
// It writes "fill in the blank" questions from sentences in the prompt's source blocks,
// so every question is genuinely grounded in the uploaded text and passes evidence checks.
// Trigger words in the prompt simulate failures: RATELIMITME, QUOTATEST, BADKEYTEST, TRUNCTEST.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 8787);
const STOP = new Set("the and that with from this which their there these those have been were into about over under also such each other only than then when where what because".split(" "));

function sentencesFrom(text) {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).filter((s) => s.split(" ").length >= 8);
}
function keyword(sentence) {
  const words = sentence.match(/[A-Za-z][A-Za-z-]{4,}/g) || [];
  return words.filter((w) => !STOP.has(w.toLowerCase())).sort((a, b) => b.length - a.length)[0];
}

function buildQuestions(prompt, count) {
  const blocks = [...prompt.matchAll(/<<<SOURCE label="([^"]+)">>>\n([\s\S]*?)\n<<<END SOURCE>>>/g)].map((m) => ({ label: m[1], text: m[2] }));
  const avoid = new Set((prompt.split("EXISTING QUESTIONS")[1]?.split("SOURCE MATERIAL")[0] || "").split("\n").map((l) => l.replace(/^- /, "").trim()).filter(Boolean));
  const perBlock = blocks.map((b) => sentencesFrom(b.text).map((s) => ({ s, label: b.label, k: keyword(s) })).filter((x) => x.k));
  const pool = [];
  for (let i = 0; perBlock.some((l) => i < l.length); i++) for (const l of perBlock) if (l[i]) pool.push(l[i]);
  const keys = [...new Set(pool.map((p) => p.k))];
  const out = [];
  for (const p of pool) {
    if (out.length >= count) break;
    const question = `Fill in the blank: ${p.s.replace(p.k, "_____")}`;
    if ([...avoid].some((a) => question.slice(0, 200) === a.slice(0, 200))) continue;
    const distractors = keys.filter((k) => k.toLowerCase() !== p.k.toLowerCase()).sort(() => Math.random() - 0.5).slice(0, 3);
    while (distractors.length < 3) distractors.push(`option${distractors.length}${out.length}`);
    const pos = out.length % 4;
    const texts = [...distractors];
    texts.splice(pos, 0, p.k);
    out.push({
      question,
      options: texts.map((t, i) => ({ id: "ABCD"[i], text: t })),
      correctAnswer: "ABCD"[pos],
      explanation: `The material states that ${p.s.charAt(0).toLowerCase()}${p.s.slice(1)}`,
      difficulty: ["easy", "medium", "hard"][out.length % 3],
      source: p.label,
      evidence: p.s,
    });
    avoid.add(question);
  }
  return out;
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      // Model listing, like today's API: the Gemini 2.5 family is retired and absent.
      if (req.method === "GET" && /\/v1beta\/models(\?|$)/.test(req.url || "")) {
        const names = ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.1-flash-image", "gemini-3.1-pro-preview", "gemini-embedding-2", "gemini-mock"];
        return send(res, 200, { models: names.map((n) => ({ name: `models/${n}`, supportedGenerationMethods: n.includes("embedding") ? ["embedContent"] : ["generateContent"] })) });
      }
      if (req.method !== "POST" || !/:generateContent$/.test(req.url || "")) return send(res, 404, { error: { code: 404, message: "Not found", status: "NOT_FOUND" } });
      if (/gemini-2\.5/.test(req.url || "")) return send(res, 404, { error: { code: 404, message: "models/gemini-2.5-flash is not found for API version v1beta", status: "NOT_FOUND" } });
      if (!req.headers["x-goog-api-key"]) return send(res, 403, { error: { code: 403, message: "Missing key", status: "PERMISSION_DENIED" } });
      const body = JSON.parse(raw);
      const parts = body.contents[0].parts;
      const text = parts.filter((p) => p.text).map((p) => p.text).join("\n");
      const pdf = parts.find((p) => p.inlineData);

      if (text.includes("BADKEYTEST"))
        return send(res, 400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } });
      if (text.includes("RATELIMITME"))
        return send(res, 429, { error: { code: 429, message: "Resource has been exhausted", status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "30s" }] } });
      if (text.includes("QUOTATEST"))
        return send(res, 429, { error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } });

      if (pdf) {
        const n = Number((text.match(/has (\d+) page/) || [])[1] || 1);
        const pages = Array.from({ length: n }, (_, i) => ({ page: i + 1, text: `Recognised page ${i + 1}. Chlorophyll absorbs light energy during photosynthesis in the leaves of green plants.` }));
        return send(res, 200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ pages }) }] }, finishReason: "STOP" }] });
      }

      const count = Number((text.match(/Write (\d+) multiple-choice/) || [])[1] || 5);
      const questions = buildQuestions(text, count);
      let out = JSON.stringify({ questions });
      let finishReason = "STOP";
      if (text.includes("TRUNCTEST")) {
        const two = JSON.stringify({ questions: questions.slice(0, 2) });
        out = two.slice(0, -2) + ',{"question":"cut off mid-way';
        finishReason = "MAX_TOKENS";
      }
      send(res, 200, { candidates: [{ content: { parts: [{ text: out }] }, finishReason }] });
    });
  })
  .listen(PORT, () => console.log(`mock gemini on :${PORT}`));
