import { resolve } from "node:path";

export type TransportKind = "stdio" | "http";

const TRANSPORTS: readonly TransportKind[] = ["stdio", "http"];

export const DEFAULT_HOST = "127.0.0.1";
/** Next to lsp-mcp's 7337. */
export const DEFAULT_PORT = 7338;
export const DEFAULT_PATH = "/mcp";

export interface Config {
  root: string;
  globs: string[];
  cacheDir: string;
  ocr: boolean;
  /** stdio is the default: a bare `orama-mcp --root ...` in a shell or CI keeps working. */
  transport: TransportKind;
  /** HTTP only. */
  host: string;
  /** HTTP only. 0 asks the OS for an ephemeral port. */
  port: number;
  /** HTTP only. The path the MCP endpoint is served on, always leading-slashed. */
  path: string;
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

/** A flag written with no value (`--port` at the end of argv, or immediately
 * followed by another flag) parses as "true". For value-taking flags that is a
 * typo, not a default -- say so rather than quietly using the default. */
function valueOf(flags: Record<string, string>, key: string): string | undefined {
  const raw = flags[key];
  if (raw === undefined) return undefined;
  if (raw === "true") throw new Error(`--${key} requires a value`);
  return raw;
}

function parseTransport(flags: Record<string, string>): TransportKind {
  const explicit = valueOf(flags, "transport");
  if (explicit !== undefined) {
    if (!TRANSPORTS.includes(explicit as TransportKind)) {
      // Never silently fall back: in HTTP mode a typo would leave the port
      // unbound and every client would degrade to ConnectionRefused instead.
      throw new Error(`invalid --transport '${explicit}' (expected one of: ${TRANSPORTS.join(", ")})`);
    }
    return explicit as TransportKind;
  }
  if (flags.http === "true") return "http";
  if (flags.http !== undefined) throw new Error("--http takes no value; use --transport http");
  return "stdio";
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  if (!/^\d+$/.test(raw) || Number(raw) > 65535) {
    throw new Error(`invalid --port '${raw}' (expected an integer 0-65535)`);
  }
  return Number(raw);
}

function normalizePath(raw: string | undefined): string {
  if (raw === undefined) return DEFAULT_PATH;
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const trimmed = withSlash.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function parseConfig(argv: string[]): Config {
  const flags = parseFlags(argv);
  const root = resolve(flags.root ?? process.cwd());
  const globs = (flags.globs ?? "**/*.md,**/*.jsonl,**/*.pdf").split(",").map((g) => g.trim());
  const cacheDir = resolve(root, flags.cache ?? ".orama-cache");
  const ocr = flags.ocr === "true";
  const transport = parseTransport(flags);
  const host = valueOf(flags, "host") ?? DEFAULT_HOST;
  const port = parsePort(valueOf(flags, "port"));
  const path = normalizePath(valueOf(flags, "path"));
  return { root, globs, cacheDir, ocr, transport, host, port, path };
}
