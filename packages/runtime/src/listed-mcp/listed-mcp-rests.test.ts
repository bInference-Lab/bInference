import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createListedRests } from "./listed-mcp-rests.js";

const unreachable = { reason: "unreachable" } as const;

describe("createListedRests", () => {
  it("rests at the third failure in a row for 30 seconds, doubling at each one after", async () => {
    const clock = createManualClock();
    const rests = createListedRests(clock);
    rests.failed(unreachable);
    rests.failed(unreachable);
    expect(rests.restingSeconds()).toBeUndefined();
    rests.failed(unreachable);
    expect(rests.restingSeconds()).toBe(30);
    await clock.advance(30_000);
    rests.failed(unreachable);
    expect(rests.restingSeconds()).toBe(60);
  });

  it("ends a rest at a good answer that lands in it, and counts again from none", () => {
    const rests = createListedRests(createManualClock());
    rests.failed(unreachable);
    rests.failed(unreachable);
    rests.failed(unreachable);
    expect(rests.restingSeconds()).toBe(30);

    rests.answered();

    expect(rests.restingSeconds()).toBeUndefined();
    rests.failed(unreachable);
    expect(rests.restingSeconds()).toBeUndefined();
  });
});
