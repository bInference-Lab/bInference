import { describe, expect, it } from "vitest";
import {
  proposeIntent,
  testCardText,
  testLaunch,
  testLaunchEngine,
  testLaunchWallet,
} from "./test-launches.js";

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

// What a launchpad works out passes the same checks as the owner's own settings: an outside-only
// recipient may not be one of the install's wallets (decision 0277).
describe("a recipient a launchpad works out", () => {
  // The launch wallet's address, as the install records it.
  const own = `0x${testLaunchWallet.slice(-8)}`;

  it.each(["quote", "build"] as const)(
    "ends the launch when its %s names the launch wallet, before the card",
    async (at) => {
      const { test } = await testLaunchEngine({ worksOutRecipient: { at, value: own } });
      const view = await proposeIntent(test, testLaunch);
      expect([view.state, view.outcome?.reason]).toStrictEqual([
        "failed_check",
        "own_wallet_recipient",
      ]);
    },
  );

  it.each(["quote", "build"] as const)(
    "shows the account its %s works out on the card",
    async (at) => {
      const { test } = await testLaunchEngine({ worksOutRecipient: { at, value: "0x000000aa" } });
      const view = await proposeIntent(test, testLaunch);
      expect(view.state).toBe("awaiting_confirmation");
      const lines = await testCardText(test, view, "en");
      expect(lines.some((line) => line.includes("0x000000aa"))).toBe(true);
    },
  );
});
