import { describe, expect, it } from "vitest";
import { itemAt } from "./item-at.js";

describe("itemAt", () => {
  it("reads the item at a place, and the fallback past the list's ends", () => {
    expect([itemAt(["a", "b"], 1, ""), itemAt(["a"], 3, ""), itemAt([], -1, 0)]).toStrictEqual([
      "b",
      "",
      0,
    ]);
  });
});
