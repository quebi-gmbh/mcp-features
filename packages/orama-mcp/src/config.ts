import { resolve } from "node:path";

export interface Config {
  root: string;
  globs: string[];
  cacheDir: string;
  ocr: boolean;
}

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

export function parseConfig(argv: string[]): Config {
  const flags = parseFlags(argv);
  const root = resolve(flags.root ?? process.cwd());
  const globs = (flags.globs ?? "**/*.md,**/*.jsonl,**/*.pdf").split(",").map((g) => g.trim());
  const cacheDir = resolve(root, flags.cache ?? ".orama-cache");
  const ocr = flags.ocr === "true";
  return { root, globs, cacheDir, ocr };
}
