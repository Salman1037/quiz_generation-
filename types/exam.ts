export type Difficulty = "easy" | "medium" | "hard";
export type DifficultySetting = Difficulty | "mixed";
export type OptionId = "A" | "B" | "C" | "D";
export const OPTION_IDS: OptionId[] = ["A", "B", "C", "D"];

export type SourceMode = "all" | "document" | "sections" | "topic";
export type RevealMode = "after" | "immediate";

export interface AnswerOptionData {
  id: OptionId;
  text: string;
}

export interface PublicQuestion {
  id: string;
  question: string;
  options: AnswerOptionData[];
  difficulty: Difficulty;
  source: string;
}

export interface FullQuestion extends PublicQuestion {
  correctAnswer: OptionId;
  explanation: string;
  evidence?: string;
}

export interface ScoringRules {
  marksPerQuestion: number;
  /** Marks deducted per wrong answer, e.g. 0.25 */
  negativeMarking: number;
  /** Percentage 0-100, or null when no pass mark is configured */
  passPercentage: number | null;
}

export interface ExamSettings extends ScoringRules {
  questionCount: number;
  difficulty: DifficultySetting;
  sourceMode: SourceMode;
  documentId: string | null;
  sectionIds: string[];
  topic: string;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  includeExplanations: boolean;
  revealMode: RevealMode;
  timerEnabled: boolean;
  durationMinutes: number;
}

export interface Paper {
  id: string;
  title: string;
  createdAt: number;
  totalQuestions: number;
  questions: PublicQuestion[];
  /** Encrypted answer key. Only the server can read it. */
  key: string;
  settings: ExamSettings;
  sourceSummary: string;
  /** Set when the paper is shorter than requested, explaining why. */
  notice?: string | null;
}

export interface RevealedAnswer {
  correctAnswer: OptionId;
  explanation: string | null;
}

export interface QuestionResult extends RevealedAnswer {
  id: string;
  selected: OptionId | null;
  status: "correct" | "incorrect" | "unanswered";
  marks: number;
}

export interface ScoreSummary {
  total: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  marks: number;
  maxMarks: number;
  percentage: number;
  passed: boolean | null;
  passPercentage: number | null;
  negativeMarking: number;
}

export interface ExamResult {
  summary: ScoreSummary;
  perQuestion: Record<string, QuestionResult>;
  timeTakenSec: number;
  submittedAt: number;
  autoSubmitted: boolean;
}

export interface ExamSession {
  paper: Paper;
  order: string[];
  answers: Record<string, OptionId | null>;
  marked: Record<string, boolean>;
  revealed: Record<string, RevealedAnswer>;
  current: number;
  startedAt: number;
  deadline: number | null;
  status: "in-progress" | "submitting" | "submitted";
  result: ExamResult | null;
  attempt: number;
}
