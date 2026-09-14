import { readFileSync, type Stats } from "node:fs";
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

/**
 * Directory names the watcher refuses to descend into, matched per path segment.
 *
 * Chokidar takes one inotify watch per directory it walks, so the glob filter
 * below saves nothing on watch count — it only stops a file from being *indexed*
 * once its directory is already watched. Every directory that cannot hold
 * indexable content therefore has to be pruned here, or it costs a watch (and a
 * recursive scan) for zero indexed files.
 *
 * Only directories whose contents are generated, vendored, or otherwise
 * uninteresting belong here. Gitignored-but-authored trees (`.claude/` session
 * transcripts, for one) are deliberately still watched.
 */
const PRUNED_DIR_NAMES = new Set([
  // Vendored / package-manager stores.
  "node_modules",
  ".git",
  ".pnpm-store",
  // Build output — generated copies of sources that are already indexed.
  "dist",
  "build",
  ".wrangler",
  ".react-router",
  // Tool scratch space.
  ".playwright-mcp",
]);

/** True when any segment of the root-relative path `rel` is a pruned directory. */
export function isPrunedPath(rel: string): boolean {
  return rel.split("/").some((segment) => PRUNED_DIR_NAMES.has(segment));
}

/** Builds chokidar's `ignored` predicate: prune dead directories first, then keep
 * only files matching one of `globs`. Exported for tests. */
export function createIgnoreFilter(
  root: string,
  globs: string[],
  cacheDirName: string,
): (path: string, stats?: Stats) => boolean {
  const matchers = globs.map((g) => picomatch(g));
  return (path, stats) => {
    const rel = relative(root, path);
    if (rel === "") return false;
    if (isPrunedPath(rel)) return true;
    if (rel === cacheDirName || rel.startsWith(`${cacheDirName}/`)) return true;
    if (stats?.isFile()) return !matchers.some((m) => m(rel));
    return false;
  };
}

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
  const limit = createLimiter(MAX_CONCURRENT_INDEX);
  const pdf: PdfOptions = { cacheDir: opts.cacheDir, ocr: opts.ocr };

  const watcher = watch(root, { ignored: createIgnoreFilter(root, globs, opts.cacheDirName) });

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
