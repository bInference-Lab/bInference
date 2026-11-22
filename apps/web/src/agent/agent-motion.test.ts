import { describe, expect, it } from "vitest";
import {
  type AgentInput,
  type AgentState,
  pulsedAgent,
  restingAgent,
  stepAgent,
} from "./agent-motion";

const screen = { x: 1440, y: 900 };
const slot = { key: 0, x: 720, y: 300, height: 380 };

function input(overrides: Partial<AgentInput>): AgentInput {
  return {
    now: 10,
    elapsed: 1 / 60,
    slot,
    mode: "idle",
    target: { x: 1200, y: 300 },
    clock: 0,
    awake: true,
    instant: false,
    chance: 0.5,
    ...overrides,
  };
}

function run(state: AgentState, frames: number, at: Partial<AgentInput>): AgentState {
  let now = state;
  for (let frame = 0; frame < frames; frame += 1) {
    now = stepAgent(now, input({ ...at, now: 10 + frame / 60 }));
  }
  return now;
}

describe("stepAgent", () => {
  it("walks to its slot and grows to its size", () => {
    const after = run(restingAgent(screen), 240, {});
    expect(after.x).toBeCloseTo(slot.x, 0);
    expect(after.y).toBeCloseTo(slot.y, 0);
    expect(after.size).toBeCloseTo(slot.height, 0);
    expect(after.wake).toBeGreaterThan(0.9);
  });

  it("jumps at once when motion is reduced, and never blinks", () => {
    const after = stepAgent(restingAgent(screen), input({ instant: true, now: 99 }));
    expect(after.x).toBe(slot.x);
    expect(after.size).toBe(slot.height);
    expect(after.blinkAt).toBe(-1);
  });

  it("points its needle at what it looks at", () => {
    const after = run(restingAgent(screen), 300, { target: { x: 720, y: 900 } });
    expect(Math.abs(Math.sin(after.angle))).toBeGreaterThan(0.95);
  });

  it("spins while it thinks and goes cold and still when frozen", () => {
    const awake = run(restingAgent(screen), 120, {});
    const thinking = run(awake, 60, { mode: "think" });
    expect(thinking.spinSpeed).toBeGreaterThan(3);
    const frozen = run(awake, 120, { mode: "frozen" });
    expect(frozen.cold).toBeGreaterThan(0.9);
    expect(frozen.look.x).toBeCloseTo(0, 1);
  });

  it("tells the time with its needle in the clock", () => {
    const noon = run(restingAgent(screen), 300, { mode: "clock", clock: 0.5 });
    expect(Math.abs(Math.cos(noon.angle))).toBeLessThan(0.05);
  });

  it("stays asleep and small until woken", () => {
    const asleep = run(restingAgent(screen), 60, { awake: false, slot: undefined });
    expect(asleep.wake).toBe(0);
    expect(asleep.size).toBe(0);
  });
});

describe("pulsedAgent", () => {
  it("marks the tap and spins the needle once", () => {
    const pulsed = pulsedAgent(restingAgent(screen), 12);
    expect(pulsed.pulseAt).toBe(12);
    expect(pulsed.spinSpeed).toBe(12);
  });
});
