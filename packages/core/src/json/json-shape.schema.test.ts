import { describe, expect, it } from "vitest";
import {
  jsonShapeProblem,
  maxJsonDepth,
  nestsDeeperThan,
  valueNestsDeeperThan,
} from "./json-shape.schema.js";

// Brackets nested `depth` deep: `[[...]]`.
const nested = (depth: number): string => `${"[".repeat(depth)}${"]".repeat(depth)}`;

describe("jsonShapeProblem", () => {
  it("finds brackets nested past the bound, and none inside strings", () => {
    expect(jsonShapeProblem("[[[]]]", 3)).toBeUndefined();
    expect(jsonShapeProblem("[[[[]]]]", 3)).toBe("too_deep");
    expect(jsonShapeProblem(String.raw`["[[[[", "\"[[[["]`, 1)).toBeUndefined();
  });

  it("passes text nested exactly at the bound and refuses one level more, strings skipped", () => {
    expect(nestsDeeperThan(nested(maxJsonDepth))).toBe(false);
    expect(nestsDeeperThan(nested(maxJsonDepth + 1))).toBe(true);
    expect(nestsDeeperThan(`["${nested(maxJsonDepth + 1).replaceAll("[", "{")}"]`)).toBe(false);
    expect(nestsDeeperThan(nested(300_000))).toBe(true);
  });

  it("passes a value nested exactly at the bound and refuses one level more, without recursion", () => {
    expect(valueNestsDeeperThan(JSON.parse(nested(maxJsonDepth)))).toBe(false);
    expect(valueNestsDeeperThan(JSON.parse(nested(maxJsonDepth + 1)))).toBe(true);
    expect(valueNestsDeeperThan({ a: { b: [1, { c: "d" }] } }, 4)).toBe(false);
    expect(valueNestsDeeperThan({ bytes: new Uint8Array(3) }, 1)).toBe(false);
    expect(valueNestsDeeperThan(JSON.parse(nested(300_000)))).toBe(true);
    expect(valueNestsDeeperThan({ wide: Array.from({ length: 1_000_000 }, () => [0]) })).toBe(
      false,
    );
  });

  it("finds a key written twice in one object, as JSON reads the key", () => {
    expect(jsonShapeProblem(String.raw`{"ab": 1, "\u0061b": 2}`, 4)).toBe("duplicate_key");
    expect(jsonShapeProblem('{"a": {"a": 1}, "b": [{"a": 2}]}', 4)).toBeUndefined();
  });
});
