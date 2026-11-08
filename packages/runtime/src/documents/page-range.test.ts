import { describe, expect, it } from "vitest";
import { pagesOf } from "./page-range.js";

describe("pagesOf", () => {
  it("reads single pages and ranges, sorted, each once", () => {
    expect(pagesOf("5-7, 1,3 ,6", 20)).toStrictEqual({
      ok: true,
      value: { pages: [1, 3, 5, 6, 7], cut: false },
    });
  });

  it("keeps the lowest pages up to the most, and says it left some out", () => {
    expect(pagesOf("10-40", 20)).toStrictEqual({
      ok: true,
      value: { pages: Array.from({ length: 20 }, (_page, index) => index + 10), cut: true },
    });
  });

  it("refuses a page that is no number, a backwards range, page 0 and an empty range", () => {
    const refused = ["a", "7-3", "0", " , "].map((range) => pagesOf(range, 20).ok);
    expect(refused).toStrictEqual([false, false, false, false]);
  });
});
