import { describe, expect, it } from "vitest";
import { createSeenLaunches } from "./seen-launches.js";

const day = 24 * 60 * 60_000;

describe("createSeenLaunches", () => {
  it("claims a launch once and refuses it again for the retention", () => {
    const seen = createSeenLaunches({ retentionMs: day, maxEntries: 8 });
    expect([seen.claim("a", 0), seen.claim("a", 1), seen.claim("a", day - 1)]).toStrictEqual([
      true,
      false,
      false,
    ]);
  });

  it("forgets a launch once its retention passed", () => {
    const seen = createSeenLaunches({ retentionMs: day, maxEntries: 8 });
    seen.claim("a", 0);
    expect(seen.claim("a", day)).toBe(true);
  });

  it("drops the oldest launch when full and still refuses the newer ones", () => {
    const seen = createSeenLaunches({ retentionMs: day, maxEntries: 2 });
    seen.claim("a", 0);
    seen.claim("b", 1);
    seen.claim("c", 2);
    expect([seen.claim("b", 3), seen.claim("c", 3), seen.claim("a", 3)]).toStrictEqual([
      false,
      false,
      true,
    ]);
  });

  it("refuses a kept launch when full instead of dropping it to make room for itself", () => {
    const seen = createSeenLaunches({ retentionMs: day, maxEntries: 1 });
    seen.claim("a", 0);
    expect(seen.claim("a", 1)).toBe(false);
  });
});
