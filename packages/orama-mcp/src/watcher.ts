import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { watch } from "chokidar";
import picomatch from "picomatch";
import { chunkJsonl } from "./adapters/jsonl";
import { chunkMarkdown } from "./adapters/markdown";
import { chunkPdfPages, loadPdfPages, type PdfOptions } from "./adapters/pdf";
import type { Chunk } from "./adapters/types";
import type { KnowledgeEngine } from "./engine";
import { createLimiter } from "./util/limit";
import { createLogger } from "./util/log";

const log = createLogger("watcher");
const ALWAYS_IGNORED = /(^|\/)(node_modules|\.git)(\/|$)/;
/** PDF parsing (and OCR) is heavy; cap how many files are processed at once. */
const MAX_CONCURRENT_INDEX = 4;

async function chunksFor(relPath: string, absPath: string, pdf: PdfOptions): Promise<Chunk[]> {
  if (relPath.endsWith(".pdf")) return chunkPdfPages(relPath, await loadPdfPages(absPath, pdf));
  const content = readFileSync(absPath, "utf8");
  if (relPath.endsWith(".md") || relPath.endsWith(".markdown")) return chunkMarkdown(relPath, content);
  if (relPath.endsWith(".jsonl")) return chunkJsonl(relPath, content);
  return [];
}

export interface WatcherOptions {
  cacheDir: string;
  cacheDirName: string;
  ocr: boolean;
}

/** Watches `root` for add/change/unlink of files matching `globs` (chokidar itself
 * dropped glob support in v4+, so matching is done here via picomatch) and keeps
 * `engine` live-synced. `cacheDirName` (relative to root) is always excluded. */
export function startWatcher(
  root: string,
  globs: string[],
  engine: KnowledgeEngine,
  opts: WatcherOptions,
): () => Promise<void> {
  const matchers = globs.map((g) => picomatch(g));
  const limit = createLimiter(MAX_CONCURRENT_INDEX);
  const pdf: PdfOptions = { cacheDir: opts.cacheDir, ocr: opts.ocr };

  const watcher = watch(root, {
    ignored: (path, stats) => {
      const rel = relative(root, path);
      if (rel === "") return false;
      if (ALWAYS_IGNORED.test(rel) || rel === opts.cacheDirName || rel.startsWith(`${opts.cacheDirName}/`)) return true;
      if (stats?.isFile()) return !matchers.some((m) => m(rel));
      return false;
    },
  });

  const handle = (absPath: string): void => {
    const relPath = relative(root, absPath);
    void limit(async () => {
      try {
        await engine.indexFile(relPath, await chunksFor(relPath, absPath, pdf));
      } catch (err) {
        log.warn("failed to index file", { relPath, message: (err as Error).message });
      }
    });
  };

  watcher.on("add", handle);
  watcher.on("change", handle);
  watcher.on("unlink", (path) => void engine.removeFile(relative(root, path)));
  watcher.on("error", (err) => log.error("watcher error", { message: (err as Error).message }));

  return async () => {
    await watcher.close();
  };
}
