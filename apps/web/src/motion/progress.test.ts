import { describe, expect, it } from "vitest";
import { easedToward, progressOf, stepOf } from "./progress";

describe("progressOf", () => {
  it("runs a pinned scene from its top to its end", () => {
    expect(progressOf("pinned", { top: 0, height: 3000 }, 1000)).toBe(0);
    expect(progressOf("pinned", { top: -1000, height: 3000 }, 1000)).toBe(0.5);
    expect(progressOf("pinned", { top: -2000, height: 3000 }, 1000)).toBe(1);
  });

  it("runs a view scene from entering at the bottom to leaving at the top", () => {
    expect(progressOf("view", { top: 1000, height: 500 }, 1000)).toBe(0);
    expect(progressOf("view", { top: 250, height: 500 }, 1000)).toBe(0.5);
    expect(progressOf("view", { top: -500, height: 500 }, 1000)).toBe(1);
  });

  it("runs a hero from rest to scrolled away", () => {
    expect(progressOf("leave", { top: 0, height: 800 }, 1000)).toBe(0);
    expect(progressOf("leave", { top: -400, height: 800 }, 1000)).toBe(0.5);
  });

  it("stays between 0 and 1", () => {
    expect(progressOf("pinned", { top: 500, height: 3000 }, 1000)).toBe(0);
    expect(progressOf("pinned", { top: -9000, height: 3000 }, 1000)).toBe(1);
  });
});

describe("easedToward", () => {
  it("moves a share of the way and snaps when close", () => {
    const next = easedToward(0, 1);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(0.2);
    expect(easedToward(0.9999, 1)).toBe(1);
  });
});

describe("stepOf", () => {
  it("splits the progress into equal steps and keeps the last one at the end", () => {
    expect(stepOf(0, 5)).toBe(0);
    expect(stepOf(0.39, 5)).toBe(1);
    expect(stepOf(1, 5)).toBe(4);
  });
});
