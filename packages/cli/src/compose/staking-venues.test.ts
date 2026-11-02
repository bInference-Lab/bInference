import { accountRefSchema, chainRefSchema, type VenueContracts } from "@binference/chain";
import { bsc, bscVenueCalls } from "@binference/chains";
import { createManualClock, createScriptedHttp } from "@binference/core/testing";
import { listaDeclaration } from "@binference/lista";
import { stakeHubDeclaration } from "@binference/stakehub";
import { describe, expect, it } from "vitest";
import { composeChainReads } from "./chain-reads.js";
import { selfHostedChains, selfHostedRatePrices } from "./open-engine-parts.js";
import { chainStakingVenues } from "./staking-venues.js";

const bscRef = chainRefSchema.parse(bsc.id);

// Lista's stake manager, as the registry lists it.
function listaPool() {
  const manager = bsc.contracts.find(
    ({ venue, name }) => venue === "lista" && name === "stake-manager",
  );
  return accountRefSchema.parse(`${bscRef}:${manager?.address ?? ""}`);
}

// The registry's calls by contract and function name: the plugin's ABI entries also name outputs.
function callsOf(entry: VenueContracts | undefined) {
  return (entry?.calls ?? []).map(({ contract, abi, walletInputs }) => ({
    contract,
    abi: { name: (abi as { readonly name: string }).name },
    walletInputs,
  }));
}

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
  it("declares exactly the calls the registry lists for StakeHub and Lista, so ceilings and signer hold them", () => {
    expect(stakeHubDeclaration([bscRef]).contracts).toStrictEqual([bscVenueCalls["stakehub"]]);
    expect(listaDeclaration([bscRef]).contracts).toMatchObject([
      { ...bscVenueCalls["lista"], calls: callsOf(bscVenueCalls["lista"]) },
    ]);
  });

  it("stakes on BSC through StakeHub and Lista with the registry's contracts, asking no node to start", () => {
    const { reads, http } = bscReads();
    const venues = chainStakingVenues(reads, selfHostedRatePrices());
    expect(venues.map(({ id, chain, pool: liquid }) => ({ id, chain, liquid }))).toStrictEqual([
      { id: "stakehub", chain: bscRef, liquid: undefined },
      { id: "lista", chain: bscRef, liquid: listaPool() },
    ]);
    expect(http.requests()).toStrictEqual([]);
  });

  it("makes no Lista venue on a chain whose registry prices no token at its stake manager's rate", () => {
    const { reads } = bscReads();
    expect(chainStakingVenues(reads).map(({ id }) => id)).toStrictEqual(["stakehub"]);
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
