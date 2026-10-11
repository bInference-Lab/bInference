import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createAuthFailures } from "./auth-failures.js";

const limits = {
  authMaxFailures: 3,
  authFailureWindowMs: 60_000,
  authLockoutMs: 300_000,
  maxAuthKeys: 4,
};

function failures() {
  const clock = createManualClock(1_000_000);
  return { clock, failures: createAuthFailures({ ...limits, clock }) };
}

describe("createAuthFailures", () => {
  it("locks a key out once it fails the most times within the window, and only that key", () => {
    const { failures: count } = failures();
    expect(count.fail(["addr:a", "dev:1"])).toStrictEqual([]);
    expect(count.fail(["addr:a", "dev:2"])).toStrictEqual([]);
    expect(count.fail(["addr:a", "dev:1"])).toStrictEqual(["addr:a"]);
    expect([
      count.isLocked(["addr:a"]),
      count.isLocked(["addr:b", "dev:1"]),
      count.isLocked(["addr:b", "dev:3"]),
    ]).toStrictEqual([true, false, false]);
  });

  it("starts a new count once the window passed", async () => {
    const { clock, failures: count } = failures();
    count.fail(["addr:a"]);
    count.fail(["addr:a"]);
    await clock.advance(60_000);
    expect(count.fail(["addr:a"])).toStrictEqual([]);
    expect(count.isLocked(["addr:a"])).toBe(false);
  });

  it("keeps a lockout for its full time, whatever fails meanwhile, then lets the key in", async () => {
    const { clock, failures: count } = failures();
    [1, 2, 3].forEach(() => count.fail(["addr:a"]));
    await clock.advance(120_000);
    expect(count.fail(["addr:a"])).toStrictEqual([]);
    expect(count.isLocked(["addr:a"])).toBe(true);
    await clock.advance(180_000);
    expect(count.isLocked(["addr:a"])).toBe(false);
  });

  it("forgets the key counted longest ago past the most it keeps", () => {
    const { failures: count } = failures();
    [1, 2, 3].forEach(() => count.fail(["addr:a"]));
    ["b", "c", "d", "e"].forEach((key) => count.fail([`addr:${key}`]));
    expect(count.isLocked(["addr:a"])).toBe(false);
  });
});
