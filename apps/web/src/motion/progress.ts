/** How a scene measures how far the reader has scrolled through it. */
export type SceneMode =
  /** A tall block with a sticky stage: 0 at its top, 1 when its end reaches the screen's bottom. */
  | "pinned"
  /** Any block: 0 as it enters at the bottom, 1 as it leaves at the top. */
  | "view"
  /** A block that starts on screen, such as the hero: 0 at rest, 1 once it has scrolled away. */
  | "leave";

/** Where a block sits on screen, as `getBoundingClientRect` reads it. */
export interface Box {
  readonly top: number;
  readonly height: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const measures: Readonly<Record<SceneMode, (box: Box, screen: number) => number>> = {
  pinned: (box, screen) => -box.top / Math.max(1, box.height - screen),
  leave: (box) => -box.top / Math.max(1, box.height),
  view: (box, screen) => (screen - box.top) / (screen + box.height),
};

/** The scene's progress, 0 to 1, for a block at `box` on a screen `screen` pixels tall. */
export function progressOf(mode: SceneMode, box: Box, screen: number): number {
  return clamp01(measures[mode](box, screen));
}

/**
 * One frame of easing from `now` toward `target`: a fixed share of the way, snapping when close,
 * so a pinned scene glides like film instead of stepping with the wheel.
 */
export function easedToward(now: number, target: number): number {
  const next = now + (target - now) * 0.115;
  return Math.abs(target - next) < 0.0004 ? target : next;
}

/** Which of `steps` equal steps the progress `p` falls in, from 0 to `steps - 1`. */
export function stepOf(p: number, steps: number): number {
  return Math.min(steps - 1, Math.floor(p * steps));
}
