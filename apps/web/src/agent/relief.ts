import { bodyDistance, markHeight, markWidth, type Point } from "./mark-field";

/** Where a traced shape goes: a canvas path, or a recorder in a test. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

/** A light direction: x and y across the mark, z toward the viewer; its length is 1. */
interface Light {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** What the engraving of one frame depends on. */
export interface ReliefOptions {
  /** The needle's unit direction, which decides where the body is cut. */
  readonly axis: Point;
  readonly light: Light;
  /** How many rows are engraved yet, from the top: the mark draws itself in as it wakes. */
  readonly rows: number;
  /** How heavy the lines are, 1 at full weight. */
  readonly weight: number;
}

/** The distance between two engraved lines, in the mark's units. */
export const linePeriod = 8.6;
const bevel = 44;
const stepX = 4;

interface Sample {
  readonly x: number;
  readonly y: number;
  readonly distance: number;
}

interface Band {
  readonly top: number;
  readonly bottom: number;
}

// The surface rises in a rounded bevel from the edge; a line swells where that surface faces the
// light, thins where it turns away, and rides up over the raised form.
function bandAt(sample: Sample, options: ReliefOptions): Band {
  const { x, y, distance } = sample;
  const depth = Math.min(-distance / bevel, 1);
  let light = options.light.z;
  let lift = 1;
  if (depth < 1) {
    const gx =
      (bodyDistance(x + 1.5, y, options.axis) - bodyDistance(x - 1.5, y, options.axis)) / 3;
    const gy =
      (bodyDistance(x, y + 1.5, options.axis) - bodyDistance(x, y - 1.5, options.axis)) / 3;
    const rim = 1 - depth;
    const slope = rim / Math.sqrt(1 - rim * rim + 0.03);
    const nx = gx * slope;
    const ny = gy * slope;
    light = Math.max(
      0,
      (nx * options.light.x + ny * options.light.y + options.light.z) / Math.hypot(nx, ny, 1),
    );
    lift = Math.sqrt(1 - rim * rim);
  }
  const thickness =
    linePeriod * (0.13 + 0.7 * light ** 1.25) * options.weight * Math.min(1, 0.35 + depth * 2.4);
  const middle = y - lift * 4.5;
  return { top: middle - thickness / 2, bottom: middle + thickness / 2 };
}

function closeShape(sink: PathSink, tops: readonly Point[], bottoms: readonly Point[]): void {
  const [first, ...rest] = tops;
  if (first === undefined || rest.length === 0) {
    return;
  }
  sink.moveTo(first.x, first.y);
  for (const point of [...rest, ...bottoms.toReversed()]) {
    sink.lineTo(point.x, point.y);
  }
  sink.closePath();
}

function traceRow(sink: PathSink, y: number, options: ReliefOptions): void {
  let tops: Point[] = [];
  let bottoms: Point[] = [];
  let lastX = -stepX;
  let lastDistance = 1;
  for (let x = -stepX; x <= markWidth + stepX * 1.5; x += stepX) {
    const distance = bodyDistance(x, y, options.axis);
    const edgeX = lastX + (stepX * lastDistance) / (lastDistance - distance);
    if (distance < 0) {
      if (lastDistance >= 0 && x > -stepX) {
        tops.push({ x: edgeX, y });
        bottoms.push({ x: edgeX, y });
      }
      const band = bandAt({ x, y, distance }, options);
      tops.push({ x, y: band.top });
      bottoms.push({ x, y: band.bottom });
    } else if (lastDistance < 0) {
      tops.push({ x: edgeX, y });
      bottoms.push({ x: edgeX, y });
      closeShape(sink, tops, bottoms);
      tops = [];
      bottoms = [];
    }
    lastX = x;
    lastDistance = distance;
  }
  closeShape(sink, tops, bottoms);
}

/**
 * Traces the mark as an engraving: one closed shape per run of each horizontal line across the
 * body, filled together they read as a relief lit from `options.light`.
 */
export function traceRelief(sink: PathSink, options: ReliefOptions): void {
  let row = 0;
  for (let y = linePeriod / 2; y < markHeight && row <= options.rows; y += linePeriod) {
    traceRow(sink, y, options);
    row += 1;
  }
}
