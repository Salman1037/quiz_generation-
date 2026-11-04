// Runs the end-to-end suite: starts the mock Gemini API and the production server, runs tests, cleans up.
// Requires `npm run build` first. Usage: npm run test:e2e
import { spawn } from "node:child_process";

const APP_PORT = 3100;
const MOCK_PORT = 8787;
const procs = [];
const start = (cmd, args, env = {}) => {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] });
  procs.push(p);
  return p;
};
const stopAll = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("exit", stopAll);

async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

start("node", ["scripts/mock-gemini.mjs"], { MOCK_PORT: String(MOCK_PORT) });
start("npx", ["next", "start", "-p", String(APP_PORT)], {
  GEMINI_API_KEY: "e2e-test-key",
  GEMINI_MODEL: "gemini-2.5-flash", // retired: the server must switch models by itself
  GEMINI_API_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  MAX_UPLOAD_MB: "200",
});
await waitFor(`http://127.0.0.1:${APP_PORT}/api/health`);

const tests = spawn("npx", ["vitest", "run", "--config", "vitest.e2e.config.ts"], {
  stdio: "inherit",
  env: { ...process.env, E2E_BASE_URL: `http://127.0.0.1:${APP_PORT}` },
});
tests.on("exit", (code) => {
  stopAll();
  process.exit(code ?? 1);
});
