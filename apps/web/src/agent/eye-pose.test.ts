import { describe, expect, it } from "vitest";
import { type AgentState, restingAgent } from "./agent-motion";
import { type EyeInput, eyePose } from "./eye-pose";

const awake: AgentState = {
  ...restingAgent({ x: 1440, y: 900 }),
  wake: 1,
  gaze: { x: 900, y: 40 },
};

function input(overrides: Partial<EyeInput>): EyeInput {
  return {
    state: awake,
    now: 20,
    eye: { x: 40, y: 860 },
    side: "left",
    awake: true,
    hover: undefined,
    glance: undefined,
    near: 0,
    pokedAt: -1,
    still: 0,
    ...overrides,
  };
}

describe("eyePose", () => {
  it("looks where the agent looks, to the rim when that is far", () => {
    const pose = eyePose(input({}));
    expect(pose.x).toBeGreaterThan(0.5);
    expect(pose.y).toBeLessThan(-0.5);
    expect(Math.hypot(pose.x, pose.y)).toBeGreaterThan(0.98);
  });

  it("turns both eyes toward each other for a pointer close between them", () => {
    const hover = { x: 65, y: 860 };
    const left = eyePose(input({ eye: { x: 40, y: 860 }, hover }));
    const right = eyePose(input({ eye: { x: 90, y: 860 }, hover, side: "right" }));
    expect(left.x).toBeGreaterThan(0.1);
    expect(right.x).toBeLessThan(-0.1);
  });

  it("glances at its own words, while a pointer on them still wins", () => {
    const glance = { x: 200, y: 860 };
    expect(eyePose(input({ glance })).y).toBeCloseTo(0, 5);
    expect(eyePose(input({ glance, hover: { x: 40, y: 960 } })).y).toBeGreaterThan(0.5);
  });

  it("keeps its eyes shut before the agent wakes", () => {
    expect(eyePose(input({ awake: false })).open).toBe(0);
    expect(eyePose(input({ state: { ...awake, wake: 0 } })).open).toBe(0);
  });

  it("opens fully once awake and shuts at the middle of the agent's blink", () => {
    expect(eyePose(input({})).open).toBe(1);
    expect(eyePose(input({ state: { ...awake, blinkAt: 19.89 } })).open).toBeLessThan(0.01);
  });

  it("turns to a pointer resting on the pill and smiles at it", () => {
    const pose = eyePose(input({ hover: { x: 40, y: 900 } }));
    expect(pose.y).toBeGreaterThan(0);
    expect(pose.smile).toBe(1);
  });

  it("winks the left eye alone when poked, and both smile", () => {
    const poke = { pokedAt: 19.775 };
    const left = eyePose(input(poke));
    const right = eyePose(input({ ...poke, side: "right" }));
    expect(left.open).toBeLessThan(0.01);
    expect(right.open).toBe(1);
    expect(right.smile).toBeGreaterThan(0.5);
  });

  it("widens its pupils as the pointer comes near", () => {
    expect(eyePose(input({ near: 1 })).pupil).toBeGreaterThan(eyePose(input({})).pupil);
  });

  it("lets its lids droop when the reader has been still a while", () => {
    expect(eyePose(input({ still: 30 })).open).toBeCloseTo(0.55, 5);
    expect(eyePose(input({ still: 15 })).open).toBe(1);
  });

  it("looks up and away while it thinks, and never smiles when frozen", () => {
    const thinking = eyePose(input({ state: { ...awake, think: 1, gaze: { x: 40, y: 2000 } } }));
    expect(thinking.y).toBeLessThan(-0.4);
    expect(eyePose(input({ state: { ...awake, cold: 1 }, hover: { x: 40, y: 860 } })).smile).toBe(
      0,
    );
  });
});
