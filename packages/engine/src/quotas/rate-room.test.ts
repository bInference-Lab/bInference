import { describe, expect, it } from "vitest";
import { rateRoom, rateWindowMs } from "./rate-room.js";

describe("rate room", () => {
  it("fits one more while fewer than the quota are in the window", () => {
    expect(rateRoom([1_000, 2_000], 3)).toStrictEqual({ fits: true });
  });

  it("names when the oldest counted one leaves the window, in any order of times", () => {
    expect(rateRoom([3_000, 1_000, 2_000], 3)).toStrictEqual({
      fits: false,
      resumesAt: 1_000 + rateWindowMs,
    });
  });

  it("waits for as many to leave as the count passes the quota by", () => {
    expect(rateRoom([1_000, 2_000, 3_000, 4_000], 2)).toStrictEqual({
      fits: false,
      resumesAt: 3_000 + rateWindowMs,
    });
  });

  it("fits none ever under a quota of 0, naming no time", () => {
    expect(rateRoom([], 0)).toStrictEqual({ fits: false });
    expect(rateRoom([1_000], 0)).toStrictEqual({ fits: false });
  });
});
