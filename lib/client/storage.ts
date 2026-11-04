"use client";

/** localStorage access that never throws (private mode, quota exceeded, SSR). */
export function readStore<T>(key: string): T | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeStore(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeStore(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const STORE_KEYS = {
  session: "quizforge:session:v1",
  library: "quizforge:library:v1",
  settings: "quizforge:settings:v1",
} as const;
