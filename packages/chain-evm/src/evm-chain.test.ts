import type { ChainDefinition } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { erc20AssetRef, evmAccountRef, evmChainOf } from "./evm-chain.js";

const definition: ChainDefinition = {
  id: "eip155:31337",
  key: "test-chain",
  name: "Test Chain",
  family: "evm",
  nativeAsset: {
    assetNamespace: "slip44",
    assetReference: "60",
    symbol: "TEST",
    name: "Test coin",
    decimals: 18,
  },
  blockTimeMs: 1_000,
  finality: { kind: "finalized_tag" },
  rpcs: [{ name: "local", url: "https://rpc.invalid", source: "https://docs.invalid" }],
  relays: [],
  explorers: [{ name: "explorer", url: "https://scan.invalid", source: "https://docs.invalid" }],
  tokens: [],
  contracts: [],
};

const token = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

describe("evm chain", () => {
  it("reads the chain id, the native asset and the coin from a definition", () => {
    expect(evmChainOf(definition)).toStrictEqual({
      ref: "eip155:31337",
      chainId: 31_337,
      name: "Test Chain",
      nativeAsset: "eip155:31337/slip44:60",
      nativeSymbol: "TEST",
      nativeDecimals: 18,
    });
  });

  it("writes CAIP-10 accounts and CAIP-19 tokens with checksummed addresses", () => {
    const chain = evmChainOf(definition);
    expect(evmAccountRef(chain, token)).toBe(`eip155:31337:${token}`);
    expect(erc20AssetRef(chain, token)).toBe(`eip155:31337/erc20:${token}`);
  });

  it.each([
    ["another family", { family: "fake" }],
    ["another namespace", { id: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }],
    ["a reference that is no chain id", { id: "eip155:main" }],
    ["a malformed id", { id: "not a chain" }],
  ])("refuses a definition with %s", (_case, change) => {
    expect(() => evmChainOf({ ...definition, ...change })).toThrow(
      expect.objectContaining({ code: "chain.not_evm" }),
    );
  });
});
