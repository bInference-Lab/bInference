import type { AgentState } from "./agent-motion";
import type { Point } from "./mark-field";

/** Which eye of the pair: a poke winks the left one. */
export type EyeSide = "left" | "right";

/** What one eye of the status pill depends on in one frame. */
export interface EyeInput {
  /** The agent itself: the eyes look where it looks, blink with it and go cold with it. */
  readonly state: AgentState;
  readonly now: number;
  /** The eye's center on screen. */
  readonly eye: Point;
  readonly side: EyeSide;
  readonly awake: boolean;
  /** The pointer while it rests on the pill: the eyes turn to it and smile. */
  readonly hover: Point | undefined;
  /** How close the pointer is, from 0 (far) to 1 (on the pill): the pupils widen as it comes. */
  readonly near: number;
  /** When the reader last poked the eyes, in seconds, or -1 for never. */
  readonly pokedAt: number;
  /** How long the reader has been still, in seconds: after a while the lids droop. */
  readonly still: number;
}

/**
 * One eye's pose: where the pupil sits as a share of its reach (-1 to 1 on each axis), how open
 * the lids are and how far the lower lid rises in a smile (0 to 1), and the pupil's size.
 */
export interface EyePose {
  readonly x: number;
  readonly y: number;
  readonly open: number;
  readonly smile: number;
  readonly pupil: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// A quick shut and open over `span` seconds from `at`: 0 while open, 1 at its middle.
function shut(now: number, at: number, span: number): number {
  return at < 0 ? 0 : Math.sin(Math.PI * clamp01((now - at) / span));
}

// Toward what it looks at, nearer the rim the farther that is; thinking, it looks up and away
// and lets its eyes drift in a slow circle.
function lookOf(input: EyeInput): Point {
  const goal = input.hover ?? input.state.gaze;
  const dx = goal.x - input.eye.x;
  const dy = goal.y - input.eye.y;
  const distance = Math.hypot(dx, dy) || 1;
  const reach = Math.min(1, distance / 160);
  const { think } = input.state;
  return {
    x: (dx / distance) * reach * (1 - think) + think * (0.55 + Math.cos(input.now * 1.7) * 0.3),
    y: (dy / distance) * reach * (1 - think) + think * (-0.7 + Math.sin(input.now * 1.7) * 0.2),
  };
}

function openOf(input: EyeInput): number {
  if (!input.awake) {
    return 0;
  }
  const { state, now } = input;
  const blink = shut(now, state.blinkAt, 0.22);
  const wink = input.side === "left" ? shut(now, input.pokedAt, 0.45) : 0;
  const drowsy = clamp01((input.still - 18) / 6) * 0.45;
  const heavy = drowsy + state.think * 0.35 + state.cold * 0.2;
  return clamp01(state.wake * 1.4) * (1 - Math.max(blink, wink)) * (1 - heavy);
}

/** One eye of the status pill in one frame. */
export function eyePose(input: EyeInput): EyePose {
  const { state } = input;
  const look = lookOf(input);
  const fond = Math.max(input.hover === undefined ? 0 : 1, shut(input.now, input.pokedAt, 0.9));
  return {
    x: look.x,
    y: look.y,
    open: openOf(input),
    smile: input.awake ? fond * (1 - state.cold) : 0,
    pupil: 1 + input.near * 0.35 - state.think * 0.15 - state.cold * 0.3,
  };
}
