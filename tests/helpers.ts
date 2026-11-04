import { assembleDocument } from "@/lib/documents/assemble";
import type { ExamSettings } from "@/types/exam";

export const SAMPLE_CHAPTERS: Record<string, string> = {
  "Chapter 1: Introduction to Operating Systems":
    "An operating system is system software that manages computer hardware and software resources and provides common services for computer programs. The kernel is the core component of an operating system and runs in a privileged mode called kernel mode. User applications run in user mode and request services from the kernel through system calls. Early batch systems executed jobs one after another without user interaction. Time-sharing systems later allowed many users to interact with a computer at the same time by rapidly switching the processor between them. A real-time operating system guarantees that tasks are completed within strict timing constraints.",
  "Chapter 2: Process Management":
    "A process is a program in execution. Each process has a process control block that stores its state, program counter, registers, and scheduling information. A process can be in the new, ready, running, waiting, or terminated state. The scheduler decides which ready process receives the CPU next. Round-robin scheduling gives each process a fixed time quantum. Shortest job first scheduling minimizes average waiting time when burst lengths are known. A context switch saves the state of the running process and restores the state of the next one.",
  "Chapter 3: Memory Management":
    "Paging divides physical memory into fixed-size frames and logical memory into pages of the same size, which eliminates external fragmentation. A page table maps page numbers to frame numbers. The translation lookaside buffer is a small hardware cache that stores recent page table entries to speed up address translation. When a referenced page is not in memory, a page fault occurs and the operating system loads the page from disk. Thrashing happens when a system spends more time swapping pages than executing processes.",
};

export function sampleBookText(repeat = 1): string {
  return Object.entries(SAMPLE_CHAPTERS)
    .map(([t, body]) => `${t}\n\n${Array.from({ length: repeat }, () => body).join("\n\n")}`)
    .join("\n\n");
}

export function sampleDoc(repeat = 1, name = "os.txt") {
  return assembleDocument({ name, size: 1000, kind: "txt", hash: `${name}-hash-0123456789abcdef`, text: sampleBookText(repeat) });
}

export const baseSettings: ExamSettings = {
  questionCount: 10,
  difficulty: "medium",
  sourceMode: "all",
  documentId: null,
  sectionIds: [],
  topic: "",
  shuffleQuestions: true,
  shuffleOptions: true,
  includeExplanations: true,
  revealMode: "after",
  timerEnabled: false,
  durationMinutes: 15,
  marksPerQuestion: 1,
  negativeMarking: 0,
  passPercentage: null,
};

/** Deterministic PRNG for repeatable shuffle tests. */
export function seeded(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
