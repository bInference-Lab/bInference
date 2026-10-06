import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "./result.js";

function half(value: number): Result<number, "odd"> {
  return value % 2 === 0 ? ok(value / 2) : err("odd");
}

describe("result", () => {
  it("carries a value on success", () => {
    expect(half(4)).toStrictEqual({ ok: true, value: 2 });
  });

  it("carries the named outcome on an expected failure", () => {
    expect(half(3)).toStrictEqual({ ok: false, error: "odd" });
  });
});
