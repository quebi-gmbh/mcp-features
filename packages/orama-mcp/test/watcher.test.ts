import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, type Stats, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watch } from "chokidar";
import { createIgnoreFilter, isPrunedPath } from "../src/watcher";

const ROOT = "/repo";
const GLOBS = ["**/*.md", "**/*.jsonl", "**/*.pdf"];
const CACHE_DIR_NAME = ".orama-cache";
const PRUNED = [
  "node_modules",
  ".git",
  ".pnpm-store",
  "dist",
  "build",
  ".wrangler",
  ".react-router",
  ".playwright-mcp",
];

const ignored = createIgnoreFilter(ROOT, GLOBS, CACHE_DIR_NAME);
const dirStats = { isFile: () => false } as Stats;
const fileStats = { isFile: () => true } as Stats;

/** Chokidar asks about a directory both with and without stats; both must agree. */
function dirIgnored(rel: string): boolean {
  const abs = join(ROOT, rel);
  const withoutStats = ignored(abs);
  const withStats = ignored(abs, dirStats);
  expect(withoutStats).toBe(withStats);
  return withStats;
}

function fileIgnored(rel: string): boolean {
  return ignored(join(ROOT, rel), fileStats);
}

describe("isPrunedPath", () => {
  test("prunes vendored, build-output and scratch directories", () => {
    for (const name of PRUNED) {
      expect(isPrunedPath(name)).toBe(true);
      expect(isPrunedPath(`packages/app/${name}`)).toBe(true);
      expect(isPrunedPath(`${name}/nested/deep/README.md`)).toBe(true);
    }
  });

  test("matches whole segments only", () => {
    expect(isPrunedPath("distribution")).toBe(false);
    expect(isPrunedPath("docs/building")).toBe(false);
    expect(isPrunedPath("my-dist")).toBe(false);
    expect(isPrunedPath("rebuild/notes.md")).toBe(false);
  });

  test("leaves ordinary source and doc trees alone", () => {
    expect(isPrunedPath("docs/guide.md")).toBe(false);
    expect(isPrunedPath(".claude/projects/session.jsonl")).toBe(false);
    expect(isPrunedPath(".worktrees/feature/README.md")).toBe(false);
  });
});

describe("createIgnoreFilter", () => {
  test("never ignores the watch root itself", () => {
    expect(ignored(ROOT)).toBe(false);
    expect(ignored(ROOT, dirStats)).toBe(false);
  });

  test("prunes dead directories so chokidar never takes a watch on them", () => {
    expect(dirIgnored("node_modules")).toBe(true);
    expect(dirIgnored(".pnpm-store")).toBe(true);
    expect(dirIgnored(".pnpm-store/v3/files/00")).toBe(true);
    expect(dirIgnored("packages/app/dist")).toBe(true);
    expect(dirIgnored("apps/web/build/assets")).toBe(true);
    expect(dirIgnored(".wrangler")).toBe(true);
    expect(dirIgnored(".react-router/types")).toBe(true);
    expect(dirIgnored(".playwright-mcp")).toBe(true);
  });

  test("keeps watching directories that hold indexable content", () => {
    expect(dirIgnored("docs")).toBe(false);
    expect(dirIgnored("packages/app/src")).toBe(false);
    expect(dirIgnored(".claude/projects")).toBe(false);
    expect(dirIgnored(".worktrees/feature")).toBe(false);
  });

  test("ignores the cache directory but not similarly named siblings", () => {
    expect(dirIgnored(CACHE_DIR_NAME)).toBe(true);
    expect(dirIgnored(`${CACHE_DIR_NAME}/pdf`)).toBe(true);
    expect(dirIgnored(`${CACHE_DIR_NAME}-old`)).toBe(false);
  });

  test("keeps only files matching one of the globs", () => {
    expect(fileIgnored("README.md")).toBe(false);
    expect(fileIgnored("docs/guide.md")).toBe(false);
    expect(fileIgnored("docs/spec.pdf")).toBe(false);
    expect(fileIgnored("src/index.ts")).toBe(true);
    expect(fileIgnored("package.json")).toBe(true);
  });

  test("ignores matching files inside pruned directories", () => {
    expect(fileIgnored("node_modules/pkg/README.md")).toBe(true);
    expect(fileIgnored("packages/app/dist/CHANGELOG.md")).toBe(true);
    expect(fileIgnored(`${CACHE_DIR_NAME}/notes.md`)).toBe(true);
  });

  // Known gap, unchanged by the directory pruning above: picomatch does not let
  // `**` cross a dot-directory unless `dot: true` is set, so nothing under
  // `.claude/` is matched even though the default globs list `**/*.jsonl`.
  test("does not (yet) match files under dot-directories", () => {
    expect(fileIgnored(".claude/projects/session.jsonl")).toBe(true);
  });
});

describe("startWatcher pruning against a real tree", () => {
  const root = mkdtempSync(join(tmpdir(), "orama-watcher-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("chokidar takes no watch on a pruned directory", async () => {
    for (const dir of ["docs", "src", ...PRUNED.map((p) => `packages/app/${p}`)]) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "notes.md"), "# notes\n");
    }

    const watcher = watch(root, { ignored: createIgnoreFilter(root, GLOBS, CACHE_DIR_NAME) });
    const added: string[] = [];
    watcher.on("add", (path) => added.push(path.slice(root.length + 1)));
    await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
    const watched = Object.keys(watcher.getWatched());
    await watcher.close();

    expect(added.sort()).toEqual(["docs/notes.md", "src/notes.md"]);
    for (const name of PRUNED) {
      expect(watched.some((dir) => dir.startsWith(root) && dir.split("/").includes(name))).toBe(false);
    }
    expect(watched).toContain(join(root, "docs"));
  });
});
