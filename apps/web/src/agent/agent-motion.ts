import type { Point } from "./mark-field";

/** What the agent is doing, which decides how its needle and color behave. */
export type AgentMode =
  /** It watches: the needle points at what it looks at. */
  | "idle"
  /** It works: the needle spins and signals run into the core. */
  | "think"
  /** It waits for the owner: it looks at the button it needs pressed. */
  | "wait"
  /** The needle is a clock hand, turned by the scroll. */
  | "clock"
  /** Everything stopped: it turns cold and still. */
  | "frozen";

/** Where the agent should stand: the box of the slot on screen, in CSS pixels. */
export interface SlotBox {
  /** Tells one slot from another, so a move between slots glides. */
  readonly key: number;
  readonly x: number;
  readonly y: number;
  readonly height: number;
}

/** The agent between frames. Positions are screen pixels; angles radians; times seconds. */
export interface AgentState {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly slot: number;
  readonly travelUntil: number;
  readonly gaze: Point;
  /** Where it looks from its core, as a direction scaled by how far away that is (0 to 1). */
  readonly look: Point;
  readonly angle: number;
  readonly spinSpeed: number;
  readonly spin: number;
  readonly blinkAt: number;
  readonly nextBlink: number;
  readonly cold: number;
  readonly think: number;
  readonly wake: number;
  readonly pulseAt: number;
}

/** What one frame of the agent depends on. */
export interface AgentInput {
  readonly now: number;
  readonly elapsed: number;
  readonly slot: SlotBox | undefined;
  readonly mode: AgentMode;
  /** What it should look at; without one it lets its gaze wander. */
  readonly target: Point | undefined;
  /** The day's progress, 0 to 1, for the clock hand. */
  readonly clock: number;
  readonly awake: boolean;
  /** Reduced motion: it jumps to place and never blinks or wanders. */
  readonly instant: boolean;
  /** A random number from 0 to 1, for the time of the next blink. */
  readonly chance: number;
}

/** The agent before it wakes: no size, at the screen's center. */
export function restingAgent(screen: Point): AgentState {
  const middle = { x: screen.x / 2, y: screen.y / 2 };
  return {
    ...middle,
    size: 0,
    slot: -1,
    travelUntil: 0,
    gaze: middle,
    look: { x: 0, y: 0 },
    angle: -0.5934,
    spinSpeed: 0,
    spin: 0,
    blinkAt: -1,
    nextBlink: 4,
    cold: 0,
    think: 0,
    wake: 0,
    pulseAt: -1,
  };
}

function corePosition(state: AgentState): Point {
  const scale = state.size / 644;
  return { x: state.x - 10 * scale, y: state.y + 80 * scale };
}

// It follows its slot closely, and glides for a second when it moves on to another one.
function followRate(input: AgentInput, travelUntil: number): number {
  if (input.instant) {
    return 1;
  }
  return input.now < travelUntil ? 0.085 : 0.42;
}

function place(state: AgentState, input: AgentInput): AgentState {
  const slot = input.slot;
  if (slot === undefined) {
    return { ...state, size: state.size * (input.instant ? 0 : 0.9) };
  }
  const moved = slot.key !== state.slot;
  const travelUntil = moved ? input.now + 1 : state.travelUntil;
  const follow = followRate(input, travelUntil);
  return {
    ...state,
    slot: slot.key,
    travelUntil,
    x: state.x + (slot.x - state.x) * follow,
    y: state.y + (slot.y - state.y) * follow,
    size: state.size + (slot.height - state.size) * (input.instant ? 1 : 0.1),
  };
}

function gazeTarget(core: Point, input: AgentInput): Point {
  if (input.mode === "frozen") {
    return core;
  }
  if (input.target !== undefined) {
    return input.target;
  }
  const wander = input.instant ? 0 : 1;
  return {
    x: core.x + Math.sin(input.now * 0.45) * 280 * wander,
    y: core.y + Math.cos(input.now * 0.33) * 130 * wander,
  };
}

function gaze(state: AgentState, input: AgentInput): AgentState {
  const core = corePosition(state);
  const goal = gazeTarget(core, input);
  const point = {
    x: state.gaze.x + (goal.x - state.gaze.x) * 0.1,
    y: state.gaze.y + (goal.y - state.gaze.y) * 0.1,
  };
  const dx = point.x - core.x;
  const dy = point.y - core.y;
  const distance = Math.hypot(dx, dy) || 1;
  const reach = input.mode === "frozen" ? 0 : Math.min(1, distance / 340);
  return {
    ...state,
    gaze: point,
    look: {
      x: state.look.x + ((dx / distance) * reach - state.look.x) * 0.12,
      y: state.look.y + ((dy / distance) * reach - state.look.y) * 0.12,
    },
  };
}

// The needle has two ends, so it turns to whichever way to the goal is shorter.
function halfTurn(from: number, to: number): number {
  const difference = to - from;
  return Math.atan2(Math.sin(2 * difference), Math.cos(2 * difference)) / 2;
}

function turnNeedle(state: AgentState, input: AgentInput): AgentState {
  const thinking = input.mode === "think";
  const spinSpeed =
    state.spinSpeed + ((thinking ? 6.2 : 0) - state.spinSpeed) * (thinking ? 0.05 : 0.045);
  if (input.mode === "frozen") {
    return { ...state, spinSpeed };
  }
  const core = corePosition(state);
  const goal =
    input.mode === "clock"
      ? -Math.PI / 2 + input.clock * Math.PI * 2
      : Math.atan2(state.gaze.y - core.y, state.gaze.x - core.x);
  const angle =
    spinSpeed > 0.08
      ? state.angle + spinSpeed * input.elapsed
      : state.angle + halfTurn(state.angle, goal) * 0.12;
  return {
    ...state,
    spinSpeed,
    angle,
    spin: state.spin + input.elapsed * (0.05 + state.think * 0.5),
  };
}

function live(state: AgentState, input: AgentInput): AgentState {
  const frozen = input.mode === "frozen";
  const blinks = !frozen && !input.instant && input.now > state.nextBlink;
  return {
    ...state,
    blinkAt: blinks ? input.now : state.blinkAt,
    nextBlink: blinks ? input.now + 3.5 + input.chance * 4.5 : state.nextBlink,
    cold: state.cold + ((frozen ? 1 : 0) - state.cold) * 0.06,
    think: state.think + ((input.mode === "think" ? 1 : 0) - state.think) * 0.06,
    wake: input.awake ? Math.min(1, state.wake + input.elapsed / 2.4) : state.wake,
  };
}

/** The agent one frame later: where it stands, where it looks, its needle, blink and color. */
export function stepAgent(state: AgentState, input: AgentInput): AgentState {
  return live(turnNeedle(gaze(place(state, input), input), input), input);
}

/** The agent after a tap: a ring spreads from its core and the needle spins once. */
export function pulsedAgent(state: AgentState, now: number): AgentState {
  return { ...state, pulseAt: now, spinSpeed: 12 };
}
