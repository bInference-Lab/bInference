import { describe, expect, it } from "vitest";
import { restingAgent } from "./agent-motion";
import { engravingPath } from "./engraving-path";
import { markHeight } from "./mark-field";
import { linePeriod } from "./relief";

const { angle } = restingAgent({ x: 0, y: 0 });

describe("engravingPath", () => {
  it("draws every engraved line as its own closed shape", () => {
    const path = engravingPath(angle);
    const shapes = path.split("M").length - 1;
    expect(path.startsWith("M")).toBe(true);
    expect(path.split("Z").length - 1).toBe(shapes);
    expect(shapes).toBeGreaterThanOrEqual(Math.floor(markHeight / linePeriod));
  });

  it("stays inside the mark and draws the same lines each time", () => {
    const path = engravingPath(angle);
    const ys = [...path.matchAll(/[ML]-?[\d.]+ (-?[\d.]+)/g)].map(([, y = ""]) => Number(y));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(markHeight);
    expect(engravingPath(angle)).toBe(path);
  });
});
