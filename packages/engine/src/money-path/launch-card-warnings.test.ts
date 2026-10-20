import { describe, expect, it } from "vitest";
import { proposeIntent, testCardText, testLaunch, testLaunchEngine } from "./test-launches.js";

// A launchpad's own warnings show on every card of its launches (decision 0281).
describe("a token launch on a launchpad with its own card warnings", () => {
  it("shows each warning on the card", async () => {
    const { test } = await testLaunchEngine({ cardWarnings: ["notForUsCitizens"] });
    const lines = await testCardText(test, await proposeIntent(test, testLaunch), "en");
    expect(lines).toContain("⚠️ Brew's site says it is not available to U.S. citizens");
  });
});
