import { chainRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import { createManualClock, createScriptedHttp } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { composeChainReads } from "./chain-reads.js";
import { chainNameResolvers } from "./name-resolvers.js";
import { selfHostedChains } from "./open-engine-parts.js";

const bscRef = chainRefSchema.parse(bsc.id);
const signal = new AbortController().signal;

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

describe("the self-hosted name resolvers", () => {
  it("resolves bnb names on BSC, whose registry lists SPACE ID", async () => {
    const { reads, http } = bscReads();
    const resolvers = chainNameResolvers(reads);
    expect(resolvers.map(({ chain, suffix }) => ({ chain, suffix }))).toStrictEqual([
      { chain: bscRef, suffix: ".bnb" },
    ]);
    await expect(resolvers[0]?.resolve("alice.eth", { signal })).resolves.toStrictEqual({
      kind: "malformed",
    });
    expect(http.requests()).toStrictEqual([]);
  });

  it("makes no resolver for a chain whose registry lists no SPACE ID contract", () => {
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
              contracts: each.chain.definition.contracts.filter(({ venue }) => venue !== "spaceid"),
            },
          },
        },
      ]),
    );
    expect(chainNameResolvers(bare)).toStrictEqual([]);
  });
});
