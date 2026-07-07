/** stdout is the stdio MCP protocol channel — all logging must go to stderr. */
type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, scope: string, message: string, extra?: unknown): void {
  const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${message}`;
  process.stderr.write(extra !== undefined ? `${line} ${JSON.stringify(extra)}\n` : `${line}\n`);
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, extra?: unknown) => write("debug", scope, message, extra),
    info: (message: string, extra?: unknown) => write("info", scope, message, extra),
    warn: (message: string, extra?: unknown) => write("warn", scope, message, extra),
    error: (message: string, extra?: unknown) => write("error", scope, message, extra),
  };
}
