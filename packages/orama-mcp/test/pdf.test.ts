import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkPdfPages, extractPdfPages, loadPdfPages } from "../src/adapters/pdf";

const FIXTURE = join(import.meta.dir, "fixtures", "sample.pdf");

describe("chunkPdfPages", () => {
  test("emits one chunk per non-empty page with a page heading", () => {
    const chunks = chunkPdfPages("doc.pdf", ["First page.", "Second page."]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ path: "doc.pdf", heading: "page 1", text: "First page.", source: "pdf" });
    expect(chunks[1]).toMatchObject({ heading: "page 2", text: "Second page.", source: "pdf" });
  });

  test("drops blank/whitespace-only pages but keeps page numbering", () => {
    const chunks = chunkPdfPages("doc.pdf", ["Intro.", "   ", "Conclusion."]);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.heading)).toEqual(["page 1", "page 3"]);
  });

  test("returns an empty array when no page has text", () => {
    expect(chunkPdfPages("doc.pdf", ["", "  "])).toEqual([]);
  });
});

describe("extractPdfPages", () => {
  test("pulls the embedded text layer per page (no OCR needed)", async () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const pages = await extractPdfPages(bytes, false);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("Hello Orama PDF");
    expect(pages[1]).toContain("vector search");
  });
});

describe("loadPdfPages caching", () => {
  test("writes a content-hash cache and reuses it on the second call", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "orama-pdf-"));
    try {
      const first = await loadPdfPages(FIXTURE, { cacheDir, ocr: false });
      expect(first[0]).toContain("Hello Orama PDF");

      const bytes = new Uint8Array(readFileSync(FIXTURE));
      const { hashBuffer } = await import("../src/util/hash");
      const cacheFile = join(cacheDir, "pdf-text", `${hashBuffer(bytes)}.json`);
      expect(existsSync(cacheFile)).toBe(true);

      const second = await loadPdfPages(FIXTURE, { cacheDir, ocr: false });
      expect(second).toEqual(first);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
