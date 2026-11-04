"use client";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ExtractedDocument } from "@/types/document";
import type { DifficultySetting, ExamSettings, SourceMode } from "@/types/exam";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/client/cn";
import { MAX_QUESTIONS } from "@/lib/validation/schemas";
import { buildChunks } from "@/lib/documents/chunking";
import { selectTopicChunks } from "@/lib/documents/topic";

const COUNTS = [10, 20, 30, 50, 100];
const DURATIONS = [10, 15, 30, 45, 60, 90];

function Group({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-line px-5 py-5 first:border-t-0 sm:px-6">
      <legend className="sr-only">{title}</legend>
      <div className="mb-3">
        <p className="text-sm font-semibold text-ink" aria-hidden>
          {title}
        </p>
        {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
      </div>
      {children}
    </fieldset>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  label,
  suffix,
  step = 1,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  label: string;
  suffix?: React.ReactNode;
  step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }
  return (
    <label className="inline-flex items-center gap-2 text-sm text-ink-2">
      <span className="sr-only">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={() => {
          const n = Math.min(max, Math.max(min, Number(draft) || min));
          setDraft(String(n));
          onChange(n);
        }}
        className="h-9 w-24 rounded-lg border border-line-strong bg-surface px-3 text-sm tabular text-ink"
      />
      {suffix}
    </label>
  );
}

const SOURCE_OPTIONS: { value: SourceMode; label: string; hint: string }[] = [
  { value: "all", label: "Everything uploaded", hint: "Questions are spread across all documents." },
  { value: "document", label: "One document", hint: "Pick a single file." },
  { value: "sections", label: "Chapters or sections", hint: "Choose the chapters to cover." },
  { value: "topic", label: "A custom topic", hint: "Only passages about your topic are used." },
];

export function GenerationSettings({
  settings,
  onChange,
  docs,
}: {
  settings: ExamSettings;
  onChange: (patch: Partial<ExamSettings>) => void;
  docs: ExtractedDocument[];
}) {
  const custom = !COUNTS.includes(settings.questionCount);
  const [showCustom, setShowCustom] = useState(custom);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const selected = new Set(settings.sectionIds);

  const topicMatches = useMemo(() => {
    if (settings.sourceMode !== "topic" || settings.topic.trim().length < 3 || !docs.length) return null;
    const chunks = buildChunks(docs, 400);
    const hits = selectTopicChunks(chunks, settings.topic, Number.MAX_SAFE_INTEGER);
    return { passages: hits.length, words: hits.reduce((n, c) => n + c.words, 0), sections: new Set(hits.map((h) => h.label)).size };
  }, [settings.sourceMode, settings.topic, docs]);

  const toggleSection = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ sectionIds: [...next] });
  };

  return (
    <div className="card">
      <Group title="Number of questions">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Number of questions"
            value={showCustom ? -1 : settings.questionCount}
            onChange={(v) => {
              if (v === -1) setShowCustom(true);
              else {
                setShowCustom(false);
                onChange({ questionCount: v });
              }
            }}
            options={[...COUNTS.map((c) => ({ value: c, label: String(c) })), { value: -1, label: "Custom" }]}
          />
          {showCustom && (
            <NumberInput
              label="Custom number of questions"
              value={settings.questionCount}
              min={1}
              max={MAX_QUESTIONS}
              onChange={(n) => onChange({ questionCount: n })}
              suffix={<span className="text-[13px] text-ink-3">questions (max {MAX_QUESTIONS})</span>}
            />
          )}
        </div>
        <p className="mt-2.5 text-[13px] text-ink-3">Every question has four options and exactly one correct answer.</p>
      </Group>

      <Group title="Difficulty">
        <Segmented<DifficultySetting>
          label="Difficulty"
          value={settings.difficulty}
          onChange={(v) => onChange({ difficulty: v })}
          options={[
            { value: "easy", label: "Easy", hint: "Recall of directly stated facts" },
            { value: "medium", label: "Medium", hint: "Understanding and relating ideas" },
            { value: "hard", label: "Hard", hint: "Application and inference" },
            { value: "mixed", label: "Mixed", hint: "A blend of all three" },
          ]}
        />
      </Group>

      <Group title="Question source">
        <div role="radiogroup" aria-label="Question source" className="grid gap-2 sm:grid-cols-2">
          {SOURCE_OPTIONS.map((o) => {
            const active = settings.sourceMode === o.value;
            const disabled = (o.value === "document" || o.value === "sections") && docs.length === 0;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() =>
                  onChange({
                    sourceMode: o.value,
                    documentId: o.value === "document" ? (settings.documentId ?? docs[0]?.id ?? null) : settings.documentId,
                  })
                }
                className={cn(
                  "flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors disabled:opacity-50",
                  active ? "border-accent bg-accent-soft/60" : "border-line bg-surface hover:border-line-strong",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border-[1.5px]",
                    active ? "border-accent" : "border-line-strong",
                  )}
                  aria-hidden
                >
                  {active && <span className="size-2 rounded-full bg-accent" />}
                </span>
                <span>
                  <span className="block text-sm font-medium text-ink">{o.label}</span>
                  <span className="block text-[12.5px] leading-snug text-ink-3">{o.hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        {settings.sourceMode === "document" && docs.length > 0 && (
          <label className="mt-3 block text-[13px] font-medium text-ink-2">
            Document
            <select
              value={settings.documentId ?? ""}
              onChange={(e) => onChange({ documentId: e.target.value })}
              className="mt-1 block h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink"
            >
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.wordCount.toLocaleString()} words)
                </option>
              ))}
            </select>
          </label>
        )}

        {settings.sourceMode === "sections" && (
          <div className="mt-3 overflow-hidden rounded-xl border border-line">
            <div className="flex items-center justify-between border-b border-line bg-sunken/60 px-3.5 py-2 text-[13px]">
              <span className="text-ink-2 tabular">
                {selected.size} of {docs.reduce((n, d) => n + d.sections.length, 0)} sections selected
              </span>
              <span className="flex gap-3">
                <button type="button" className="font-medium text-accent hover:underline" onClick={() => onChange({ sectionIds: docs.flatMap((d) => d.sections.map((s) => s.id)) })}>
                  Select all
                </button>
                <button type="button" className="font-medium text-ink-3 hover:text-ink" onClick={() => onChange({ sectionIds: [] })}>
                  Clear
                </button>
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {docs.map((d) => {
                const open = docs.length === 1 || openDoc === d.id;
                return (
                  <div key={d.id} className="border-b border-line last:border-b-0">
                    {docs.length > 1 && (
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpenDoc(open ? null : d.id)}
                        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm font-medium text-ink hover:bg-sunken/50"
                      >
                        <span className="truncate">{d.name}</span>
                        <ChevronDown className={cn("size-4 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} aria-hidden />
                      </button>
                    )}
                    {open && (
                      <ul className="pb-1.5">
                        {d.sections.map((s) => (
                          <li key={s.id}>
                            <label className="flex cursor-pointer items-center gap-3 px-3.5 py-2 hover:bg-sunken/50">
                              <input
                                type="checkbox"
                                checked={selected.has(s.id)}
                                onChange={() => toggleSection(s.id)}
                                className="size-4 shrink-0 accent-[var(--color-accent)]"
                              />
                              <span className="min-w-0 flex-1 truncate text-sm text-ink" title={s.title}>
                                {s.title}
                              </span>
                              <span className="shrink-0 text-[12px] text-ink-3 tabular">{s.wordCount.toLocaleString()} words</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              {!docs.length && <p className="px-3.5 py-3 text-[13px] text-ink-3">Upload a document to see its chapters.</p>}
            </div>
          </div>
        )}

        {settings.sourceMode === "topic" && (
          <div className="mt-3">
            <label className="block text-[13px] font-medium text-ink-2">
              Topic
              <input
                type="text"
                value={settings.topic}
                maxLength={200}
                placeholder="For example: page replacement algorithms"
                onChange={(e) => onChange({ topic: e.target.value })}
                className="mt-1 block h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3/70"
              />
            </label>
            {topicMatches && (
              <p className={cn("mt-2 text-[13px]", topicMatches.passages ? "text-ink-2" : "text-danger")} aria-live="polite">
                {topicMatches.passages
                  ? `Found in ${topicMatches.passages} passage${topicMatches.passages === 1 ? "" : "s"} across ${topicMatches.sections} section${topicMatches.sections === 1 ? "" : "s"} (about ${topicMatches.words.toLocaleString()} words).`
                  : "This topic doesn’t appear in your material yet. Try another word from the text."}
              </p>
            )}
          </div>
        )}
      </Group>

      <Group title="Answers and feedback">
        <Segmented
          label="When answers are shown"
          value={settings.revealMode}
          onChange={(v) => onChange({ revealMode: v })}
          options={[
            { value: "after", label: "After submitting" },
            { value: "immediate", label: "After each question" },
          ]}
        />
        <p className="mt-2 text-[13px] text-ink-3">
          {settings.revealMode === "after"
            ? "Test mode: correct answers stay hidden until you submit the paper."
            : "Practice mode: each answer is checked as soon as you choose it, and then locked."}
        </p>
        <div className="mt-2 divide-y divide-line">
          <Switch
            label="Include explanations"
            description="Show why each answer is correct, based on your material."
            checked={settings.includeExplanations}
            onChange={(v) => onChange({ includeExplanations: v })}
          />
          <Switch label="Shuffle question order" checked={settings.shuffleQuestions} onChange={(v) => onChange({ shuffleQuestions: v })} />
          <Switch label="Shuffle answer options" checked={settings.shuffleOptions} onChange={(v) => onChange({ shuffleOptions: v })} />
        </div>
      </Group>

      <Group title="Timer and marking">
        <Switch
          label="Examination timer"
          description="The paper submits itself when time runs out."
          checked={settings.timerEnabled}
          onChange={(v) => onChange({ timerEnabled: v })}
        />
        {settings.timerEnabled && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Segmented
              label="Duration in minutes"
              value={DURATIONS.includes(settings.durationMinutes) ? settings.durationMinutes : -1}
              onChange={(v) => v !== -1 && onChange({ durationMinutes: v })}
              options={[...DURATIONS.map((d) => ({ value: d, label: `${d} min` })), ...(DURATIONS.includes(settings.durationMinutes) ? [] : [{ value: -1, label: "Custom" }])]}
            />
            <NumberInput label="Custom duration" value={settings.durationMinutes} min={1} max={600} onChange={(n) => onChange({ durationMinutes: n })} suffix={<span className="text-[13px] text-ink-3">minutes</span>} />
          </div>
        )}
        <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-2" id="neg-label">
              Negative marking per wrong answer
            </p>
            <Segmented
              label="Negative marking"
              value={settings.negativeMarking}
              onChange={(v) => onChange({ negativeMarking: v })}
              options={[
                { value: 0, label: "None" },
                { value: 0.25, label: "−¼" },
                { value: 0.33, label: "−⅓" },
                { value: 0.5, label: "−½" },
                { value: 1, label: "−1" },
              ]}
            />
          </div>
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-2">Pass mark</p>
            <Segmented
              label="Pass mark"
              value={settings.passPercentage ?? 0}
              onChange={(v) => onChange({ passPercentage: v === 0 ? null : v })}
              options={[
                { value: 0, label: "Off" },
                { value: 40, label: "40%" },
                { value: 50, label: "50%" },
                { value: 60, label: "60%" },
                { value: 75, label: "75%" },
              ]}
            />
          </div>
        </div>
      </Group>
    </div>
  );
}
