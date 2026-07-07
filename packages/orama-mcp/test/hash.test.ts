import { describe, expect, test } from "bun:test";
import { hashText } from "../src/util/hash";

describe("hashText", () => {
  test("is deterministic", () => {
    expect(hashText("hello world")).toBe(hashText("hello world"));
  });

  test("differs for different input", () => {
    expect(hashText("hello")).not.toBe(hashText("world"));
  });

  test("returns a hex sha256 digest", () => {
    expect(hashText("hello")).toMatch(/^[0-9a-f]{64}$/);
  });
});
