import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, type Stats, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watch } from "chokidar";
import { createIgnoreFilter, dotSegmentsNamedBy, isPrunedPath, isUnmatchableDotPath } from "../src/watcher";

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

/** The filter for a non-default `--globs`, addressed by root-relative path. */
function filterFor(globs: string[]): (rel: string, stats?: Stats) => boolean {
  const filter = createIgnoreFilter(ROOT, globs, CACHE_DIR_NAME);
  return (rel, stats) => filter(join(ROOT, rel), stats);
}

/** Chokidar asks about a directory both with and without stats; both must agree. */
function dirIgnored(rel: string, globs?: string[]): boolean {
  const filter = globs ? filterFor(globs) : (p: string, s?: Stats) => ignored(join(ROOT, p), s);
  const withoutStats = filter(rel);
  const withStats = filter(rel, dirStats);
  expect(withoutStats).toBe(withStats);
  return withStats;
}

function fileIgnored(rel: string, globs?: string[]): boolean {
  return globs ? filterFor(globs)(rel, fileStats) : ignored(join(ROOT, rel), fileStats);
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

  // Dot-directories that aren't on the list are pruned by isUnmatchableDotPath
  // instead, which -- unlike this hard refusal -- a glob can override.
  test("leaves ordinary source and doc trees alone", () => {
    expect(isPrunedPath("docs/guide.md")).toBe(false);
    expect(isPrunedPath(".claude/projects/session.jsonl")).toBe(false);
    expect(isPrunedPath(".worktrees/feature/README.md")).toBe(false);
  });
});

describe("dotSegmentsNamedBy", () => {
  test("is empty for globs that name no dot segment", () => {
    expect(dotSegmentsNamedBy(GLOBS)).toEqual(new Set());
  });

  test("collects literal dot segments at any position", () => {
    expect(dotSegmentsNamedBy([".claude/**/*.jsonl", "docs/**/*.md"])).toEqual(new Set([".claude"]));
    expect(dotSegmentsNamedBy(["**/.github/*.md"])).toEqual(new Set([".github"]));
    expect(dotSegmentsNamedBy([".claude/**/*.jsonl", ".github/*.md"])).toEqual(new Set([".claude", ".github"]));
  });

  test("does not mistake a leading dot in a filename for a directory opt-in", () => {
    // `.env.md` is a dot *file*; it still opts dot paths named `.env.md` in, which
    // is harmless -- what matters is that it does not disable pruning wholesale.
    expect(dotSegmentsNamedBy(["**/.env.md"])).toEqual(new Set([".env.md"]));
  });

  test("gives up (null) when a wildcard could match a dot segment", () => {
    expect(dotSegmentsNamedBy([".*/notes.md"])).toBeNull();
    expect(dotSegmentsNamedBy(["**/*.md", ".?laude/**/*.jsonl"])).toBeNull();
  });
});

