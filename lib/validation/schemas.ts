import { z } from "zod";

export const optionIdSchema = z.enum(["A", "B", "C", "D"]);
export const difficultySchema = z.enum(["easy", "medium", "hard"]);
export const difficultySettingSchema = z.enum(["easy", "medium", "hard", "mixed"]);

export const MAX_QUESTIONS = 200;
export const MAX_BATCH_QUESTIONS = 15;
export const MAX_CHUNK_CHARS = 45_000;
export const MAX_BATCH_CHARS = 60_000;

/** Lenient shape for one question as the model returns it; tightened by normalizeQuestion(). */
export const rawQuestionSchema = z.object({
  question: z.string(),
  options: z
    .array(z.union([z.string(), z.object({ id: z.string().optional(), text: z.string() })]))
    .min(2),
  correctAnswer: z.union([z.string(), z.number()]),
  explanation: z.string().optional().default(""),
  difficulty: z.string().optional(),
  source: z.string().optional(),
  evidence: z.string().optional().default(""),
});
export type RawQuestion = z.infer<typeof rawQuestionSchema>;

/** Strict final shape, matching the documented paper format. */
export const fullQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(8),
  options: z
    .array(z.object({ id: optionIdSchema, text: z.string().min(1) }))
    .length(4)
    .refine((opts) => opts.map((o) => o.id).join("") === "ABCD", "Options must be labelled A–D"),
  correctAnswer: optionIdSchema,
  explanation: z.string(),
  difficulty: difficultySchema,
  source: z.string(),
  evidence: z.string().optional(),
});

export const generateRequestSchema = z.object({
  batchId: z.string().max(80),
  chunks: z
    .array(z.object({ label: z.string().min(1).max(200), text: z.string().min(1).max(MAX_CHUNK_CHARS) }))
    .min(1)
    .max(12)
    .refine((c) => c.reduce((n, x) => n + x.text.length, 0) <= MAX_BATCH_CHARS, "Batch text is too long"),
  count: z.number().int().min(1).max(MAX_BATCH_QUESTIONS),
  difficulty: difficultySettingSchema,
  topic: z.string().max(200).optional(),
  avoid: z.array(z.string().max(300)).max(200).default([]),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const scoringSchema = z.object({
  marksPerQuestion: z.number().min(0.25).max(10),
  negativeMarking: z.number().min(0).max(10),
  passPercentage: z.number().min(1).max(100).nullable(),
});

export const finalizeRequestSchema = z.object({
  title: z.string().min(1).max(140),
  batches: z.array(z.string().max(400_000)).min(1).max(60),
  requestedCount: z.number().int().min(1).max(MAX_QUESTIONS),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  includeExplanations: z.boolean(),
  revealMode: z.enum(["after", "immediate"]),
  scoring: scoringSchema,
});

export const evaluateRequestSchema = z.object({
  key: z.string().min(10).max(600_000),
  answers: z.record(z.string().max(20), optionIdSchema.nullable()),
  /** When present: practice-mode reveal for these questions only. */
  revealIds: z.array(z.string().max(20)).max(MAX_QUESTIONS).optional(),
});

/** Gemini responseSchema (OpenAPI subset) for structured MCQ output. */
export const geminiQuestionSchema = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          question: { type: "STRING" },
          options: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { id: { type: "STRING", enum: ["A", "B", "C", "D"] }, text: { type: "STRING" } },
              required: ["id", "text"],
            },
          },
          correctAnswer: { type: "STRING", enum: ["A", "B", "C", "D"] },
          explanation: { type: "STRING" },
          difficulty: { type: "STRING", enum: ["easy", "medium", "hard"] },
          source: { type: "STRING" },
          evidence: { type: "STRING" },
        },
        required: ["question", "options", "correctAnswer", "explanation", "difficulty", "source", "evidence"],
        propertyOrdering: ["question", "options", "correctAnswer", "explanation", "difficulty", "source", "evidence"],
      },
    },
  },
  required: ["questions"],
} as const;

export const geminiOcrSchema = {
  type: "OBJECT",
  properties: {
    pages: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { page: { type: "INTEGER" }, text: { type: "STRING" } },
        required: ["page", "text"],
      },
    },
  },
  required: ["pages"],
} as const;
