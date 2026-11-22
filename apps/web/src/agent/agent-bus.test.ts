import { describe, expect, it, vi } from "vitest";
import { createAgentBus } from "./agent-bus";

describe("createAgentBus", () => {
  it("starts asleep with no taps, and tells listeners of a wake and each tap", () => {
    const bus = createAgentBus();
    const listener = vi.fn<() => void>();
    bus.subscribe(listener);
    expect(bus.isAwake()).toBe(false);
    bus.wake();
    bus.tap();
    bus.tap();
    expect(bus.isAwake()).toBe(true);
    expect(bus.taps()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("ends an order at its time", () => {
    const bus = createAgentBus();
    bus.order({ mode: "think", until: 1000 });
    expect(bus.orderAt(999)?.mode).toBe("think");
    expect(bus.orderAt(1001)).toBeUndefined();
  });

  it("hands each pulse out once", () => {
    const bus = createAgentBus();
    bus.pulse();
    expect(bus.takePulse()).toBe(true);
    expect(bus.takePulse()).toBe(false);
  });
});
