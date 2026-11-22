import { describe, expect, it } from "vitest";
import { bodyDistance, corePoint, sensorReach } from "./mark-field";

const across = { x: 1, y: 0 };

describe("bodyDistance", () => {
  it("is inside the stem and the ring", () => {
    expect(bodyDistance(60, 200, across)).toBeLessThan(0);
    expect(bodyDistance(240, 600, across)).toBeLessThan(0);
  });

  it("is outside past the edges and in the core's hole", () => {
    expect(bodyDistance(470, 40, across)).toBeGreaterThan(0);
    expect(bodyDistance(corePoint.x, corePoint.y, across)).toBeGreaterThan(0);
  });

  it("cuts the sensors where the needle points", () => {
    const sensor = { x: corePoint.x + sensorReach, y: corePoint.y };
    expect(bodyDistance(sensor.x, sensor.y, across)).toBeGreaterThan(0);
    expect(bodyDistance(sensor.x, sensor.y, { x: 0, y: 1 })).toBeLessThan(0);
  });
});
