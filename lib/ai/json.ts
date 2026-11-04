import { AppError } from "@/lib/api/errors";

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/** Returns every complete top-level JSON object found inside the array that follows `"key": [`. */
export function salvageArrayObjects(text: string, key: string): unknown[] {
  const keyIdx = text.search(new RegExp(`"${key}"\\s*:\\s*\\[`));
  let i = keyIdx >= 0 ? text.indexOf("[", keyIdx) + 1 : text.indexOf("[") + 1;
  if (i <= 0) return [];
  const out: unknown[] = [];
  while (i < text.length) {
    const start = text.indexOf("{", i);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let j = start; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) break; // truncated object: stop
    try {
      out.push(JSON.parse(text.slice(start, end + 1)));
    } catch {
      /* skip malformed object */
    }
    i = end + 1;
  }
  return out;
}

/**
 * Parses model output that should be `{ "<key>": [...] }`.
 * Handles code fences, bare arrays, and truncated output (keeps complete items).
 */
export function parseItems(text: string, key: string): { items: unknown[]; salvaged: boolean } {
  const cleaned = stripFences(text);
  try {
    const value = JSON.parse(cleaned) as unknown;
    if (Array.isArray(value)) return { items: value, salvaged: false };
    if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>)[key])) {
      return { items: (value as Record<string, unknown[]>)[key], salvaged: false };
    }
  } catch {
    /* fall through to salvage */
  }
  const items = salvageArrayObjects(cleaned, key);
  if (!items.length) {
    throw new AppError("BAD_RESPONSE", "The AI returned a response that couldn’t be read as questions.", 502);
  }
  return { items, salvaged: true };
}
