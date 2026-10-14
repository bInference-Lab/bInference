import { describe, expect, it } from "vitest";
import { createBoundedMemo } from "./bounded-memo.js";

describe("bounded memo", () => {
  it("keeps what it was given, and drops the entry kept longest once full", () => {
    const memo = createBoundedMemo<string, number>(2);
    memo.set("a", 1);
    memo.set("b", 2);
    memo.set("a", 3);
    memo.set("c", 4);
    expect([memo.get("a"), memo.get("b"), memo.get("c")]).toStrictEqual([3, undefined, 4]);
  });
});
