import { describe, expect, test } from "bun:test";
import { chunkJsonl } from "../src/adapters/jsonl";

describe("chunkJsonl", () => {
  test("maps a text field to a chunk with its line number as heading", () => {
    const chunks = chunkJsonl("notes.jsonl", '{"text": "hello"}\n{"text": "world"}\n');
    expect(chunks).toEqual([
      { path: "notes.jsonl", heading: "line 1", text: "hello", source: "jsonl" },
      { path: "notes.jsonl", heading: "line 2", text: "world", source: "jsonl" },
    ]);
  });

  test("accepts a content field as a fallback for text", () => {
    const chunks = chunkJsonl("notes.jsonl", '{"content": "fallback"}\n');
    expect(chunks).toEqual([{ path: "notes.jsonl", heading: "line 1", text: "fallback", source: "jsonl" }]);
  });

  test("skips malformed JSON lines", () => {
    const chunks = chunkJsonl("notes.jsonl", 'not json\n{"text": "valid"}\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe("valid");
  });

  test("skips lines missing both text and content", () => {
    const chunks = chunkJsonl("notes.jsonl", '{"author": "max"}\n{"text": "kept"}\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe("kept");
  });

  test("skips blank lines", () => {
    const chunks = chunkJsonl("notes.jsonl", '{"text": "a"}\n\n{"text": "b"}\n');
    expect(chunks).toHaveLength(2);
  });
});
