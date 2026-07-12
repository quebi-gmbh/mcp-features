import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { hashBuffer } from "../util/hash";
import { createLogger } from "../util/log";
import type { Chunk } from "./types";

const log = createLogger("pdf");

/** A page yielding fewer than this many non-whitespace characters is treated as
 * having no usable text layer — the OCR-fallback candidate threshold. */
const MIN_PAGE_CHARS = 16;

export interface PdfOptions {
  /** Absolute cache directory (extracted page text is memoized here by content hash). */
  cacheDir: string;
  /** When true, OCR pages that have little/no extractable text (requires `tesseract.js`). */
  ocr: boolean;
}

/** Pure page → chunk mapping: one chunk per page that has text, carrying a
 * `page N` heading (mirrors the JSONL adapter's `line N`). Empty pages are dropped. */
export function chunkPdfPages(path: string, pages: string[]): Chunk[] {
  return pages
    .map((text, i) => ({ text: text.trim(), page: i + 1 }))
    .filter((p) => p.text.length > 0)
    .map((p) => ({ path, heading: `page ${p.page}`, text: p.text, source: "pdf" as const }));
}

/** Extract text per page: pull the embedded text layer first (cheap, covers
 * born-digital PDFs); when `ocr` is on, OCR only the pages that came back empty. */
export async function extractPdfPages(bytes: Uint8Array, ocr: boolean): Promise<string[]> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  if (!ocr) return pages;

  const needsOcr = pages.some((p) => p.trim().length < MIN_PAGE_CHARS);
  if (!needsOcr) return pages;

  const recognize = await loadOcr();
  if (!recognize) return pages;

  const out: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (pages[i]!.trim().length >= MIN_PAGE_CHARS) {
      out.push(pages[i]!);
      continue;
    }
    try {
      const image = await renderPage(pdf, i + 1);
      out.push(await recognize(image));
    } catch (err) {
      log.warn("OCR failed for page; keeping extracted text", { page: i + 1, message: (err as Error).message });
      out.push(pages[i]!);
    }
  }
  return out;
}

/** Load + cache extracted pages for a PDF file, keyed by content hash (and whether
 * OCR was applied, so toggling `--ocr` never serves stale text-only output). */
export async function loadPdfPages(absPath: string, opts: PdfOptions): Promise<string[]> {
  const bytes = new Uint8Array(readFileSync(absPath));
  const cachePath = join(opts.cacheDir, "pdf-text", `${hashBuffer(bytes)}${opts.ocr ? ".ocr" : ""}.json`);
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, "utf8")) as string[];
  }
  const pages = await extractPdfPages(bytes, opts.ocr);
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(pages));
  return pages;
}

/** Rasterize one page to a PNG buffer via unpdf's canvas-backed renderer.
 * Only reached on the OCR path, so its heavier requirements stay opt-in. */
async function renderPage(pdf: Awaited<ReturnType<typeof getDocumentProxy>>, page: number): Promise<Uint8Array> {
  const { renderPageAsImage } = await import("unpdf");
  const result = await renderPageAsImage(pdf, page, { scale: 2 });
  return new Uint8Array(result);
}

/** Lazily load tesseract.js so it is NOT a hard dependency — the default image
 * ships without it and text-only extraction works. Returns null (with a clear
 * log) when `--ocr` is requested but the package isn't installed. */
async function loadOcr(): Promise<((image: Uint8Array) => Promise<string>) | null> {
  try {
    // Computed specifier keeps this a genuinely optional dependency: it is not
    // resolved at build/typecheck time, only if actually installed and `--ocr` is on.
    const moduleName = "tesseract.js";
    const { recognize } = (await import(moduleName)) as {
      recognize: (image: Uint8Array, lang: string) => Promise<{ data: { text: string } }>;
    };
    return async (image: Uint8Array) => (await recognize(image, "eng")).data.text;
  } catch {
    log.warn("--ocr was set but 'tesseract.js' is not installed; falling back to text-layer only. Run `bun add tesseract.js` to enable OCR.");
    return null;
  }
}
