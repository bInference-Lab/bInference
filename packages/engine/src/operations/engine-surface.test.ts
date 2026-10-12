import { describe, expect, it } from "vitest";
import { createEngine } from "./create-engine.js";
import { startTestEngine } from "./test-engine.js";

describe("the engine's surface", () => {
  it("fills an order only through its price triggers, never at a caller's price", async () => {
    const test = await startTestEngine();

    const engine = createEngine(test.engineOptions);

    expect(Object.keys(engine)).not.toContain("fillOrder");
    expect(Object.keys(engine)).toContain("seePrice");
  });
});
