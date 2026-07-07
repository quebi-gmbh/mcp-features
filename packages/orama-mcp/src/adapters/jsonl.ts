import type { Chunk } from "./types";

/** One JSONL line = one document. Expects a `text` or `content` string field; every
 * other field is attached as metadata (plus the 1-based line number). */
export function chunkJsonl(path: string, content: string): Chunk[] {
  const chunks: Chunk[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, i) => {
    if (line.trim().length === 0) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const text = typeof parsed.text === "string" ? parsed.text : typeof parsed.content === "string" ? parsed.content : undefined;
    if (!text) return;

    chunks.push({ path, heading: `line ${i + 1}`, text, source: "jsonl" });
  });

  return chunks;
}
