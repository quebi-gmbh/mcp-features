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
 * uninteresting belong here. This list is a hard refusal — unlike the
 * dot-directory pruning below, no `--globs` value overrides it.
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

/**
 * Glob matching keeps picomatch's default `dot: false`: `*` and `**` never cross
 * a path segment that starts with a dot, so the default globs index
 * `docs/a.jsonl` but not `.claude/projects/a.jsonl`.
 *
 * That is a decision, not an accident of the library default. Dot-directories in
 * a workspace hold tool state (`.claude`, `.worktrees`, `.vscode`, the cache dir
 * itself), not authored knowledge, and sweeping them in by default would spend
 * chunking + embedding on content nobody searches. A caller who *does* want one
 * names it explicitly: a glob with a literal leading `.claude/` matches under
 * that directory regardless of this option.
 */
const MATCH_DOTFILES = false;

/**
 * The dot-prefixed path segments that some glob names literally -- e.g. a glob of
 * `.claude/` + `**` + `/*.jsonl` names `.claude`.
 *
 * `null` means "not enumerable": a glob matches a dot segment with a wildcard
 * (`.*` + `/notes.md`), so no dot path may be pruned.
 */
export function dotSegmentsNamedBy(globs: string[]): Set<string> | null {
  const named = new Set<string>();
  for (const glob of globs) {
    for (const segment of glob.split("/")) {
      if (!segment.startsWith(".") || segment === "." || segment === "..") continue;
      if (picomatch.scan(segment).isGlob) return null;
      named.add(segment);
    }
  }
  return named;
}

/**
 * True when `rel` contains a dot-prefixed segment that no glob names.
 *
 * With `MATCH_DOTFILES` off no glob can reach inside such a segment, so every
 * file under it is unindexable by construction — which makes it the same kind of
 * dead weight as `PRUNED_DIR_NAMES` above: on a real checkout, `.claude` alone
 * cost 692 inotify watches and a recursive scan to index exactly zero files.
 * Unlike that list this one is glob-driven, so naming a dot-directory in
 * `--globs` re-enables both the match and the watch.
 */
export function isUnmatchableDotPath(rel: string, namedDotSegments: Set<string> | null): boolean {
  if (namedDotSegments === null) return false;
  return rel.split("/").some((segment) => segment.startsWith(".") && !namedDotSegments.has(segment));
}

/** Builds chokidar's `ignored` predicate: prune dead directories first, then keep
 * only files matching one of `globs`. Exported for tests. */
export function createIgnoreFilter(
  root: string,
  globs: string[],
  cacheDirName: string,
): (path: string, stats?: Stats) => boolean {
  const matchers = globs.map((g) => picomatch(g, { dot: MATCH_DOTFILES }));
  const namedDotSegments = dotSegmentsNamedBy(globs);
  return (path, stats) => {
    const rel = relative(root, path);
    if (rel === "") return false;
    if (isPrunedPath(rel)) return true;
    if (rel === cacheDirName || rel.startsWith(`${cacheDirName}/`)) return true;
    if (isUnmatchableDotPath(rel, namedDotSegments)) return true;
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
