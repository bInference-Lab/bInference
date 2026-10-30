import type { AccountRef, AssetRef, ChainDefinition } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { solanaAddressOn, solanaChainOf, solanaMintOn } from "./solana-chain.js";

const cluster = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const definition: ChainDefinition = {
  id: cluster,
  key: "test-cluster",
  name: "Test cluster",
  family: "solana",
  nativeAsset: {
    assetNamespace: "slip44",
    assetReference: "501",
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
  },
  blockTimeMs: 400,
  finality: { kind: "finalized_tag" },
  rpcs: [{ name: "node", url: "https://node.invalid", source: "https://node.invalid" }],
  relays: [],
  explorers: [
    {
      name: "x",
      url: "https://x.invalid",
      txUrl: "https://x.invalid/tx/{hash}",
      source: "https://x.invalid",
    },
  ],
  tokens: [],
  contracts: [],
};
const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("the Solana view of a chain definition", () => {
  it("reads the cluster's id, name and SOL", () => {
    expect(solanaChainOf(definition)).toStrictEqual({
      ref: cluster,
      name: "Test cluster",
      nativeAsset: `${cluster}/slip44:501`,
    });
  });

  it.each([
    ["another family", { ...definition, family: "evm" }],
    ["another namespace", { ...definition, id: "eip155:1" }],
  ])("refuses a definition of %s", (_case, other) => {
    expect(() => solanaChainOf(other)).toThrow(
      expect.objectContaining({ code: "chain.not_solana" }),
    );
  });

  it("reads an account's address and a token's mint, and SOL as no mint", () => {
    const chain = solanaChainOf(definition);
    expect(solanaAddressOn(chain, `${cluster}:${mint}` as AccountRef)).toBe(mint);
    expect(solanaMintOn(chain, `${cluster}/token:${mint}` as AssetRef)).toBe(mint);
    expect(solanaMintOn(chain, chain.nativeAsset)).toBeUndefined();
  });

  it.each([
    [
      "an account of another chain",
      () =>
        solanaAddressOn(
          solanaChainOf(definition),
          `eip155:1:0x168E0c5AE6B259883D878C89C042ad6347F8ba85` as AccountRef,
        ),
    ],
    [
      "an account that is no Solana address",
      () => solanaAddressOn(solanaChainOf(definition), `${cluster}:1111` as AccountRef),
    ],
    [
      "an asset of another kind",
      () => solanaMintOn(solanaChainOf(definition), `${cluster}/nft:${mint}` as AssetRef),
    ],
  ])("refuses %s", (_case, read) => {
    expect(read).toThrow(expect.objectContaining({ code: "chain.unknown_chain" }));
  });
});
