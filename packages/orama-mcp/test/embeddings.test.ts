import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { env } from "@huggingface/transformers";
import { Embedder } from "../src/embeddings";

describe("Embedder cache dir", () => {
  test("redirects transformers.js model cache into the workspace cache dir", () => {
    // Guards the EACCES fix: transformers.js otherwise caches models under its own
    // (root-owned, in the built image) package dir. Constructing the Embedder must
    // point env.cacheDir at our writable cache dir instead.
    new Embedder("/tmp/orama-cache-under-test");
    expect(env.cacheDir).toBe(join("/tmp/orama-cache-under-test", "models"));
  });
});
