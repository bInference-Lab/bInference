import type { Point } from "./mark-field";

/** The radius of the thin ring around the core, in the mark's units. */
export const ringRadius = 47;

/** The core's radius at rest, in the mark's units. */
export const coreRadius = 38;
const breatheShare = 0.02;
const pulseShare = 0.08;
const pulseSeconds = 0.25;

/** The moment the instrument is drawn at. */
export interface InstrumentMoment {
  /** How far the instrument has grown in, 0 to 1. */
  readonly grown: number;
  /** The breath, -1 to 1, or 0 for a still agent. */
  readonly breathe: number;
  /** Seconds since the last pulse; `Infinity` when there was none. */
  readonly sincePulse: number;
}

/** Where the instrument's layers sit from the core point, and how large its core is. */
export interface InstrumentLayout {
  /** The dial's center: it moves least toward the look, so it reads as the deeper layer. */
  readonly dial: Point;
  /** The one center the needle, the ring and the core share, so they never part. */
  readonly eye: Point;
  /** The core's radius, which stays inside its ring through every breath and pulse. */
  readonly core: number;
}

/** Lays out the instrument for where the agent looks (a direction scaled 0 to 1) and a moment. */
export function instrumentLayout(look: Point, moment: InstrumentMoment): InstrumentLayout {
  const swell = pulseShare * Math.max(0, 1 - moment.sincePulse / pulseSeconds);
  return {
    dial: { x: look.x * 3, y: look.y * 3 },
    eye: { x: look.x * 7, y: look.y * 7 },
    core: coreRadius * moment.grown * (1 + moment.breathe * breatheShare + swell),
  };
}
