import type { ChainDefinition } from "../registry/chain-definition.js";

const verification = {
  source: "https://example.invalid/fake-chain",
  checkedOn: "2026-01-01",
  control: "read",
} as const;

/** A chain of the fake family for tests, with one token and one venue contract. */
export function createFakeChainDefinition(): ChainDefinition {
  return {
    id: "fake:1",
    key: "fake-one",
    name: "Fake One",
    family: "fake",
    nativeAsset: {
      assetNamespace: "slip44",
      assetReference: "1",
      symbol: "FAKE",
      name: "Fake",
      decimals: 18,
    },
    blockTimeMs: 1_000,
    finality: { kind: "confirmations", blocks: 2 },
    rpcs: [
      {
        name: "fake-rpc",
        url: "https://rpc.example.invalid",
        source: "https://example.invalid/rpc",
      },
    ],
    relays: [],
    explorers: [
      {
        name: "fake-scan",
        url: "https://scan.example.invalid",
        source: "https://example.invalid/scan",
      },
    ],
    tokens: [{ symbol: "TKN", name: "Token", decimals: 6, address: "0x0000000a", verification }],
    contracts: [{ venue: "fake-swap", name: "router", address: "0x0000000b", verification }],
  };
}
