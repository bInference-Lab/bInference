import { describe, expect, it } from "vitest";
import { jsonShapeProblem } from "./json-shape.schema.js";

describe("jsonShapeProblem", () => {
  it("finds brackets nested past the bound, and none inside strings", () => {
    expect(jsonShapeProblem("[[[]]]", 3)).toBeUndefined();
    expect(jsonShapeProblem("[[[[]]]]", 3)).toBe("too_deep");
    expect(jsonShapeProblem(String.raw`["[[[[", "\"[[[["]`, 1)).toBeUndefined();
  });

  it("finds a key written twice in one object, as JSON reads the key", () => {
    expect(jsonShapeProblem(String.raw`{"ab": 1, "\u0061b": 2}`, 4)).toBe("duplicate_key");
    expect(jsonShapeProblem('{"a": {"a": 1}, "b": [{"a": 2}]}', 4)).toBeUndefined();
  });
});