describe("isUnmatchableDotPath", () => {
  const none = new Set<string>();

  test("flags any dot segment when no glob names one", () => {
    expect(isUnmatchableDotPath(".claude", none)).toBe(true);
    expect(isUnmatchableDotPath(".claude/projects/a.jsonl", none)).toBe(true);
    expect(isUnmatchableDotPath("packages/app/.turbo/log.md", none)).toBe(true);
  });

  test("leaves ordinary paths alone", () => {
    expect(isUnmatchableDotPath("docs/guide.md", none)).toBe(false);
    expect(isUnmatchableDotPath("a.b/c.md", none)).toBe(false);
    expect(isUnmatchableDotPath("worktrees/feature/README.md", none)).toBe(false);
  });

  test("keeps dot segments a glob named, and only those", () => {
    const named = new Set([".claude"]);
    expect(isUnmatchableDotPath(".claude/projects/a.jsonl", named)).toBe(false);
    expect(isUnmatchableDotPath(".claude/.git/a.jsonl", named)).toBe(true);
    expect(isUnmatchableDotPath(".vscode/a.md", named)).toBe(true);
  });

  test("prunes nothing when the named set is not enumerable", () => {
    expect(isUnmatchableDotPath(".anything/at/all.md", null)).toBe(false);
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
    expect(dirIgnored("a.b")).toBe(false);
  });

  test("ignores the cache directory but not similarly named siblings", () => {
    expect(dirIgnored(CACHE_DIR_NAME)).toBe(true);
    expect(dirIgnored(`${CACHE_DIR_NAME}/pdf`)).toBe(true);
    // `.orama-cache-old` is still a dot-directory, so the dot pruning below
    // catches it -- but not as the cache directory.
    expect(dirIgnored(`${CACHE_DIR_NAME}-old`, ["**/.orama-cache-old/*.md"])).toBe(false);
  });

  test("keeps only files matching one of the globs", () => {
    expect(fileIgnored("README.md")).toBe(false);
    expect(fileIgnored("docs/guide.md")).toBe(false);
    expect(fileIgnored("docs/notes.jsonl")).toBe(false);
    expect(fileIgnored("docs/spec.pdf")).toBe(false);
    expect(fileIgnored("src/index.ts")).toBe(true);
    expect(fileIgnored("package.json")).toBe(true);
  });

  test("ignores matching files inside pruned directories", () => {
    expect(fileIgnored("node_modules/pkg/README.md")).toBe(true);
    expect(fileIgnored("packages/app/dist/CHANGELOG.md")).toBe(true);
    expect(fileIgnored(`${CACHE_DIR_NAME}/notes.md`)).toBe(true);
  });

  // The bug this closes: `**/*.jsonl` cannot match under a dot-directory
  // (picomatch `dot: false`), so watching one bought inotify watches -- 692 for
  // `.claude` on a real checkout -- and zero indexed files.
  test("prunes dot-directories the globs can never reach into", () => {
    expect(dirIgnored(".claude")).toBe(true);
    expect(dirIgnored(".claude/projects")).toBe(true);
    expect(dirIgnored(".worktrees/feature")).toBe(true);
    expect(dirIgnored(".github/workflows")).toBe(true);
    expect(dirIgnored("packages/app/.turbo")).toBe(true);
    expect(fileIgnored(".claude/projects/session.jsonl")).toBe(true);
    expect(fileIgnored(".github/CONTRIBUTING.md")).toBe(true);
  });

  test("a glob naming a dot-directory opts it back in, and only it", () => {
    const globs = [".claude/**/*.jsonl", "**/*.md"];
    expect(dirIgnored(".claude", globs)).toBe(false);
    expect(dirIgnored(".claude/projects", globs)).toBe(false);
    expect(fileIgnored(".claude/projects/session.jsonl", globs)).toBe(false);
    expect(fileIgnored(".claude/projects/session.md", globs)).toBe(true);
    expect(dirIgnored(".github", globs)).toBe(true);
    expect(dirIgnored(".claude/.git", globs)).toBe(true);
  });

  test("a glob cannot opt back into a hard-pruned directory name", () => {
    expect(dirIgnored(".wrangler", [".wrangler/**/*.md"])).toBe(true);
    expect(fileIgnored("dist/notes.md", ["dist/**/*.md"])).toBe(true);
  });
});

describe("startWatcher pruning against a real tree", () => {
  const root = mkdtempSync(join(tmpdir(), "orama-watcher-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  async function run(globs: string[]): Promise<{ added: string[]; watched: string[] }> {
    const watcher = watch(root, { ignored: createIgnoreFilter(root, globs, CACHE_DIR_NAME) });
    const added: string[] = [];
    watcher.on("add", (path) => added.push(path.slice(root.length + 1)));
    await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));
    const watched = Object.keys(watcher.getWatched());
    await watcher.close();
    return { added: added.sort(), watched };
  }

  test("chokidar takes no watch on a pruned directory", async () => {
    for (const dir of ["docs", "src", ...PRUNED.map((p) => `packages/app/${p}`)]) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "notes.md"), "# notes\n");
    }

    const { added, watched } = await run(GLOBS);

    expect(added).toEqual(["docs/notes.md", "src/notes.md"]);
    for (const name of PRUNED) {
      expect(watched.some((dir) => dir.startsWith(root) && dir.split("/").includes(name))).toBe(false);
    }
    expect(watched).toContain(join(root, "docs"));
  });

  test("chokidar takes no watch inside an unreachable dot-directory", async () => {
    for (const dir of [".claude/projects", ".github/workflows"]) {
      mkdirSync(join(root, dir), { recursive: true });
    }
    writeFileSync(join(root, ".claude", "projects", "session.jsonl"), '{"text":"transcript"}\n');
    writeFileSync(join(root, ".github", "workflows", "ci.md"), "# ci\n");

    const { added, watched } = await run(GLOBS);

    expect(added).toEqual(["docs/notes.md", "src/notes.md"]);
    expect(watched.some((dir) => dir.split("/").includes(".claude"))).toBe(false);
    expect(watched.some((dir) => dir.split("/").includes(".github"))).toBe(false);
  });

  test("an explicit dot-directory glob is watched and indexed", async () => {
    const { added, watched } = await run([".claude/**/*.jsonl"]);

    expect(added).toEqual([".claude/projects/session.jsonl"]);
    expect(watched).toContain(join(root, ".claude", "projects"));
    expect(watched.some((dir) => dir.split("/").includes(".github"))).toBe(false);
  });
});
