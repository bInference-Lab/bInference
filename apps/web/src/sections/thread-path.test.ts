import { describe, expect, it } from "vitest";
import { edgeFacing, threadPath } from "./thread-path";

const core = { x: 500, y: 300 };

describe("edgeFacing", () => {
  it("enters a tall box on the left from its right edge", () => {
    const phone = { left: 0, top: 0, width: 200, height: 600 };
    expect(edgeFacing(phone, core)).toEqual({ at: { x: 200, y: 300 }, out: { x: 1, y: 0 } });
  });

  it("enters a box below the core from its top edge", () => {
    const below = { left: 400, top: 500, width: 200, height: 100 };
    expect(edgeFacing(below, core)).toEqual({ at: { x: 500, y: 500 }, out: { x: 0, y: -1 } });
  });

  it("enters a box on the right from its left edge, even when the box sits low", () => {
    const right = { left: 800, top: 100, width: 300, height: 200 };
    expect(edgeFacing(right, core).at).toEqual({ x: 800, y: 200 });
    const low = { left: 800, top: 500, width: 300, height: 200 };
    expect(edgeFacing(low, core).at).toEqual({ x: 800, y: 600 });
  });
});

describe("threadPath", () => {
  it("leaves the orbit toward the box and ends on its facing edge", () => {
    const below = { left: 400, top: 600, width: 200, height: 100 };
    expect(threadPath(core, 120, below)).toBe("M500.0 420.0 C500.0 501.0 500.0 519.0 500.0 600.0");
  });
});
