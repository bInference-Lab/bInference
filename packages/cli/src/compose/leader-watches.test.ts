import { assetRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import { createManualClock } from "@binference/core/testing";
import type { TrackedWalletStore } from "@binference/engine/orders";
import { describe, expect, it } from "vitest";
import { composeLeaderWatchers, type LeaderWatchersOptions } from "./leader-watches.js";
import { selfHostedChains, selfHostedFeeds } from "./open-engine-parts.js";

const erc20 = (address: string) => assetRefSchema.parse(`${bsc.id}/erc20:${address}`);

describe("the leader watchers' quote assets", () => {
  it("hold the coin, its wrapper and the stablecoins with a feed, and no other token", () => {
    const options = {
      chains: selfHostedChains(),
      reads: new Map(),
      feeds: selfHostedFeeds(),
      tracked: {} as TrackedWalletStore,
      notices: {} as LeaderWatchersOptions["notices"],
      clock: createManualClock(0),
    };

    const { quotes } = composeLeaderWatchers(options);

    expect(quotes).toContain(assetRefSchema.parse(`${bsc.id}/slip44:714`));
    expect(quotes).toContain(erc20("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"));
    expect(quotes).toContain(erc20("0x55d398326f99059fF775485246999027B3197955"));
    expect(quotes).not.toContain(erc20("0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"));
  });
});
