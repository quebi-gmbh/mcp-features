import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseConfig } from "../src/config";

describe("parseConfig", () => {
  test("applies defaults when no flags are given", () => {
    const config = parseConfig([]);
    expect(config.root).toBe(resolve(process.cwd()));
    expect(config.globs).toEqual(["**/*.md", "**/*.jsonl", "**/*.pdf"]);
    expect(config.cacheDir).toBe(resolve(process.cwd(), ".orama-cache"));
    expect(config.ocr).toBe(false);
  });

  test("enables OCR when --ocr is passed", () => {
    expect(parseConfig(["--ocr"]).ocr).toBe(true);
    expect(parseConfig([]).ocr).toBe(false);
  });

  test("parses --root, --globs, and --cache", () => {
    const config = parseConfig(["--root", "/tmp/repo", "--globs", "**/*.md,docs/**/*.mdx", "--cache", ".cache"]);
    expect(config.root).toBe("/tmp/repo");
    expect(config.globs).toEqual(["**/*.md", "docs/**/*.mdx"]);
    expect(config.cacheDir).toBe("/tmp/repo/.cache");
  });

  test("trims whitespace around comma-separated globs", () => {
    const config = parseConfig(["--globs", "**/*.md, **/*.jsonl"]);
    expect(config.globs).toEqual(["**/*.md", "**/*.jsonl"]);
  });
});
