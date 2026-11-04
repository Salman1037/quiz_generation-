"use client";

/** SHA-256 of bytes already in memory (avoids reading large files twice). */
export async function hashBytes(bytes: Uint8Array, fallback: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) return fallback;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
