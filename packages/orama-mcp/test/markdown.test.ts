import { describe, expect, test } from "bun:test";
import { chunkMarkdown } from "../src/adapters/markdown";

describe("chunkMarkdown", () => {
  test("splits on headers of any level", () => {
    const chunks = chunkMarkdown(
      "guide.md",
      "# Getting Started\n\nIntro text.\n\n## Sub Section\n\nMore text.\n",
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ heading: "Getting Started", source: "markdown" });
    expect(chunks[1]).toMatchObject({ heading: "Sub Section", source: "markdown" });
  });

  test("keeps content before the first header as a headerless chunk", () => {
    const chunks = chunkMarkdown("readme.md", "Preamble text.\n\n# Section\n\nBody.\n");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.heading).toBeUndefined();
    expect(chunks[0]?.text).toBe("Preamble text.");
  });

  test("handles a file with no headers as a single chunk", () => {
    const chunks = chunkMarkdown("plain.md", "Just plain text.\nSecond line.\n");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading).toBeUndefined();
    expect(chunks[0]?.text).toBe("Just plain text.\nSecond line.");
  });

  test("drops empty sections", () => {
    const chunks = chunkMarkdown("empty.md", "# Empty\n\n# Also Empty\n\n# Has Content\n\nSomething.\n");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading).toBe("Has Content");
  });

  test("returns an empty array for an empty file", () => {
    expect(chunkMarkdown("blank.md", "")).toEqual([]);
  });
});
