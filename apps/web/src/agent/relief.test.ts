import { describe, expect, it } from "vitest";
import { markHeight, markWidth } from "./mark-field";
import { type PathSink, type ReliefOptions, traceRelief } from "./relief";

interface Recorded {
  readonly shapes: number;
  /** The gold the engraving covers: the summed area of its closed shapes. */
  readonly area: number;
  readonly points: readonly { readonly x: number; readonly y: number }[];
}

function shoelace(shape: readonly { readonly x: number; readonly y: number }[]): number {
  let twice = 0;
  shape.forEach((point, index) => {
    const next = shape[(index + 1) % shape.length] ?? point;
    twice += point.x * next.y - next.x * point.y;
  });
  return Math.abs(twice) / 2;
}

function record(options: ReliefOptions): Recorded {
  const points: { x: number; y: number }[] = [];
  let shape: { x: number; y: number }[] = [];
  let shapes = 0;
  let area = 0;
  const sink: PathSink = {
    moveTo: (x, y) => {
      shape = [{ x, y }];
      points.push({ x, y });
    },
    lineTo: (x, y) => {
      shape.push({ x, y });
      points.push({ x, y });
    },
    closePath: () => {
      shapes += 1;
      area += shoelace(shape);
    },
  };
  traceRelief(sink, options);
  return { shapes, area, points };
}

const lit: ReliefOptions = {
  axis: { x: 1, y: 0 },
  light: { x: 0, y: 0, z: 1 },
  rows: 1000,
  weight: 1,
};

describe("traceRelief", () => {
  it("engraves the whole mark as closed line shapes inside its bounds", () => {
    const { shapes, points } = record(lit);
    expect(shapes).toBeGreaterThan(70);
    expect(Math.min(...points.map((point) => point.x))).toBeGreaterThanOrEqual(-8);
    expect(Math.max(...points.map((point) => point.x))).toBeLessThanOrEqual(markWidth + 8);
    expect(Math.min(...points.map((point) => point.y))).toBeGreaterThanOrEqual(-10);
    expect(Math.max(...points.map((point) => point.y))).toBeLessThanOrEqual(markHeight + 10);
  });

  it("draws only the rows engraved so far", () => {
    expect(record({ ...lit, rows: 0 }).shapes).toBeLessThan(3);
    expect(record({ ...lit, rows: 20 }).shapes).toBeLessThan(record(lit).shapes);
  });

  it("draws thinner lines at a lighter weight", () => {
    expect(record({ ...lit, weight: 0.5 }).area).toBeLessThan(record(lit).area * 0.7);
  });

  it("draws thinner lines where the surface turns away from a low light", () => {
    const grazing = record({ ...lit, light: { x: 0.8, y: 0, z: 0.6 } }).area;
    expect(grazing).toBeLessThan(record(lit).area);
  });
});
