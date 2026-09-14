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
    expect(config.transport).toBe("stdio");
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(7338);
    expect(config.path).toBe("/mcp");
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

  test("selects the HTTP transport via --transport or the --http shorthand", () => {
    expect(parseConfig(["--transport", "http"]).transport).toBe("http");
    expect(parseConfig(["--http"]).transport).toBe("http");
    expect(parseConfig(["--http", "--port", "9000"]).transport).toBe("http");
    expect(parseConfig(["--transport", "stdio"]).transport).toBe("stdio");
  });

  test("parses --host, --port, and --path", () => {
    const config = parseConfig(["--http", "--host", "0.0.0.0", "--port", "9999", "--path", "/knowledge"]);
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(9999);
    expect(config.path).toBe("/knowledge");
  });

  test("normalizes --path to a single leading slash and no trailing slash", () => {
    expect(parseConfig(["--path", "mcp"]).path).toBe("/mcp");
    expect(parseConfig(["--path", "/mcp/"]).path).toBe("/mcp");
    expect(parseConfig(["--path", "/"]).path).toBe("/");
  });

  test("allows --port 0 (ephemeral)", () => {
    expect(parseConfig(["--http", "--port", "0"]).port).toBe(0);
  });

  // A typo must not silently fall back to stdio: in HTTP mode that leaves the
  // port unbound and every client degrading to ConnectionRefused.
  test("throws on an unknown --transport", () => {
    expect(() => parseConfig(["--transport", "htp"])).toThrow(/invalid --transport 'htp'/);
    expect(() => parseConfig(["--transport"])).toThrow(/--transport requires a value/);
    expect(() => parseConfig(["--http", "yes"])).toThrow(/--http takes no value/);
  });

  test("throws on an out-of-range or non-numeric --port", () => {
    expect(() => parseConfig(["--port", "65536"])).toThrow(/invalid --port '65536'/);
    expect(() => parseConfig(["--port", "abc"])).toThrow(/invalid --port 'abc'/);
    expect(() => parseConfig(["--port", "7338x"])).toThrow(/invalid --port '7338x'/);
    expect(() => parseConfig(["--port"])).toThrow(/--port requires a value/);
  });
});
