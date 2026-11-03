import { chainRefSchema } from "@binference/chain";
import { bsc, bscVenueCalls } from "@binference/chains";
import { createManualClock, createScriptedHttp } from "@binference/core/testing";
import { erc8004Declaration } from "@binference/erc8004";
import { describe, expect, it } from "vitest";
import { composeChainReads } from "./chain-reads.js";
import { chainIdentityRegistries } from "./identity-registries.js";
import { selfHostedChains } from "./open-engine-parts.js";

const bscRef = chainRefSchema.parse(bsc.id);

describe("the self-hosted identity registries", () => {
  it("declares exactly the call the registry lists for ERC-8004, so ceilings and signer hold it", () => {
    expect(erc8004Declaration([bscRef]).contracts).toStrictEqual([bscVenueCalls["erc8004"]]);
  });

  it("registers on BSC in the registry's identity registry, asking no node to start", () => {
    const http = createScriptedHttp([]);
    const reads = composeChainReads({
      chains: selfHostedChains(),
      config: {
        enabled: [bscRef],
        rpc: { [bscRef]: { urls: ["https://node.example.org/"] } },
        relays: {},
        maxFeePerGasGwei: { [bscRef]: "1" },
      },
      http,
      clock: createManualClock(0),
    });
    const registries = chainIdentityRegistries(reads);
    const listed = bsc.contracts.filter(({ venue }) => venue === "erc8004");

    expect(registries.map(({ id, chain, registry }) => ({ id, chain, registry }))).toStrictEqual(
      listed.map(({ address }) => ({
        id: "erc8004",
        chain: bscRef,
        registry: `${bscRef}:${address}`,
      })),
    );
    expect(listed).toHaveLength(1);
    expect(http.requests()).toStrictEqual([]);
  });
});
