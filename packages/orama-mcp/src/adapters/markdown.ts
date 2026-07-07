import type { Chunk } from "./types";

const HEADER_RE = /^(#{1,6})\s+(.*)$/;

interface Section {
  heading?: string;
  headerLine?: string;
  bodyLines: string[];
}

/** Header-based chunking: each `#`-prefixed section becomes one chunk, carrying its
 * heading text. Content before the first header (if any) becomes a headerless chunk.
 * Sections with no body text (just a bare header) are dropped as noise. */
export function chunkMarkdown(path: string, content: string): Chunk[] {
  const lines = content.split(/\r?\n/);
  const sections: Section[] = [];
  let current: Section = { bodyLines: [] };

  for (const line of lines) {
    const match = HEADER_RE.exec(line);
    if (match) {
      sections.push(current);
      current = { heading: match[2]?.trim(), headerLine: line, bodyLines: [] };
    } else {
      current.bodyLines.push(line);
    }
  }
  sections.push(current);

  return sections
    .filter((s) => s.bodyLines.some((l) => l.trim().length > 0))
    .map((s) => ({
      path,
      heading: s.heading,
      text: [s.headerLine, ...s.bodyLines]
        .filter((l): l is string => l !== undefined)
        .join("\n")
        .trim(),
      source: "markdown" as const,
    }));
}
