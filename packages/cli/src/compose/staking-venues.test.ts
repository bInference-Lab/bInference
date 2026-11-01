import { chainRefSchema } from "@binference/chain";
import { bsc, bscVenueCalls } from "@binference/chains";
import { createManualClock, createScriptedHttp } from "@binference/core/testing";
import { stakeHubDeclaration } from "@binference/stakehub";
import { describe, expect, it } from "vitest";
import { composeChainReads } from "./chain-reads.js";
import { selfHostedChains } from "./open-engine-parts.js";
import { chainStakingVenues } from "./staking-venues.js";

const bscRef = chainRefSchema.parse(bsc.id);

// The chain reads of BSC over a node the test never asks.
function bscReads() {
  const http = createScriptedHttp([]);
  const config = {
    enabled: [bscRef],
    rpc: { [bscRef]: { urls: ["https://node.example.org/"] } },
    relays: {},
    maxFeePerGasGwei: { [bscRef]: "1" },
  };
  const reads = composeChainReads({
    chains: selfHostedChains(),
    config,
    http,
    clock: createManualClock(0),
  });
  return { reads, http };
}

describe("the self-hosted staking venues", () => {
  it("declares exactly the calls the registry lists for StakeHub, so ceilings and signer hold them", () => {
    expect(stakeHubDeclaration([bscRef]).contracts).toStrictEqual([bscVenueCalls["stakehub"]]);
  });

  it("stakes on BSC through StakeHub with the registry's contracts, asking no node to start", () => {
    const { reads, http } = bscReads();
    const venues = chainStakingVenues(reads);
    expect(venues.map(({ id, chain, contracts }) => ({ id, chain, contracts }))).toStrictEqual([
      { id: "stakehub", chain: bscRef, contracts: [bscVenueCalls["stakehub"]] },
    ]);
    expect(http.requests()).toStrictEqual([]);
  });

  it("makes no venue for a chain whose registry lists no StakeHub contract", () => {
    const { reads } = bscReads();
    const bare = new Map(
      [...reads].map(([ref, each]) => [
        ref,
        {
          ...each,
          chain: {
            ...each.chain,
            definition: {
              ...each.chain.definition,
              contracts: each.chain.definition.contracts.filter(
                ({ venue }) => venue !== "stakehub",
              ),
            },
          },
        },
      ]),
    );
    expect(chainStakingVenues(bare)).toStrictEqual([]);
  });
});
