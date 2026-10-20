import { describe, expect, it } from "vitest";
import { proposeIntent, testCardText, testLaunch, testLaunchEngine } from "./test-launches.js";

// A launchpad that works out an optional setting at its quote when a launch leaves it out
// (decision 0280): the card shows the value it worked out, and the create call must write it.
describe("a token launch with an optional setting its launchpad works out", () => {
  it("shows the quoted value on the card, as an amount of the pair, and builds with it", async () => {
    const { test } = await testLaunchEngine({ quotesAmount: "5000" });
    const view = await proposeIntent(test, testLaunch);
    expect(view.state).toBe("awaiting_confirmation");
    const lines = await testCardText(test, view, "en");
    expect(lines).toContain("Tax on every sell: 0.000000000000005 FAKE");
  });

  it("keeps the value the launch gives over its launchpad's", async () => {
    const { test } = await testLaunchEngine({ quotesAmount: "5000" });
    const request = { ...testLaunch, venueOptions: { taxBps: 300, sellTaxBps: "7000" } };
    const lines = await testCardText(test, await proposeIntent(test, request), "en");
    expect(lines).toContain("Tax on every sell: 0.000000000000007 FAKE");
  });
});
