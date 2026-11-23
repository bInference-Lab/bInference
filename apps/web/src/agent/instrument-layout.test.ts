import { describe, expect, it } from "vitest";
import { instrumentLayout, ringRadius } from "./instrument-layout";

const ahead = { x: 0, y: 0 };
const farLeftUp = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };

describe("instrumentLayout", () => {
  it("keeps the core clear of its ring at the height of a pulse", () => {
    for (const breathe of [-1, 0, 1]) {
      for (const sincePulse of [0, 0.05, 0.2, Number.POSITIVE_INFINITY]) {
        const { core } = instrumentLayout(farLeftUp, { grown: 1, breathe, sincePulse });
        expect(core).toBeLessThanOrEqual(ringRadius - 5);
      }
    }
  });

  it("moves the eye further toward the look than the dial", () => {
    const layout = instrumentLayout(farLeftUp, { grown: 1, breathe: 0, sincePulse: 1 });
    expect(Math.hypot(layout.eye.x, layout.eye.y)).toBeGreaterThan(
      Math.hypot(layout.dial.x, layout.dial.y),
    );
    expect(layout.eye.x).toBeLessThan(0);
  });

  it("centers every layer on the core point when the agent looks ahead", () => {
    const layout = instrumentLayout(ahead, { grown: 1, breathe: 0, sincePulse: 1 });
    expect(layout.dial).toEqual({ x: 0, y: 0 });
    expect(layout.eye).toEqual({ x: 0, y: 0 });
  });

  it("grows the core in from nothing", () => {
    const { core } = instrumentLayout(ahead, { grown: 0, breathe: 0, sincePulse: 1 });
    expect(core).toBe(0);
  });
});
