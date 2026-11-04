"use client";
import { KeyRound, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

const steps = [
  {
    title: "Create a free key",
    body: (
      <>
        Open{" "}
        <a className="font-medium text-accent underline underline-offset-2" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
          Google AI Studio
        </a>{" "}
        and select Create API key. No billing is needed.
      </>
    ),
  },
  {
    title: "Add it to .env.local",
    body: (
      <>
        In the project folder, copy <code className="rounded bg-sunken px-1 py-0.5 font-mono text-[12px]">.env.example</code> to{" "}
        <code className="rounded bg-sunken px-1 py-0.5 font-mono text-[12px]">.env.local</code> and set{" "}
        <code className="rounded bg-sunken px-1 py-0.5 font-mono text-[12px]">GEMINI_API_KEY</code>.
      </>
    ),
  },
  { title: "Restart the server", body: <>Stop the dev server and run <code className="rounded bg-sunken px-1 py-0.5 font-mono text-[12px]">npm run dev</code> again.</> },
];

/** Shown when the server has no Gemini key. The key is only ever read on the server. */
export function SetupNotice({ onRecheck, checking }: { onRecheck: () => void; checking: boolean }) {
  return (
    <section aria-labelledby="setup-title" className="card overflow-hidden">
      <div className="flex items-start gap-3 border-b border-line bg-warn-soft/60 px-5 py-4">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
        <div>
          <h2 id="setup-title" className="font-semibold text-ink">
            Connect a Gemini API key to generate papers
          </h2>
          <p className="mt-0.5 text-sm text-ink-2">You can upload documents now. Generating questions needs a key, which you set up once.</p>
        </div>
      </div>
      <ol className="grid gap-px bg-line sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="bg-surface px-5 py-4">
            <p className="text-[13px] font-semibold text-accent tabular">Step {i + 1}</p>
            <p className="mt-1 text-sm font-medium text-ink">{s.title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
        <p className="text-[13px] text-ink-3">The key stays on the server and is never sent to the browser.</p>
        <Button size="sm" onClick={onRecheck} loading={checking}>
          <RefreshCw className="size-3.5" aria-hidden />
          Check again
        </Button>
      </div>
    </section>
  );
}
