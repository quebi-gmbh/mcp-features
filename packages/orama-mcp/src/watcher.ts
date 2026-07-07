import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { watch } from "chokidar";
import picomatch from "picomatch";
import { chunkJsonl } from "./adapters/jsonl";
import { chunkMarkdown } from "./adapters/markdown";
import type { Chunk } from "./adapters/types";
import type { KnowledgeEngine } from "./engine";
import { createLogger } from "./util/log";

const log = createLogger("watcher");
const ALWAYS_IGNORED = /(^|\/)(node_modules|\.git)(\/|$)/;

function chunksFor(relPath: string, absPath: string): Chunk[] {
  const content = readFileSync(absPath, "utf8");
  if (relPath.endsWith(".md") || relPath.endsWith(".markdown")) return chunkMarkdown(relPath, content);
  if (relPath.endsWith(".jsonl")) return chunkJsonl(relPath, content);
  return [];
}

/** Watches `root` for add/change/unlink of files matching `globs` (chokidar itself
 * dropped glob support in v4+, so matching is done here via picomatch) and keeps
 * `engine` live-synced. `cacheDirName` (relative to root) is always excluded. */
export function startWatcher(
  root: string,
  globs: string[],
  cacheDirName: string,
  engine: KnowledgeEngine,
): () => Promise<void> {
  const matchers = globs.map((g) => picomatch(g));

  const watcher = watch(root, {
    ignored: (path, stats) => {
      const rel = relative(root, path);
      if (rel === "") return false;
      if (ALWAYS_IGNORED.test(rel) || rel === cacheDirName || rel.startsWith(`${cacheDirName}/`)) return true;
      if (stats?.isFile()) return !matchers.some((m) => m(rel));
      return false;
    },
  });

  const handle = async (absPath: string): Promise<void> => {
    const relPath = relative(root, absPath);
    try {
      await engine.indexFile(relPath, chunksFor(relPath, absPath));
    } catch (err) {
      log.warn("failed to index file", { relPath, message: (err as Error).message });
    }
  };

  watcher.on("add", (path) => void handle(path));
  watcher.on("change", (path) => void handle(path));
  watcher.on("unlink", (path) => void engine.removeFile(relative(root, path)));
  watcher.on("error", (err) => log.error("watcher error", { message: (err as Error).message }));

  return async () => {
    await watcher.close();
  };
}
